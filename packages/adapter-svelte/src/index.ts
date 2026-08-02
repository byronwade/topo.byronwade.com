import path from "node:path";

import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
} from "@topo/framework-adapter";

export interface SvelteRouteDescriptor {
  filePath: string;
  routePath: string;
  state: "default" | "error";
  source: "sveltekit" | "spa-entry";
}

const ENTRY_CANDIDATES = ["src/App.svelte", "App.svelte"] as const;

function transformSegment(segment: string): string | undefined {
  if (!segment || /^\(.+\)$/.test(segment)) return;
  return segment
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, ":$1(.*)*")
    .replace(/\[\.\.\.([^\]]+)\]/g, ":$1(.*)*")
    .replace(/\[\[([^\]]+)\]\]/g, ":$1?")
    .replace(/\[([^\]=]+)(?:=[^\]]+)?\]/g, ":$1");
}

function kitDescriptor(filePath: string): SvelteRouteDescriptor | undefined {
  const segments = filePath.split("/");
  const routesIndex = segments.lastIndexOf("routes");
  if (routesIndex < 0) return;
  const fileName = segments.at(-1) ?? "";
  const state = /^\+page(?:@[^.]+)?\.svelte$/.test(fileName)
    ? "default"
    : /^\+error\.svelte$/.test(fileName)
      ? "error"
      : undefined;
  if (!state) return;
  const routeSegments = segments
    .slice(routesIndex + 1, -1)
    .map(transformSegment)
    .filter((segment): segment is string => Boolean(segment));
  return {
    filePath,
    routePath: routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`,
    state,
    source: "sveltekit",
  };
}

export function discoverSvelteRoutes(
  filePaths: readonly string[],
): SvelteRouteDescriptor[] {
  const descriptors = [...filePaths]
    .sort()
    .map(kitDescriptor)
    .filter((route): route is SvelteRouteDescriptor => Boolean(route));
  if (descriptors.length === 0) {
    const paths = new Set(filePaths);
    const filePath = ENTRY_CANDIDATES.find((candidate) => paths.has(candidate));
    if (filePath) {
      descriptors.push({
        filePath,
        routePath: "/",
        state: "default",
        source: "spa-entry",
      });
    }
  }
  return descriptors.sort(
    (left, right) =>
      left.routePath.localeCompare(right.routePath) ||
      left.state.localeCompare(right.state) ||
      left.filePath.localeCompare(right.filePath),
  );
}

export const svelteFrameworkAdapter = defineFrameworkAdapter({
  apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
  id: "topo.svelte",
  displayName: "Svelte",
  detect(context) {
    const hasKit = context.packageNames.has("@sveltejs/kit");
    const hasSvelte = context.packageNames.has("svelte");
    const routes = discoverSvelteRoutes(
      context.files.map(({ filePath }) => filePath),
    );
    if (!hasKit && !hasSvelte && routes.length === 0) return [];
    return [
      {
        framework:
          hasKit || routes.some((route) => route.source === "sveltekit")
            ? "sveltekit"
            : "svelte",
        confidence: hasKit || hasSvelte ? 1 : 0.9,
        reasons: hasKit
          ? ["@sveltejs/kit dependency", "SvelteKit route files"]
          : hasSvelte
            ? ["svelte dependency", "Svelte application entry"]
            : ["SvelteKit route files"],
      },
    ];
  },
  scan(context, matches) {
    const framework = matches[0]?.framework ?? "svelte";
    return {
      routes: discoverSvelteRoutes(
        context.files.map(({ filePath }) => filePath),
      ).map((route) => ({
        framework,
        filePath: route.filePath,
        routePath: route.routePath,
        state: route.state,
        group:
          route.source === "sveltekit" ? "SvelteKit routes" : "Application",
        tags: [route.source],
      })),
    };
  },
});
