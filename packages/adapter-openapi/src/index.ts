import path from "node:path";

import {
  API_ENDPOINT_ADAPTER_VERSION,
  defineApiEndpointAdapter,
  type ApiEndpointAdapterContext,
  type DiscoveredApiEndpoint,
} from "@topo/endpoint-adapter";
import type {
  ApiEndpointParameter,
  ApiEndpointResponse,
  HttpMethod,
  SourceReadIssue,
} from "@topo/schema";
import { parse as parseYaml } from "yaml";

const SPEC_FILE = /^(?:openapi|swagger)(?:[._-][^.]+)*\.(?:json|ya?ml)$/i;
const OPERATIONS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function createOperationLocator(source: string) {
  // Compact generated JSON is common and every operation is on line one. Avoid
  // lowercasing and repeatedly searching a multi-megabyte contract in that case.
  if (!source.includes("\n")) return () => 1;
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  const lowerSource = source.toLowerCase();
  let cursor = 0;
  const lineAt = (index: number): number => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((starts[middle] ?? 0) <= index) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, low);
  };
  return (endpointPath: string, method: string): number => {
    let pathIndex = source.indexOf(endpointPath, cursor);
    if (pathIndex < 0) pathIndex = source.indexOf(endpointPath);
    const start = Math.max(0, pathIndex);
    let methodIndex = lowerSource.indexOf(method.toLowerCase(), start);
    if (methodIndex < 0) methodIndex = start;
    cursor = methodIndex + method.length;
    return lineAt(methodIndex);
  };
}

function parameters(value: unknown): ApiEndpointParameter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ApiEndpointParameter[] => {
    const parameter = objectValue(item);
    if (!parameter) return [];
    const name = parameter?.name;
    const location = parameter?.in;
    if (
      typeof name !== "string" ||
      !["path", "query", "header", "cookie"].includes(String(location))
    ) return [];
    const schema = objectValue(parameter.schema);
    return [{
      name,
      in: location as ApiEndpointParameter["in"],
      required: location === "path" || parameter.required === true,
      ...(typeof parameter.description === "string" && parameter.description ? { description: parameter.description } : {}),
      ...(schema ? { schema } : {}),
    }];
  });
}

function contentTypes(value: unknown): string[] {
  return Object.keys(objectValue(value) ?? {}).sort();
}

function responseList(value: unknown): ApiEndpointResponse[] {
  const responseObject = objectValue(value);
  if (!responseObject) return [];
  return Object.entries(responseObject).flatMap(([status, rawResponse]) => {
    const response = objectValue(rawResponse);
    if (!response) return [];
    return [{
      status,
      ...(typeof response.description === "string" && response.description ? { description: response.description } : {}),
      contentTypes: contentTypes(response.content),
    }];
  });
}

function security(value: unknown, inherited: unknown): DiscoveredApiEndpoint["security"] {
  const effective = value === undefined ? inherited : value;
  if (effective === undefined) return { status: "unknown", schemes: [] };
  if (Array.isArray(effective) && effective.length === 0) return { status: "none", schemes: [] };
  if (Array.isArray(effective)) {
    return {
      status: "declared",
      schemes: [...new Set(effective.flatMap((item) => Object.keys(objectValue(item) ?? {})))].sort(),
    };
  }
  return { status: "unknown", schemes: [] };
}

function parseSpec(filePath: string, source: string): unknown {
  return path.extname(filePath).toLowerCase() === ".json"
    ? JSON.parse(source)
    : parseYaml(source);
}

function scanSpec(filePath: string, source: string): {
  endpoints: DiscoveredApiEndpoint[];
  issues: SourceReadIssue[];
} {
  let parsed: unknown;
  try {
    parsed = parseSpec(filePath, source);
  } catch (error) {
    return {
      endpoints: [],
      issues: [{ filePath, message: `Unable to parse API contract: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
  const document = objectValue(parsed);
  if (!document || (typeof document.openapi !== "string" && typeof document.swagger !== "string")) {
    return {
      endpoints: [],
      issues: [{ filePath, message: "API contract must declare an openapi or swagger version." }],
    };
  }
  const pathEntries = objectValue(document.paths);
  if (!pathEntries) {
    return {
      endpoints: [],
      issues: [{ filePath, message: "API contract does not contain a paths object." }],
    };
  }
  const endpoints: DiscoveredApiEndpoint[] = [];
  const issues: SourceReadIssue[] = [];
  const operationLine = createOperationLocator(source);
  for (const [endpointPath, rawPathItem] of Object.entries(pathEntries)) {
    if (!endpointPath.startsWith("/")) {
      issues.push({ filePath, message: `OpenAPI path "${endpointPath}" is not an absolute HTTP path.` });
      continue;
    }
    const pathItem = objectValue(rawPathItem);
    if (!pathItem) {
      issues.push({ filePath, message: `OpenAPI path "${endpointPath}" must be an object.` });
      continue;
    }
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!OPERATIONS.has(method.toLowerCase())) continue;
      const operation = objectValue(rawOperation);
      if (!operation) {
        issues.push({ filePath, message: `OpenAPI operation ${method.toUpperCase()} ${endpointPath} must be an object.` });
        continue;
      }
      const requestBody = objectValue(operation.requestBody);
      const combinedParameters = [
        ...parameters(pathItem.parameters),
        ...parameters(operation.parameters),
      ];
      endpoints.push({
        protocol: "http",
        method: method.toUpperCase() as HttpMethod,
        path: endpointPath,
        title:
          (typeof operation.summary === "string" && operation.summary) ||
          (typeof operation.operationId === "string" && operation.operationId) ||
          `${method.toUpperCase()} ${endpointPath}`,
        ...(typeof operation.operationId === "string" && operation.operationId ? { operationId: operation.operationId } : {}),
        ...(typeof operation.summary === "string" && operation.summary ? { summary: operation.summary } : {}),
        ...(typeof operation.description === "string" && operation.description ? { description: operation.description } : {}),
        tags: stringArray(operation.tags),
        parameters: combinedParameters,
        requestContentTypes: contentTypes(requestBody?.content),
        responses: responseList(operation.responses),
        security: security(operation.security, document.security),
        source: { filePath, line: operationLine(endpointPath, method) },
        discoveryKind: "openapi",
        framework: "openapi",
        confidence: 1,
      });
    }
  }
  return { endpoints, issues };
}

export const openApiEndpointAdapter = defineApiEndpointAdapter({
  apiVersion: API_ENDPOINT_ADAPTER_VERSION,
  id: "openapi",
  displayName: "OpenAPI contracts",
  async scan(context: ApiEndpointAdapterContext) {
    const files = context.files.filter((file) => SPEC_FILE.test(path.posix.basename(file.filePath)));
    const scanned = await Promise.all(files.map(async (file) => scanSpec(file.filePath, await context.readFile(file.filePath))));
    return {
      endpoints: scanned.flatMap((item) => item.endpoints),
      issues: scanned.flatMap((item) => item.issues),
    };
  },
});
