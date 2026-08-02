import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
} from "@topo/framework-adapter";
import type { ScreenState } from "@topo/schema";

export interface NextRouteDescriptor {
  filePath: string;
  routePath: string;
  state: ScreenState;
  router: "app" | "pages";
}

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mdx"]);

function stateForFile(fileName: string): ScreenState | undefined {
  switch (fileName) {
    case "page":
      return "default";
    case "loading":
      return "loading";
    case "error":
      return "error";
    case "not-found":
      return "not-found";
    default:
      return undefined;
  }
}

function routeSegments(segments: string[]): string[] {
  return segments.filter(
    (segment) =>
      !segment.startsWith("(") && !segment.startsWith("@") && segment !== "_",
  );
}

function appDescriptor(
  filePath: string,
  relative: string,
): NextRouteDescriptor | undefined {
  const slashIndex = relative.lastIndexOf("/");
  const dotIndex = relative.lastIndexOf(".");
  if (dotIndex <= slashIndex) return undefined;
  const extension = relative.slice(dotIndex);
  if (!SOURCE_EXTENSIONS.has(extension)) return undefined;
  const state = stateForFile(relative.slice(slashIndex + 1, dotIndex));
  if (!state) return undefined;
  const directory = slashIndex < 0 ? "" : relative.slice(0, slashIndex);
  const segments = directory ? routeSegments(directory.split("/")) : [];
  return {
    filePath,
    routePath: segments.length === 0 ? "/" : `/${segments.join("/")}`,
    state,
    router: "app",
  };
}

function pagesDescriptor(
  filePath: string,
  relative: string,
): NextRouteDescriptor | undefined {
  const slashIndex = relative.lastIndexOf("/");
  const dotIndex = relative.lastIndexOf(".");
  if (dotIndex <= slashIndex) return undefined;
  const extension = relative.slice(dotIndex);
  if (!SOURCE_EXTENSIONS.has(extension)) return undefined;
  const withoutExtension = relative.slice(0, -extension.length);
  const segments = withoutExtension.split("/");
  const fileName = segments.at(-1) ?? "";
  if (fileName.startsWith("_") || segments[0] === "api") return undefined;
  const routeSegmentsForPages = segments
    .map((segment) => (segment === "index" ? "" : segment))
    .filter(Boolean);
  return {
    filePath,
    routePath:
      routeSegmentsForPages.length === 0
        ? "/"
        : `/${routeSegmentsForPages.join("/")}`,
    state: fileName === "404" ? "not-found" : "default",
    router: "pages",
  };
}

function relativeAfterDirectory(
  filePath: string,
  directory: "app" | "pages",
): string | undefined {
  const rootPrefix = `${directory}/`;
  if (filePath.startsWith(rootPrefix)) return filePath.slice(rootPrefix.length);
  const marker = `/${directory}/`;
  const index = filePath.indexOf(marker);
  return index < 0 ? undefined : filePath.slice(index + marker.length);
}

export function discoverNextRoutes(filePaths: string[]): NextRouteDescriptor[] {
  const descriptors: NextRouteDescriptor[] = [];
  for (const filePath of filePaths) {
    const appRelative = relativeAfterDirectory(filePath, "app");
    if (appRelative !== undefined) {
      const descriptor = appDescriptor(filePath, appRelative);
      if (descriptor) descriptors.push(descriptor);
      continue;
    }
    const pagesRelative = relativeAfterDirectory(filePath, "pages");
    if (pagesRelative !== undefined) {
      const descriptor = pagesDescriptor(filePath, pagesRelative);
      if (descriptor) descriptors.push(descriptor);
    }
  }
  return descriptors.sort((left, right) =>
    left.filePath < right.filePath ? -1 : left.filePath > right.filePath ? 1 : 0,
  );
}

export const nextFrameworkAdapter = defineFrameworkAdapter({
  apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
  id: "topo.next",
  displayName: "Next.js",
  detect(context) {
    const descriptors = discoverNextRoutes(
      context.files.map((file) => file.filePath),
    );
    const routers = new Set(descriptors.map((descriptor) => descriptor.router));
    const hasNextPackage = context.packageNames.has("next");
    const matches = [];

    if (routers.has("app")) {
      matches.push({
        framework: "next-app" as const,
        confidence: hasNextPackage ? 1 : 0.9,
        reasons: hasNextPackage
          ? ["next dependency", "App Router route files"]
          : ["App Router route files"],
      });
    }
    if (routers.has("pages")) {
      matches.push({
        framework: "next-pages" as const,
        confidence: hasNextPackage ? 1 : 0.9,
        reasons: hasNextPackage
          ? ["next dependency", "Pages Router route files"]
          : ["Pages Router route files"],
      });
    }
    if (matches.length === 0 && hasNextPackage) {
      matches.push({
        framework: "next-app" as const,
        confidence: 0.7,
        reasons: ["next dependency"],
      });
    }

    return matches;
  },
  scan(context) {
    return {
      routes: discoverNextRoutes(
        context.files.map((file) => file.filePath),
      ).map((descriptor) => ({
        framework:
          descriptor.router === "pages"
            ? ("next-pages" as const)
            : ("next-app" as const),
        filePath: descriptor.filePath,
        routePath: descriptor.routePath,
        state: descriptor.state,
        tags: [`next-${descriptor.router}`],
      })),
    };
  },
});
