import path from "node:path";

import {
  API_ENDPOINT_ADAPTER_VERSION,
  defineApiEndpointAdapter,
  type ApiEndpointAdapterContext,
  type DiscoveredApiEndpoint,
} from "@topo/endpoint-adapter";
import { HTTP_METHODS, type HttpMethod, type SourceReadIssue } from "@topo/schema";

const CODE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const STANDARD_METHODS = HTTP_METHODS.filter(
  (method): method is Exclude<HttpMethod, "ANY"> => method !== "ANY",
);
const METHOD_PATTERN = "get|post|put|patch|delete|head|options|trace|connect";

type LineAt = (index: number) => number;

function createLineLookup(source: string): LineAt {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return (index) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((starts[middle] ?? 0) <= index) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, low);
  };
}

function normalizeHttpPath(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function joinHttpPath(prefix: string, suffix: string): string {
  return normalizeHttpPath(`${prefix}/${suffix}`);
}

function fileRouteSegments(value: string): string[] {
  return value
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .filter((segment) => !segment.startsWith("@"))
    .filter((segment) => !segment.startsWith("_"))
    .map((segment) => segment.replace(/^\[\.\.\.(.+)\]$/, "{$1+}"))
    .map((segment) => segment.replace(/^\[\[\.\.\.(.+)\]\]$/, "{$1*}"))
    .map((segment) => segment.replace(/^\[(.+)\]$/, "{$1}"));
}

function sourceEndpoint(
  filePath: string,
  index: number,
  method: HttpMethod,
  endpointPath: string,
  framework: string,
  confidence: number,
  discoveryKind: "framework-source" | "router-source" = "framework-source",
  lineAt: LineAt = () => 1,
): DiscoveredApiEndpoint {
  return {
    protocol: "http",
    method,
    path: normalizeHttpPath(endpointPath),
    title: `${method} ${normalizeHttpPath(endpointPath)}`,
    source: { filePath, line: lineAt(index) },
    discoveryKind,
    framework,
    confidence,
    security: { status: "unknown", schemes: [] },
  };
}

function exportedMethods(source: string): { method: HttpMethod; index: number }[] {
  const result: { method: HttpMethod; index: number }[] = [];
  const pattern = /export\s+(?:async\s+)?(?:function\s+|const\s+|let\s+|var\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT|fallback)\b/g;
  for (const match of source.matchAll(pattern)) {
    result.push({
      method: match[1] === "fallback" ? "ANY" : (match[1] as HttpMethod),
      index: match.index,
    });
  }
  return result;
}

function nextAppEndpoints(filePath: string, source: string, lineAt: LineAt): DiscoveredApiEndpoint[] {
  const match = /(?:^|\/)app\/(.+\/)?route\.[cm]?[jt]sx?$/.exec(filePath);
  if (!match) return [];
  const endpointPath = `/${fileRouteSegments(match[1] ?? "").join("/")}`;
  return exportedMethods(source).map(({ method, index }) =>
    sourceEndpoint(filePath, index, method, endpointPath, "next-app", 1, "framework-source", lineAt),
  );
}

function nextPagesEndpoints(filePath: string, source: string, lineAt: LineAt): DiscoveredApiEndpoint[] {
  const match = /(?:^|\/)pages\/api\/(.+)\.[cm]?[jt]sx?$/.exec(filePath);
  if (!match || /(?:^|\/)pages\/api\/_/.test(filePath)) return [];
  const routeFile = (match[1] ?? "").replace(/\/index$/, "");
  const endpointPath = `/api/${fileRouteSegments(routeFile).join("/")}`.replace(/\/$/, "");
  const explicit = [...source.matchAll(/(?:(?:req|request)\.method\s*(?:===?|!==?)\s*|case\s*)["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)["']/gi)]
    .map((item) => ({ method: item[1]!.toUpperCase() as HttpMethod, index: item.index }));
  const methods = explicit.length > 0 ? explicit : [{ method: "ANY" as const, index: 0 }];
  return [...new Map(methods.map((item) => [item.method, item])).values()].map(
    ({ method, index }) => sourceEndpoint(filePath, index, method, endpointPath || "/api", "next-pages", explicit.length > 0 ? 0.95 : 0.75, "framework-source", lineAt),
  );
}

function nuxtEndpoints(filePath: string, source: string, lineAt: LineAt): DiscoveredApiEndpoint[] {
  const match = /(?:^|\/)server\/(api|routes)\/(.+?)(?:\.([a-z]+))?\.[cm]?[jt]s$/.exec(filePath);
  if (!match) return [];
  const methodValue = match[3]?.toUpperCase() ?? "ANY";
  if (methodValue !== "ANY" && !STANDARD_METHODS.includes(methodValue as Exclude<HttpMethod, "ANY">)) return [];
  const routeFile = (match[2] ?? "").replace(/\/index$/, "");
  const route = `/${fileRouteSegments(routeFile).join("/")}`;
  const endpointPath = match[1] === "api" ? joinHttpPath("/api", route) : normalizeHttpPath(route);
  return [sourceEndpoint(filePath, 0, methodValue as HttpMethod, endpointPath, "nuxt", methodValue === "ANY" ? 0.8 : 1, "framework-source", lineAt)];
}

function svelteEndpoints(filePath: string, source: string, lineAt: LineAt): DiscoveredApiEndpoint[] {
  const match = /(?:^|\/)src\/routes\/(.*\/)?\+server\.[jt]s$/.exec(filePath);
  if (!match) return [];
  const endpointPath = `/${fileRouteSegments((match[1] ?? "").replace(/\/$/, "")).join("/")}`;
  return exportedMethods(source).map(({ method, index }) =>
    sourceEndpoint(filePath, index, method, endpointPath, "sveltekit", 1, "framework-source", lineAt),
  );
}

function hasRouterEvidence(context: ApiEndpointAdapterContext, source: string): boolean {
  const packages = ["express", "hono", "fastify", "@nestjs/common"];
  return packages.some(
    (packageName) => context.packageNames.has(packageName) || source.includes(`from \"${packageName}`) || source.includes(`from '${packageName}`) || source.includes(`require(\"${packageName}`) || source.includes(`require('${packageName}`),
  );
}

function literalRouterEndpoints(filePath: string, source: string, lineAt: LineAt): DiscoveredApiEndpoint[] {
  const endpoints: DiscoveredApiEndpoint[] = [];
  const pattern = new RegExp(`\\.(${METHOD_PATTERN}|all)\\(\\s*([\"'\\\`])([^\"'\\\`]+)\\2`, "gi");
  for (const match of source.matchAll(pattern)) {
    const method = match[1]!.toUpperCase() === "ALL" ? "ANY" : match[1]!.toUpperCase() as HttpMethod;
    endpoints.push(sourceEndpoint(filePath, match.index, method, match[3]!, "router", 0.9, "router-source", lineAt));
  }
  const honoOn = /\.on\(\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\s*,\s*(["'])([^"']+)\2/gi;
  for (const match of source.matchAll(honoOn)) {
    endpoints.push(sourceEndpoint(filePath, match.index, match[1]!.toUpperCase() as HttpMethod, match[3]!, "hono", 0.95, "router-source", lineAt));
  }
  const fastifyRoute = /\.route\(\s*\{[\s\S]{0,800}?method\s*:\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'][\s\S]{0,800}?(?:url|path)\s*:\s*(["'])([^"']+)\2[\s\S]{0,800}?\}\s*\)/gi;
  for (const match of source.matchAll(fastifyRoute)) {
    endpoints.push(sourceEndpoint(filePath, match.index, match[1]!.toUpperCase() as HttpMethod, match[3]!, "fastify", 0.95, "router-source", lineAt));
  }
  return endpoints;
}

function nestEndpoints(filePath: string, source: string, lineAt: LineAt): DiscoveredApiEndpoint[] {
  if (!source.includes("@Controller")) return [];
  const controller = /@Controller\(\s*(?:(["'])([^"']*)\1)?\s*\)/.exec(source);
  const prefix = controller?.[2] ?? "";
  const endpoints: DiscoveredApiEndpoint[] = [];
  const pattern = /@(Get|Post|Put|Patch|Delete|Head|Options)\(\s*(?:(["'])([^"']*)\2)?\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    endpoints.push(sourceEndpoint(filePath, match.index, match[1]!.toUpperCase() as HttpMethod, joinHttpPath(prefix, match[3] ?? ""), "nestjs", 0.98, "framework-source", lineAt));
  }
  return endpoints;
}

function unresolvedRouterIssues(filePath: string, source: string, lineAt: LineAt): SourceReadIssue[] {
  const pattern = new RegExp(`\\.(${METHOD_PATTERN}|all)\\(\\s*(?![\"'\\\`])([^,\\n)]+)`, "gi");
  const matches = [...source.matchAll(pattern)];
  return matches.slice(0, 20).map((match) => ({
    filePath,
    message: `API registration at line ${lineAt(match.index)} uses computed path ${match[2]?.trim() || "<unknown>"}; Topo only records literal paths automatically.`,
  }));
}

async function scanSourceEndpoints(context: ApiEndpointAdapterContext) {
  const candidates = context.files.filter((file) => CODE_EXTENSIONS.has(file.extension));
  const scanned = await Promise.all(candidates.map(async (file) => {
    const source = await context.readFile(file.filePath);
    const lineAt = createLineLookup(source);
    const conventional = [
      ...nextAppEndpoints(file.filePath, source, lineAt),
      ...nextPagesEndpoints(file.filePath, source, lineAt),
      ...nuxtEndpoints(file.filePath, source, lineAt),
      ...svelteEndpoints(file.filePath, source, lineAt),
    ];
    const routerEvidence = hasRouterEvidence(context, source);
    return {
      endpoints: [
        ...conventional,
        ...(routerEvidence ? literalRouterEndpoints(file.filePath, source, lineAt) : []),
        ...(routerEvidence ? nestEndpoints(file.filePath, source, lineAt) : []),
      ],
      issues: routerEvidence ? unresolvedRouterIssues(file.filePath, source, lineAt) : [],
    };
  }));
  return {
    endpoints: scanned.flatMap((item) => item.endpoints),
    issues: scanned.flatMap((item) => item.issues),
  };
}

export const sourceApiEndpointAdapter = defineApiEndpointAdapter({
  apiVersion: API_ENDPOINT_ADAPTER_VERSION,
  id: "source-api",
  displayName: "Framework and router source APIs",
  scan: scanSourceEndpoints,
});
