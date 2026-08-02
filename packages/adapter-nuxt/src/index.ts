import path from "node:path";

import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
} from "@topo/framework-adapter";

export interface NuxtRouteDescriptor {
  filePath: string;
  routePath: string;
  state: "default" | "error";
  source: "pages" | "app-entry" | "error-boundary";
}

const PAGE_EXTENSIONS = new Set([".vue", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const APP_ENTRIES = ["app/app.vue", "app.vue", "src/app.vue"] as const;

function transformSegment(segment: string): string | undefined {
  if (!segment || segment === "index" || /^\(.+\)$/.test(segment)) return;
  if (segment.startsWith("-")) return;
  return segment
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, ":$1(.*)*")
    .replace(/\[\.\.\.([^\]]+)\]/g, ":$1(.*)*")
    .replace(/\[\[([^\]]+)\]\]/g, ":$1?")
    .replace(/\[([^\]]+)\]/g, ":$1");
}

function pageDescriptor(filePath: string): NuxtRouteDescriptor | undefined {
  const extension = path.posix.extname(filePath);
  if (!PAGE_EXTENSIONS.has(extension)) return;
  const segments = filePath.split("/");
  const pagesIndex = segments.lastIndexOf("pages");
  if (pagesIndex < 0) return;
  const relative = segments.slice(pagesIndex + 1);
  if (relative.length === 0) return;
  const base = relative.at(-1)?.slice(0, -extension.length) ?? "";
  const withoutMode = base.replace(/\.(?:client|server)$/, "");
  if (withoutMode.startsWith("-")) return;
  relative[relative.length - 1] = withoutMode;
  const routeSegments = relative
    .map(transformSegment)
    .filter((segment): segment is string => Boolean(segment));
  return {
    filePath,
    routePath: routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`,
    state: "default",
    source: "pages",
  };
}

function globalErrorDescriptor(
  filePath: string,
): NuxtRouteDescriptor | undefined {
  if (!/(^|\/)error\.vue$/.test(filePath) || filePath.includes("/pages/"))
    return;
  return {
    filePath,
    routePath: "/",
    state: "error",
    source: "error-boundary",
  };
}

export function discoverNuxtRoutes(
  filePaths: readonly string[],
): NuxtRouteDescriptor[] {
  const descriptors = [...filePaths].sort().flatMap((filePath) => {
    const page = pageDescriptor(filePath);
    const error = globalErrorDescriptor(filePath);
    return page ? [page] : error ? [error] : [];
  });
  if (!descriptors.some(({ state }) => state === "default")) {
    const paths = new Set(filePaths);
    const filePath = APP_ENTRIES.find((candidate) => paths.has(candidate));
    if (filePath) {
      descriptors.push({
        filePath,
        routePath: "/",
        state: "default",
        source: "app-entry",
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

export const nuxtFrameworkAdapter = defineFrameworkAdapter({
  apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
  id: "topo.nuxt",
  displayName: "Nuxt",
  detect(context) {
    const hasPackage = context.packageNames.has("nuxt");
    const hasConfig = context.files.some(({ filePath }) =>
      /(^|\/)nuxt\.config\.(?:js|mjs|ts)$/.test(filePath),
    );
    // A `pages` directory is not Nuxt-specific (Next.js uses the same name),
    // so source-only detection must require an explicit Nuxt project marker.
    if (!hasPackage && !hasConfig) return [];
    return [
      {
        framework: "nuxt",
        confidence: hasPackage ? 1 : 0.9,
        reasons: hasPackage
          ? ["nuxt dependency", "Nuxt pages or application entry"]
          : ["Nuxt configuration or pages"],
      },
    ];
  },
  scan(context) {
    return {
      routes: discoverNuxtRoutes(
        context.files.map(({ filePath }) => filePath),
      ).map((route) => ({
        framework: "nuxt",
        filePath: route.filePath,
        routePath: route.routePath,
        state: route.state,
        group: route.source === "pages" ? "Nuxt pages" : "Nuxt application",
        tags: [`nuxt-${route.source}`],
      })),
    };
  },
});
