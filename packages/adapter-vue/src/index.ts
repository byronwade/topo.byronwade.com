import path from "node:path";

import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
  type FrameworkAdapterContext,
} from "@topo/framework-adapter";

export interface VueRouteDescriptor {
  filePath: string;
  routePath: string;
  source: "vue-router" | "spa-entry";
}

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
  ".vue",
]);
const ENTRY_CANDIDATES = [
  "src/App.vue",
  "src/main.ts",
  "src/main.js",
  "App.vue",
  "main.ts",
  "main.js",
] as const;

function routePath(value: string): string | undefined {
  const trimmed = value.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    return;
  }
  return trimmed === "/" ? "/" : trimmed.replace(/\/+$/, "");
}

function candidateFile(filePath: string): boolean {
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(filePath))) return false;
  const base = path.posix.basename(filePath, path.posix.extname(filePath));
  return (
    /^(app|main|index|router|routes)$/i.test(base) ||
    /(^|\/)routes?\//i.test(filePath)
  );
}

function staticPaths(source: string): string[] {
  if (
    !/createRouter\s*\(|RouteRecordRaw|\broutes\s*=|\broutes\s*:/.test(source)
  ) {
    return [];
  }
  return [
    ...new Set(
      [...source.matchAll(/\bpath\s*:\s*["']([^"']+)["']/g)]
        .map((match) => routePath(match[1] ?? ""))
        .filter(Boolean),
    ),
  ] as string[];
}

export async function discoverVueRoutes(
  context: FrameworkAdapterContext,
): Promise<VueRouteDescriptor[]> {
  const candidates = context.files.filter(({ filePath }) =>
    candidateFile(filePath),
  );
  const sources = await Promise.all(
    candidates.map(async ({ filePath }) => ({
      filePath,
      source: await context.readFile(filePath),
    })),
  );
  const routes = new Map<string, VueRouteDescriptor>();
  for (const candidate of sources) {
    for (const discoveredPath of staticPaths(candidate.source)) {
      routes.set(discoveredPath, {
        filePath: candidate.filePath,
        routePath: discoveredPath,
        source: "vue-router",
      });
    }
  }
  if (routes.size === 0) {
    const paths = new Set(context.files.map(({ filePath }) => filePath));
    const filePath = ENTRY_CANDIDATES.find((candidate) => paths.has(candidate));
    if (filePath) {
      routes.set("/", { filePath, routePath: "/", source: "spa-entry" });
    }
  }
  return [...routes.values()].sort(
    (left, right) =>
      left.routePath.localeCompare(right.routePath) ||
      left.filePath.localeCompare(right.filePath),
  );
}

export const vueFrameworkAdapter = defineFrameworkAdapter({
  apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
  id: "topo.vue",
  displayName: "Vue",
  async detect(context) {
    if (!context.packageNames.has("vue") || context.packageNames.has("nuxt")) {
      return [];
    }
    const routes = await discoverVueRoutes(context);
    const usesRouter =
      context.packageNames.has("vue-router") ||
      routes.some((route) => route.source === "vue-router");
    return [
      {
        framework: usesRouter ? "vue-router" : "vue",
        confidence: 1,
        reasons: usesRouter
          ? [
              "vue dependency",
              "Vue Router dependency or static route declarations",
            ]
          : ["vue dependency", "concrete Vue application entry"],
      },
    ];
  },
  async scan(context, matches) {
    const framework = matches[0]?.framework ?? "vue";
    return {
      routes: (await discoverVueRoutes(context)).map((route) => ({
        framework,
        filePath: route.filePath,
        routePath: route.routePath,
        state: "default" as const,
        group: route.source === "vue-router" ? "Vue Router" : "Application",
        tags: [route.source],
      })),
    };
  },
});
