import path from "node:path";

import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
} from "@topo/framework-adapter";
import type { ScreenState } from "@topo/schema";

export interface TanStackRouteDescriptor {
  filePath: string;
  routePath: string;
  state: ScreenState;
  source: "file" | "generated-tree";
}

function normalizeRoutePath(routePath: string): string {
  if (!routePath || routePath === "/") return "/";
  const normalized = (routePath.startsWith("/") ? routePath : `/${routePath}`)
    .split("/")
    .map((segment) =>
      segment === "$"
        ? "*"
        : segment.startsWith("$")
          ? `:${segment.slice(1)}`
          : segment,
    )
    .join("/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function descriptorFromFile(
  filePath: string,
  root: string,
): TanStackRouteDescriptor | undefined {
  const relative = filePath.slice(root.length + 1);
  const extension = path.extname(relative);
  const fileName = relative.slice(0, -extension.length).replace(/[\\/]/g, ".");
  if (
    !extension ||
    fileName === "__root" ||
    fileName === "routeTree.gen" ||
    fileName.includes("-pending") ||
    fileName.includes("-error") ||
    fileName.split(".").some((segment) => segment.startsWith("-"))
  )
    return undefined;
  const segments = fileName
    .split(".")
    .filter(
      (segment) =>
        segment !== "route" &&
        segment !== "index" &&
        !segment.startsWith("_") &&
        !(segment.startsWith("(") && segment.endsWith(")")),
    )
    .map((segment) => segment.replace(/_$/, ""))
    .map((segment) =>
      segment === "$"
        ? "*"
        : segment.startsWith("$")
          ? `:${segment.slice(1)}`
          : segment,
    )
    .filter(Boolean);
  if (segments.length === 0 && !fileName.split(".").includes("index")) {
    return undefined;
  }
  return {
    filePath,
    routePath: normalizeRoutePath(segments.join("/")),
    state: "default",
    source: "file",
  };
}

export function discoverTanStackRoutes(
  filePaths: string[],
  generatedTreeSource?: string,
): TanStackRouteDescriptor[] {
  const generatedFilePath =
    filePaths.find((filePath) => filePath.endsWith("routeTree.gen.ts")) ??
    "routeTree.gen.ts";
  if (generatedTreeSource) {
    const fullPaths = [
      ...generatedTreeSource.matchAll(/\bfullPath\s*:\s*["'`]([^"'`]+)["'`]/g),
    ]
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value));
    const generatedPaths =
      fullPaths.length > 0
        ? fullPaths
        : [...generatedTreeSource.matchAll(/\bpath\s*:\s*["'`]([^"'`]+)["'`]/g)]
            .map((match) => match[1])
            .filter((value): value is string => Boolean(value));
    if (generatedPaths.length > 0) {
      const seen = new Set<string>();
      return generatedPaths
        .map((routePath) => normalizeRoutePath(routePath))
        .filter((routePath) => {
          if (seen.has(routePath)) return false;
          seen.add(routePath);
          return true;
        })
        .map((routePath) => ({
          filePath: generatedFilePath,
          routePath,
          state: "default",
          source: "generated-tree",
        }));
    }
  }

  const descriptors: TanStackRouteDescriptor[] = [];
  for (const filePath of [...filePaths].sort()) {
    const segments = filePath.split("/");
    const routesIndex = segments.indexOf("routes");
    if (routesIndex < 0) continue;
    const descriptor = descriptorFromFile(
      filePath,
      segments.slice(0, routesIndex + 1).join("/"),
    );
    if (descriptor) descriptors.push(descriptor);
  }

  const seen = new Set<string>();
  return descriptors.filter((descriptor) => {
    const key = `${descriptor.routePath}:${descriptor.state}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const tanStackFrameworkAdapter = defineFrameworkAdapter({
  apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
  id: "topo.tanstack",
  displayName: "TanStack Router / Start",
  detect(context) {
    const startPackage = context.packageNames.has("@tanstack/react-start")
      ? "@tanstack/react-start"
      : context.packageNames.has("@tanstack/start")
        ? "@tanstack/start"
        : undefined;
    const hasStartPackage = Boolean(startPackage);
    const hasRouterPackage = context.packageNames.has("@tanstack/react-router");
    const hasRouteFiles = context.files.some(
      ({ filePath }) =>
        /(^|\/)routeTree\.gen\.(?:js|jsx|ts|tsx)$/.test(filePath) ||
        /(^|\/)routes\/__root\.(?:js|jsx|ts|tsx)$/.test(filePath),
    );
    if (!hasStartPackage && !hasRouterPackage && !hasRouteFiles) return [];

    const framework = hasStartPackage
      ? ("tanstack-start" as const)
      : ("tanstack-router" as const);
    const reasons = [
      ...(startPackage ? [`${startPackage} dependency`] : []),
      ...(hasRouterPackage ? ["@tanstack/react-router dependency"] : []),
      ...(hasRouteFiles ? ["TanStack route files"] : []),
    ];
    return [
      {
        framework,
        confidence: hasStartPackage || hasRouterPackage ? 1 : 0.85,
        reasons,
      },
    ];
  },
  async scan(context, matches) {
    const generatedTree = context.files.find((file) =>
      file.filePath.endsWith("routeTree.gen.ts"),
    );
    const generatedTreeSource = generatedTree
      ? await context.readFile(generatedTree.filePath)
      : undefined;
    const framework = matches[0]?.framework ?? "tanstack-router";
    return {
      routes: discoverTanStackRoutes(
        context.files.map((file) => file.filePath),
        generatedTreeSource,
      ).map((descriptor) => ({
        framework,
        filePath: descriptor.filePath,
        routePath: descriptor.routePath,
        state: descriptor.state,
        tags: [`tanstack-${descriptor.source}`],
      })),
    };
  },
});
