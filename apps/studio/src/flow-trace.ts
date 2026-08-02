import type { RuntimeBridgeEvent } from "@topo/runtime-bridge";
import type {
  ApplicationGraph,
  Flow,
  ScreenNode,
  WriteFlowInput,
} from "@topo/schema";

const MAXIMUM_TRACE_EVENTS = 500;

export interface FlowTraceRouteObservation {
  path: string;
  routePath: string;
  screenId?: string;
  title: string;
  action: string;
  observedAt: string;
}

export interface FlowTraceSession {
  version: 1;
  id: string;
  title: string;
  startedAt: string;
  sourceFlowId?: string;
  seenEventKeys: string[];
  routes: FlowTraceRouteObservation[];
}

export interface CreateFlowTraceSessionOptions {
  graph: ApplicationGraph;
  sourceFlow?: Flow;
  selectedScreenId?: string;
  now?: string;
  id?: string;
}

function normalizedPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 500) return undefined;
  try {
    const url = new URL(value, "http://topo.local");
    if (url.origin !== "http://topo.local" && !/^https?:$/.test(url.protocol)) {
      return undefined;
    }
    const path = url.pathname.replace(/\/{2,}/g, "/");
    return path.startsWith("/") ? path : undefined;
  } catch {
    return undefined;
  }
}

function routePatternScore(routePath: string): number {
  return routePath
    .split("/")
    .filter(Boolean)
    .reduce((score, segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return score + 1;
      if (/^(?:\[\.\.\..+\]|\*)$/.test(segment)) return score + 2;
      if (/^(?:\[[^\]]+\]|:[^/]+|\$[^/]+)$/.test(segment)) return score + 4;
      return score + 10;
    }, 0);
}

function routePattern(routePath: string): RegExp {
  const segments = routePath.split("/").filter(Boolean);
  if (segments.length === 0) return /^\/$/;
  const source = segments
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:/.+)?";
      if (/^(?:\[\.\.\..+\]|\*)$/.test(segment)) return "/.+";
      if (/^(?:\[[^\]]+\]|:[^/]+|\$[^/]+)$/.test(segment)) return "/[^/]+";
      return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
    })
    .join("");
  return new RegExp(`^${source}/?$`);
}

export function resolveFlowTraceRoute(
  graph: ApplicationGraph,
  value: unknown,
): { path: string; routePath: string; screen?: ScreenNode } | undefined {
  const path = normalizedPath(value);
  if (!path) return undefined;
  const screen = [...graph.screens]
    .sort((left, right) => {
      const exactLeft = left.routePath === path ? 1 : 0;
      const exactRight = right.routePath === path ? 1 : 0;
      return (
        exactRight - exactLeft ||
        routePatternScore(right.routePath) - routePatternScore(left.routePath)
      );
    })
    .find((candidate) => routePattern(candidate.routePath).test(path));
  return {
    path,
    routePath: screen?.routePath ?? path,
    ...(screen ? { screen } : {}),
  };
}

function entryScreen(
  options: CreateFlowTraceSessionOptions,
): ScreenNode | undefined {
  const entryStep = options.sourceFlow?.steps.find(
    (step) => step.id === options.sourceFlow?.entryStepId,
  );
  return (
    options.graph.screens.find((screen) => screen.id === entryStep?.screenId) ??
    options.graph.screens.find(
      (screen) => screen.routePath === entryStep?.routePath,
    ) ??
    options.graph.screens.find(
      (screen) => screen.id === options.selectedScreenId,
    ) ??
    options.graph.screens[0]
  );
}

function tracePreviewPath(screen: ScreenNode): string | undefined {
  if (screen.previewRoute?.status === "unresolved") return undefined;
  return screen.previewRoute?.path ?? screen.routePath;
}

function observation(
  resolved: NonNullable<ReturnType<typeof resolveFlowTraceRoute>>,
  action: string,
  observedAt: string,
): FlowTraceRouteObservation {
  return {
    path: resolved.path,
    routePath: resolved.routePath,
    ...(resolved.screen ? { screenId: resolved.screen.id } : {}),
    title: resolved.screen?.title ?? resolved.routePath,
    action,
    observedAt,
  };
}

export function createFlowTraceSession(
  options: CreateFlowTraceSessionOptions,
): FlowTraceSession {
  const startedAt = options.now ?? new Date().toISOString();
  const screen = entryScreen(options);
  const path = screen ? tracePreviewPath(screen) : undefined;
  const resolved = path
    ? resolveFlowTraceRoute(options.graph, path)
    : undefined;
  const sourceTitle =
    options.sourceFlow?.title ?? screen?.title ?? "Application";
  return {
    version: 1,
    id: options.id ?? `trace-${crypto.randomUUID()}`,
    title: `${sourceTitle} trace`,
    startedAt,
    ...(options.sourceFlow ? { sourceFlowId: options.sourceFlow.id } : {}),
    seenEventKeys: [],
    routes: resolved ? [observation(resolved, "Start here", startedAt)] : [],
  };
}

function navigationAction(kind: unknown): string {
  if (kind === "popstate") return "Go back";
  if (kind === "replaceState") return "Replace route";
  if (kind === "load") return "Open screen";
  return "Navigate";
}

export function appendFlowTraceEvents(
  session: FlowTraceSession,
  events: readonly RuntimeBridgeEvent[],
  graph: ApplicationGraph,
): FlowTraceSession {
  const seen = new Set(session.seenEventKeys);
  const nextKeys = [...session.seenEventKeys];
  const routes = [...session.routes];
  for (const event of events) {
    if (
      event.type !== "topo.navigation" ||
      Date.parse(event.timestamp) < Date.parse(session.startedAt)
    ) {
      continue;
    }
    const path = normalizedPath(event.payload.path);
    if (!path) continue;
    const key = `${event.timestamp}|${String(event.payload.kind ?? "navigation")}|${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextKeys.push(key);
    const resolved = resolveFlowTraceRoute(graph, path);
    if (!resolved) continue;
    const previous = routes.at(-1);
    if (previous?.path === resolved.path) continue;
    routes.push(
      observation(
        resolved,
        navigationAction(event.payload.kind),
        event.timestamp,
      ),
    );
  }
  if (
    nextKeys.length === session.seenEventKeys.length &&
    routes.length === session.routes.length
  ) {
    return session;
  }
  return {
    ...session,
    seenEventKeys: nextKeys.slice(-MAXIMUM_TRACE_EVENTS),
    routes,
  };
}

export function flowTraceToWriteInput(
  session: FlowTraceSession,
): WriteFlowInput {
  const steps = session.routes.map((route, index) => ({
    id: `step-${index + 1}`,
    title: route.title,
    routePath: route.routePath,
    ...(route.screenId ? { screenId: route.screenId } : {}),
    action: route.action,
    expected: `The ${route.title} screen is visible`,
    noteIds: [],
    nextStepIds: index < session.routes.length - 1 ? [`step-${index + 2}`] : [],
  }));
  return {
    title: session.title,
    description: `Recorded from the signed local preview on ${session.startedAt}.`,
    status: "draft",
    entryStepId: steps[0]?.id,
    tags: ["recorded", "preview-bridge"],
    steps,
  };
}

export function flowTraceCurrentPath(
  session: FlowTraceSession,
): string | undefined {
  return session.routes.at(-1)?.path;
}
