import path from "node:path";

import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
  type FrameworkAdapterContext,
} from "@topo/framework-adapter";

export interface ReactRouteDescriptor {
  filePath: string;
  routePath: string;
  source: "react-router" | "spa-entry";
}

const SCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ENTRY_CANDIDATES = [
  "src/main.tsx",
  "src/main.jsx",
  "src/index.tsx",
  "src/index.jsx",
  "src/App.tsx",
  "src/App.jsx",
  "main.tsx",
  "main.jsx",
  "App.tsx",
  "App.jsx",
] as const;

function normalizeRoutePath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("?") || trimmed.includes("#")) return;
  if (!trimmed.startsWith("/")) return;
  return trimmed === "/" ? "/" : trimmed.replace(/\/+$/, "");
}

function isRouteDeclarationFile(filePath: string): boolean {
  if (!SCRIPT_EXTENSIONS.has(path.posix.extname(filePath))) return false;
  const base = path.posix.basename(filePath, path.posix.extname(filePath));
  return (
    /^(app|main|index|router|routes)$/i.test(base) ||
    /(^|\/)routes?\//i.test(filePath)
  );
}

function staticRoutePaths(source: string): string[] {
  const values: string[] = [];
  for (const match of source.matchAll(
    /<Route\b[^>]*\bpath\s*=\s*(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/g,
  )) {
    values.push(match[1] ?? match[2] ?? "");
  }
  if (
    /create(?:Browser|Hash|Memory)Router|useRoutes\s*\(|RouteObject|\broutes\s*=/.test(
      source,
    )
  ) {
    for (const match of source.matchAll(/\bpath\s*:\s*["']([^"']+)["']/g)) {
      values.push(match[1] ?? "");
    }
  }
  return [
    ...new Set(values.map(normalizeRoutePath).filter(Boolean)),
  ] as string[];
}

function fallbackEntry(
  files: readonly { filePath: string }[],
): string | undefined {
  const paths = new Set(files.map(({ filePath }) => filePath));
  return ENTRY_CANDIDATES.find((candidate) => paths.has(candidate));
}

export async function discoverReactRoutes(
  context: FrameworkAdapterContext,
): Promise<ReactRouteDescriptor[]> {
  const candidates = context.files.filter(({ filePath }) =>
    isRouteDeclarationFile(filePath),
  );
  const sources = await Promise.all(
    candidates.map(async ({ filePath }) => ({
      filePath,
      source: await context.readFile(filePath),
    })),
  );
  const routes = new Map<string, ReactRouteDescriptor>();
  for (const candidate of sources) {
    for (const routePath of staticRoutePaths(candidate.source)) {
      routes.set(routePath, {
        filePath: candidate.filePath,
        routePath,
        source: "react-router",
      });
    }
  }
  if (routes.size === 0) {
    const filePath = fallbackEntry(context.files);
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

function ownsReactWorkspace(packageNames: ReadonlySet<string>): boolean {
  if (!packageNames.has("react")) return false;
  return ![
    "next",
    "@tanstack/react-router",
    "@tanstack/react-start",
    "@tanstack/start",
  ].some((name) => packageNames.has(name));
}

export const reactFrameworkAdapter = defineFrameworkAdapter({
  apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
  id: "topo.react",
  displayName: "React",
  async detect(context) {
    if (!ownsReactWorkspace(context.packageNames)) return [];
    const routes = await discoverReactRoutes(context);
    const usesRouter =
      context.packageNames.has("react-router") ||
      context.packageNames.has("react-router-dom") ||
      context.packageNames.has("@react-router/dev") ||
      routes.some((route) => route.source === "react-router");
    return [
      {
        framework: usesRouter ? "react-router" : "react",
        confidence: 1,
        reasons: usesRouter
          ? [
              "react dependency",
              "React Router dependency or static route declarations",
            ]
          : ["react dependency", "concrete React application entry"],
      },
    ];
  },
  async scan(context, matches) {
    const framework = matches[0]?.framework ?? "react";
    return {
      routes: (await discoverReactRoutes(context)).map((route) => ({
        framework,
        filePath: route.filePath,
        routePath: route.routePath,
        state: "default" as const,
        group: route.source === "react-router" ? "React Router" : "Application",
        tags: [route.source],
      })),
    };
  },
});
