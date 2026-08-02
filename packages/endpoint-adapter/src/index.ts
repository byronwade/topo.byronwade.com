import {
  ExtensionIdSchema,
  type ApiEndpointParameter,
  type ApiEndpointResponse,
  type Framework,
  type HttpMethod,
  type SourceLocation,
  type SourceReadIssue,
} from "@topo/schema";

export const API_ENDPOINT_ADAPTER_VERSION = 1 as const;

export interface ApiEndpointSourceFile {
  /** POSIX-style path relative to the scanned workspace root. */
  filePath: string;
  extension: string;
}

export interface ApiEndpointAdapterContext {
  rootDir: string;
  files: readonly ApiEndpointSourceFile[];
  packageNames: ReadonlySet<string>;
  /** Reads only from the scanner's immutable source snapshot. */
  readFile(filePath: string): Promise<string>;
}

export type ApiEndpointDiscoveryKind =
  | "framework-source"
  | "router-source"
  | "openapi";

export interface DiscoveredApiEndpoint {
  protocol: "http";
  method: HttpMethod;
  path: string;
  source: SourceLocation;
  discoveryKind: ApiEndpointDiscoveryKind;
  framework?: Framework;
  confidence: number;
  title?: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: readonly string[];
  parameters?: readonly ApiEndpointParameter[];
  requestContentTypes?: readonly string[];
  responses?: readonly ApiEndpointResponse[];
  security?: {
    status: "declared" | "none" | "unknown";
    schemes?: readonly string[];
  };
}

export interface ApiEndpointAdapterResult {
  endpoints: readonly DiscoveredApiEndpoint[];
  issues?: readonly SourceReadIssue[];
}

export interface ApiEndpointAdapter {
  readonly apiVersion: typeof API_ENDPOINT_ADAPTER_VERSION;
  readonly id: string;
  readonly displayName: string;
  scan(
    context: ApiEndpointAdapterContext,
  ): ApiEndpointAdapterResult | Promise<ApiEndpointAdapterResult>;
}

export interface ApiEndpointAdapterContribution {
  adapterId: string;
  endpoints: readonly DiscoveredApiEndpoint[];
  issues: readonly SourceReadIssue[];
}

export interface ApiEndpointAdapterScan {
  contributions: readonly ApiEndpointAdapterContribution[];
  endpoints: readonly DiscoveredApiEndpoint[];
  issues: readonly (SourceReadIssue & { adapterId: string })[];
}

export class ApiEndpointAdapterContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiEndpointAdapterContractError";
  }
}

export class ApiEndpointAdapterExecutionError extends Error {
  readonly adapterId: string;

  constructor(adapterId: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`API endpoint adapter "${adapterId}" failed: ${detail}`, { cause });
    this.name = "ApiEndpointAdapterExecutionError";
    this.adapterId = adapterId;
  }
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const HTTP_METHOD_SET = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
  "ANY",
]);
const PARAMETER_LOCATIONS = new Set(["path", "query", "header", "cookie"]);

function assertAdapter(adapter: ApiEndpointAdapter): void {
  if (typeof adapter !== "object" || adapter === null) {
    throw new ApiEndpointAdapterContractError(
      "An API endpoint adapter export must be an object.",
    );
  }
  if (adapter.apiVersion !== API_ENDPOINT_ADAPTER_VERSION) {
    throw new ApiEndpointAdapterContractError(
      `API endpoint adapter "${adapter.id || "<unknown>"}" targets API version ${String(adapter.apiVersion)}; Topo requires ${API_ENDPOINT_ADAPTER_VERSION}.`,
    );
  }
  if (!ExtensionIdSchema.safeParse(adapter.id).success) {
    throw new ApiEndpointAdapterContractError(
      `API endpoint adapter id "${String(adapter.id)}" is invalid.`,
    );
  }
  if (!adapter.displayName?.trim() || typeof adapter.scan !== "function") {
    throw new ApiEndpointAdapterContractError(
      `API endpoint adapter "${adapter.id}" must provide displayName and scan().`,
    );
  }
}

function assertWorkspacePath(filePath: string, adapterId: string): void {
  if (
    !filePath ||
    filePath.includes("\\") ||
    filePath.startsWith("/") ||
    filePath.split("/").includes("..")
  ) {
    throw new ApiEndpointAdapterContractError(
      `API endpoint adapter "${adapterId}" must return workspace-relative POSIX source paths.`,
    );
  }
}

function assertResult(
  adapter: ApiEndpointAdapter,
  result: ApiEndpointAdapterResult,
  filePaths: ReadonlySet<string>,
): void {
  if (!result || !Array.isArray(result.endpoints)) {
    throw new ApiEndpointAdapterContractError(
      `API endpoint adapter "${adapter.id}" scan() must return an endpoints array.`,
    );
  }
  for (const endpoint of result.endpoints) {
    if (!HTTP_METHOD_SET.has(endpoint.method)) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter "${adapter.id}" returned unsupported method "${String(endpoint.method)}".`,
      );
    }
    if (
      endpoint.protocol !== "http" ||
      !endpoint.path.startsWith("/") ||
      endpoint.path.includes("?") ||
      endpoint.path.includes("#")
    ) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter "${adapter.id}" returned invalid HTTP path "${String(endpoint.path)}".`,
      );
    }
    assertWorkspacePath(endpoint.source.filePath, adapter.id);
    if (!filePaths.has(endpoint.source.filePath)) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter "${adapter.id}" returned source "${endpoint.source.filePath}" outside the source snapshot.`,
      );
    }
    if (
      endpoint.source.line !== undefined &&
      (!Number.isInteger(endpoint.source.line) || endpoint.source.line < 1)
    ) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter "${adapter.id}" returned an invalid source location.`,
      );
    }
    if (
      endpoint.framework !== undefined &&
      !IDENTIFIER_PATTERN.test(endpoint.framework)
    ) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter "${adapter.id}" returned invalid framework "${String(endpoint.framework)}".`,
      );
    }
    if (!Number.isFinite(endpoint.confidence) || endpoint.confidence < 0 || endpoint.confidence > 1) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter "${adapter.id}" returned invalid confidence ${endpoint.confidence}.`,
      );
    }
    for (const parameter of endpoint.parameters ?? []) {
      if (
        !parameter.name ||
        !PARAMETER_LOCATIONS.has(parameter.in) ||
        typeof parameter.required !== "boolean"
      ) {
        throw new ApiEndpointAdapterContractError(
          `API endpoint adapter "${adapter.id}" returned an invalid parameter.`,
        );
      }
    }
    for (const response of endpoint.responses ?? []) {
      if (
        !response.status ||
        !Array.isArray(response.contentTypes) ||
        response.contentTypes.some((item: string) => !item)
      ) {
        throw new ApiEndpointAdapterContractError(
          `API endpoint adapter "${adapter.id}" returned an invalid response.`,
        );
      }
    }
  }
  for (const issue of result.issues ?? []) {
    if (!issue.filePath || !issue.message) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter "${adapter.id}" returned an invalid source issue.`,
      );
    }
    assertWorkspacePath(issue.filePath, adapter.id);
    if (!filePaths.has(issue.filePath)) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter "${adapter.id}" returned issue source "${issue.filePath}" outside the source snapshot.`,
      );
    }
  }
}

export function defineApiEndpointAdapter<
  const TAdapter extends ApiEndpointAdapter,
>(adapter: TAdapter): TAdapter {
  assertAdapter(adapter);
  return adapter;
}

export function createApiEndpointAdapterRegistry(
  adapters: readonly ApiEndpointAdapter[],
) {
  const registered = [...adapters];
  const ids = new Set<string>();
  for (const adapter of registered) {
    assertAdapter(adapter);
    if (ids.has(adapter.id)) {
      throw new ApiEndpointAdapterContractError(
        `API endpoint adapter id "${adapter.id}" is registered more than once.`,
      );
    }
    ids.add(adapter.id);
  }
  return {
    adapters: Object.freeze(registered),
    async scan(
      context: ApiEndpointAdapterContext,
    ): Promise<ApiEndpointAdapterScan> {
      const filePaths = new Set(context.files.map((file) => file.filePath));
      const contributions = await Promise.all(
        registered.map(async (adapter): Promise<ApiEndpointAdapterContribution> => {
          try {
            const result = await adapter.scan(context);
            assertResult(adapter, result, filePaths);
            return {
              adapterId: adapter.id,
              endpoints: result.endpoints,
              issues: result.issues ?? [],
            };
          } catch (error) {
            if (error instanceof ApiEndpointAdapterContractError) throw error;
            throw new ApiEndpointAdapterExecutionError(adapter.id, error);
          }
        }),
      );
      return {
        contributions,
        endpoints: contributions.flatMap((item) => item.endpoints),
        issues: contributions.flatMap((item) =>
          item.issues.map((issue) => ({ ...issue, adapterId: item.adapterId })),
        ),
      };
    },
  };
}
