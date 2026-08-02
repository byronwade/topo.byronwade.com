import { performance } from "node:perf_hooks";
import path from "node:path";

import {
  inspectBrowserRuntime,
  type BrowserRuntimeInspection,
} from "@topo/browser";
import type { TopoProject } from "@topo/config";
import {
  DoctorReportSchema,
  type DoctorCheck,
  type DoctorReport,
} from "@topo/protocol";
import {
  ApplicationGraphSchema,
  resolveScreenPreviewRoute,
  type ApplicationGraph,
} from "@topo/schema";

const REQUIRED_NODE_MAJOR = 24;

export interface PreviewRuntimeInspection {
  reachable: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
}

export interface DoctorRuntimeEvidence {
  observedAt: string;
  nodeVersion: string;
  browser: BrowserRuntimeInspection;
  preview: PreviewRuntimeInspection;
}

export interface DoctorProbeInput {
  previewBaseUrl: string;
  executablePath?: string;
  timeoutMs: number;
}

export type DoctorRuntimeProbe = (
  input: DoctorProbeInput,
) => Promise<DoctorRuntimeEvidence>;

export interface RunDoctorOptions {
  project: TopoProject;
  graph: ApplicationGraph;
  probe?: DoctorRuntimeProbe;
  timeoutMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function inspectPreviewRuntime(
  baseUrl: string,
  timeoutMs: number,
): Promise<PreviewRuntimeInspection> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "Topo-Doctor/0.1" },
    });
    await response.body?.cancel();
    return {
      reachable: true,
      status: response.status,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      error: errorMessage(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const defaultDoctorRuntimeProbe: DoctorRuntimeProbe = async (input) => {
  const [browser, preview] = await Promise.all([
    inspectBrowserRuntime(input.executablePath),
    inspectPreviewRuntime(input.previewBaseUrl, input.timeoutMs),
  ]);
  return {
    observedAt: new Date().toISOString(),
    nodeVersion: process.versions.node,
    browser,
    preview,
  };
};

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function check(
  value: Omit<DoctorCheck, "severity" | "evidence"> & {
    evidence?: Record<string, unknown>;
  },
): DoctorCheck {
  return {
    ...value,
    severity:
      value.status === "error"
        ? "error"
        : value.status === "warning"
          ? "warning"
          : "info",
    evidence: value.evidence ?? {},
  };
}

export async function runDoctor(
  options: RunDoctorOptions,
): Promise<DoctorReport> {
  const graph = ApplicationGraphSchema.parse(options.graph);
  const evidence = await (options.probe ?? defaultDoctorRuntimeProbe)({
    previewBaseUrl: options.project.config.preview.baseUrl,
    executablePath: options.project.config.preview.executablePath,
    timeoutMs: options.timeoutMs ?? 1_500,
  });
  const nodeMajor = Number(evidence.nodeVersion.split(".")[0]);
  const previewUrl = new URL(options.project.config.preview.baseUrl);
  const previewIsLoopback = isLoopbackHostname(previewUrl.hostname);
  const daemonIsLoopback = isLoopbackHostname(
    options.project.config.daemon.host,
  );
  const explicitSourceSelection =
    path.resolve(options.project.projectRoot) !==
    path.resolve(options.project.sourceRoot);
  const frameworkFamilies = [
    ...new Set(graph.screens.map((screen) => screen.framework)),
  ].sort();
  const ambiguousProjectRoot =
    !explicitSourceSelection && frameworkFamilies.length > 1;
  const unresolvedPreviewRoutes = [
    ...new Set(
      graph.screens
        .filter((screen) => screen.state === "default")
        .filter((screen) => {
          const previewRoute =
            screen.previewRoute ??
            resolveScreenPreviewRoute(
              screen.routePath,
              options.project.config.preview.routes,
            );
          return previewRoute.status === "unresolved";
        })
        .map((screen) => screen.routePath),
    ),
  ].sort();
  const checks: DoctorCheck[] = [
    check({
      id: "runtime.node-version",
      scope: "environment",
      title: "Node.js runtime",
      status:
        Number.isFinite(nodeMajor) && nodeMajor >= REQUIRED_NODE_MAJOR
          ? "pass"
          : "error",
      detail:
        Number.isFinite(nodeMajor) && nodeMajor >= REQUIRED_NODE_MAJOR
          ? `Node.js ${evidence.nodeVersion} satisfies Topo's Node.js ${REQUIRED_NODE_MAJOR}+ requirement.`
          : `Node.js ${evidence.nodeVersion} does not satisfy Topo's Node.js ${REQUIRED_NODE_MAJOR}+ requirement.`,
      action:
        Number.isFinite(nodeMajor) && nodeMajor >= REQUIRED_NODE_MAJOR
          ? undefined
          : "Install Node.js 24 LTS",
      evidence: {
        version: evidence.nodeVersion,
        requiredMajor: REQUIRED_NODE_MAJOR,
      },
    }),
    check({
      id: "runtime.playwright-browser",
      scope: "environment",
      title: "Playwright Chromium",
      status: evidence.browser.available ? "pass" : "warning",
      detail: evidence.browser.available
        ? `Chromium is available at ${evidence.browser.executablePath}.`
        : `Chromium is missing at ${evidence.browser.executablePath}.`,
      action: evidence.browser.available
        ? undefined
        : "pnpm exec playwright install chromium",
      evidence: {
        available: evidence.browser.available,
        executablePath: evidence.browser.executablePath,
        ...(evidence.browser.error ? { error: evidence.browser.error } : {}),
      },
    }),
    check({
      id: "security.daemon-loopback",
      scope: "security",
      title: "Loopback daemon",
      status: daemonIsLoopback ? "pass" : "error",
      detail: daemonIsLoopback
        ? `The daemon is bound to ${options.project.config.daemon.host}.`
        : `The daemon host ${options.project.config.daemon.host} is not loopback-only.`,
      action: daemonIsLoopback ? undefined : "Set daemon.host to 127.0.0.1",
      evidence: {
        host: options.project.config.daemon.host,
        loopback: daemonIsLoopback,
      },
    }),
    check({
      id: "security.preview-origin",
      scope: "security",
      title: "Preview origin",
      status: previewIsLoopback ? "pass" : "warning",
      detail: previewIsLoopback
        ? `${previewUrl.origin} is a loopback preview origin.`
        : `${previewUrl.origin} is not loopback; use a signed gateway when previewing remote applications.`,
      action: previewIsLoopback
        ? undefined
        : "Use a loopback preview URL or signed gateway",
      evidence: { origin: previewUrl.origin, loopback: previewIsLoopback },
    }),
    check({
      id: "application.preview-reachable",
      scope: "application",
      title: "Native preview server",
      status: evidence.preview.reachable ? "pass" : "warning",
      detail: evidence.preview.reachable
        ? `${previewUrl.origin} responded${evidence.preview.status ? ` with HTTP ${evidence.preview.status}` : ""} in ${evidence.preview.latencyMs} ms.`
        : `${previewUrl.origin} did not respond within the bounded Doctor probe.`,
      action: evidence.preview.reachable
        ? undefined
        : "Start the native application server",
      evidence: {
        origin: previewUrl.origin,
        reachable: evidence.preview.reachable,
        latencyMs: evidence.preview.latencyMs,
        ...(evidence.preview.status
          ? { httpStatus: evidence.preview.status }
          : {}),
        ...(evidence.preview.error ? { error: evidence.preview.error } : {}),
      },
    }),
    check({
      id: "application.source-selection",
      scope: "application",
      title: "Application source selection",
      status: ambiguousProjectRoot ? "warning" : "pass",
      detail: ambiguousProjectRoot
        ? `The project root produced ${frameworkFamilies.length} framework families; select one application source before treating this as one atlas.`
        : explicitSourceSelection
          ? `rootDir explicitly selects ${options.project.config.rootDir} as the application source.`
          : "The project root produced one application framework family.",
      action: ambiguousProjectRoot
        ? "Set rootDir in topo.config.ts to one application directory"
        : undefined,
      evidence: {
        configuredRootDir: options.project.config.rootDir,
        explicit: explicitSourceSelection,
        frameworkFamilies,
      },
    }),
    check({
      id: "application.framework",
      scope: "application",
      title: "Framework adapter",
      status: graph.framework === "unknown" ? "error" : "pass",
      detail:
        graph.framework === "unknown"
          ? "No supported framework adapter produced the application graph."
          : `${graph.framework} produced the current normalized graph.`,
      action:
        graph.framework === "unknown"
          ? "Configure a framework adapter"
          : undefined,
      evidence: { framework: graph.framework },
    }),
    check({
      id: "application.source-scan",
      scope: "application",
      title: "Source discovery",
      status: graph.screens.length > 0 ? "pass" : "warning",
      detail: `${graph.screens.length} screen(s) and ${graph.components.length} component(s) are present in the normalized graph.`,
      action:
        graph.screens.length > 0
          ? undefined
          : "Verify rootDir and framework routing files",
      evidence: {
        screens: graph.screens.length,
        components: graph.components.length,
        edges: graph.edges.length,
      },
    }),
    check({
      id: "application.preview-routes",
      scope: "application",
      title: "Parameterized route examples",
      status: unresolvedPreviewRoutes.length > 0 ? "warning" : "pass",
      detail:
        unresolvedPreviewRoutes.length > 0
          ? `${unresolvedPreviewRoutes.length} parameterized route(s) need concrete preview examples.`
          : "Every parameterized route has a concrete preview path.",
      action:
        unresolvedPreviewRoutes.length > 0
          ? "Add preview.routes entries in topo.config.ts"
          : undefined,
      evidence: {
        unresolvedRoutes: unresolvedPreviewRoutes,
        configuredRoutes: Object.keys(
          options.project.config.preview.routes,
        ).sort(),
      },
    }),
    check({
      id: "application.preview-profiles",
      scope: "application",
      title: "Preview profiles",
      status: options.project.config.profiles.length > 0 ? "pass" : "warning",
      detail: `${options.project.config.profiles.length} preview profile name(s) are configured; credentials are excluded from Doctor evidence.`,
      action:
        options.project.config.profiles.length > 0
          ? undefined
          : "Add an Anonymous preview profile",
      evidence: {
        count: options.project.config.profiles.length,
        names: options.project.config.profiles.map((profile) => profile.name),
        secretsIncluded: false,
      },
    }),
  ];
  const summary = {
    total: checks.length,
    passed: checks.filter((item) => item.status === "pass").length,
    warnings: checks.filter((item) => item.status === "warning").length,
    errors: checks.filter((item) => item.status === "error").length,
  };
  return DoctorReportSchema.parse({
    schemaVersion: 1,
    generatedAt: evidence.observedAt,
    projectRoot: options.project.projectRoot,
    sourceRoot: options.project.sourceRoot,
    ok: summary.errors === 0,
    summary,
    checks,
  });
}
