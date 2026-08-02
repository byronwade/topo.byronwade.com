import type { Framework, ScreenState } from "@topo/schema";

export const FRAMEWORK_ADAPTER_API_VERSION = 1 as const;

export type MaybePromise<T> = T | Promise<T>;

export interface WorkspaceSourceFile {
  /** POSIX-style path relative to the scanned workspace root. */
  filePath: string;
  extension: string;
}

export interface FrameworkAdapterContext {
  rootDir: string;
  files: readonly WorkspaceSourceFile[];
  packageNames: ReadonlySet<string>;
  /** Reads a file from this snapshot. It rejects when filePath is not in files. */
  readFile(filePath: string): Promise<string>;
}

export interface FrameworkMatch {
  framework: Framework;
  confidence: number;
  reasons: readonly string[];
}

export interface DiscoveredRoute {
  framework: Framework;
  filePath: string;
  routePath: string;
  state: ScreenState;
  title?: string;
  group?: string;
  tags?: readonly string[];
}

export interface FrameworkAdapterResult {
  routes: readonly DiscoveredRoute[];
}

export interface FrameworkAdapter {
  readonly apiVersion: typeof FRAMEWORK_ADAPTER_API_VERSION;
  readonly id: string;
  readonly displayName: string;
  detect(
    context: FrameworkAdapterContext,
  ): MaybePromise<readonly FrameworkMatch[]>;
  scan(
    context: FrameworkAdapterContext,
    matches: readonly FrameworkMatch[],
  ): MaybePromise<FrameworkAdapterResult>;
}

export interface FrameworkAdapterContribution {
  adapterId: string;
  matches: readonly FrameworkMatch[];
  routes: readonly DiscoveredRoute[];
}

export interface FrameworkAdapterScan {
  contributions: readonly FrameworkAdapterContribution[];
  frameworks: readonly Framework[];
  routes: readonly DiscoveredRoute[];
}

export interface FrameworkAdapterRegistry {
  readonly adapters: readonly FrameworkAdapter[];
  scan(context: FrameworkAdapterContext): Promise<FrameworkAdapterScan>;
}

export class FrameworkAdapterContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameworkAdapterContractError";
  }
}

export class FrameworkAdapterExecutionError extends Error {
  readonly adapterId: string;
  readonly stage: "detect" | "scan";

  constructor(adapterId: string, stage: "detect" | "scan", cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Framework adapter "${adapterId}" failed during ${stage}: ${detail}`,
      { cause },
    );
    this.name = "FrameworkAdapterExecutionError";
    this.adapterId = adapterId;
    this.stage = stage;
  }
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const SCREEN_STATES = new Set<ScreenState>([
  "default",
  "loading",
  "error",
  "not-found",
  "empty",
  "unknown",
]);
const RESERVED_FRAMEWORK_IDS = new Set(["mixed", "unknown"]);

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new FrameworkAdapterContractError(
      `${label} must use lowercase letters, numbers, dots, and hyphens and begin with a letter; received "${value}".`,
    );
  }
}

function assertAdapter(adapter: FrameworkAdapter): void {
  if (typeof adapter !== "object" || adapter === null) {
    throw new FrameworkAdapterContractError(
      "A framework adapter export must be an object.",
    );
  }
  if (adapter.apiVersion !== FRAMEWORK_ADAPTER_API_VERSION) {
    throw new FrameworkAdapterContractError(
      `Framework adapter "${adapter.id || "<unknown>"}" targets API version ${String(adapter.apiVersion)}; Topo requires ${FRAMEWORK_ADAPTER_API_VERSION}.`,
    );
  }
  if (typeof adapter.id !== "string") {
    throw new FrameworkAdapterContractError(
      "A framework adapter must provide a string id.",
    );
  }
  assertIdentifier(adapter.id, "Framework adapter id");
  if (typeof adapter.displayName !== "string" || !adapter.displayName.trim()) {
    throw new FrameworkAdapterContractError(
      `Framework adapter "${adapter.id}" must have a display name.`,
    );
  }
  if (
    typeof adapter.detect !== "function" ||
    typeof adapter.scan !== "function"
  ) {
    throw new FrameworkAdapterContractError(
      `Framework adapter "${adapter.id}" must implement detect() and scan().`,
    );
  }
}

function assertMatches(
  adapter: FrameworkAdapter,
  matches: readonly FrameworkMatch[],
): void {
  if (!Array.isArray(matches)) {
    throw new FrameworkAdapterContractError(
      `Framework adapter "${adapter.id}" detect() must return an array.`,
    );
  }
  const seen = new Set<string>();
  for (const match of matches) {
    if (
      typeof match !== "object" ||
      match === null ||
      typeof match.framework !== "string"
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned an invalid detection result.`,
      );
    }
    assertIdentifier(
      match.framework,
      `Framework id from adapter "${adapter.id}"`,
    );
    if (RESERVED_FRAMEWORK_IDS.has(match.framework)) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" cannot detect reserved framework id "${match.framework}".`,
      );
    }
    if (
      !Number.isFinite(match.confidence) ||
      match.confidence <= 0 ||
      match.confidence > 1
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned confidence ${match.confidence}; confidence must be greater than 0 and at most 1.`,
      );
    }
    if (
      !Array.isArray(match.reasons) ||
      match.reasons.length === 0 ||
      match.reasons.some(
        (reason: unknown) => typeof reason !== "string" || !reason.trim(),
      )
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" must provide at least one non-empty detection reason.`,
      );
    }
    if (seen.has(match.framework)) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" detected framework "${match.framework}" more than once.`,
      );
    }
    seen.add(match.framework);
  }
}

function assertRoutes(
  adapter: FrameworkAdapter,
  matches: readonly FrameworkMatch[],
  routes: readonly DiscoveredRoute[],
): void {
  if (!Array.isArray(routes)) {
    throw new FrameworkAdapterContractError(
      `Framework adapter "${adapter.id}" scan() must return an object with a routes array.`,
    );
  }
  const declaredFrameworks = new Set(matches.map((match) => match.framework));
  for (const route of routes) {
    if (
      typeof route !== "object" ||
      route === null ||
      typeof route.framework !== "string"
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned an invalid route.`,
      );
    }
    assertIdentifier(
      route.framework,
      `Framework id from adapter "${adapter.id}"`,
    );
    if (!declaredFrameworks.has(route.framework)) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned framework "${route.framework}" without declaring it from detect().`,
      );
    }
    if (
      typeof route.filePath !== "string" ||
      !route.filePath ||
      route.filePath.includes("\\") ||
      route.filePath.startsWith("/") ||
      route.filePath.split("/").includes("..")
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" must return a workspace-relative POSIX-style filePath.`,
      );
    }
    if (
      typeof route.routePath !== "string" ||
      !route.routePath.startsWith("/") ||
      route.routePath.includes("?") ||
      route.routePath.includes("#")
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned routePath "${String(route.routePath)}"; route paths must be absolute pathnames without a query or hash.`,
      );
    }
    if (!SCREEN_STATES.has(route.state)) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned unsupported screen state "${String(route.state)}".`,
      );
    }
    if (
      route.title !== undefined &&
      (typeof route.title !== "string" || !route.title.trim())
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned an empty route title.`,
      );
    }
    if (
      route.group !== undefined &&
      (typeof route.group !== "string" || !route.group.trim())
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned an empty route group.`,
      );
    }
    if (
      route.tags !== undefined &&
      (!Array.isArray(route.tags) ||
        route.tags.some(
          (tag: unknown) => typeof tag !== "string" || !tag.trim(),
        ))
    ) {
      throw new FrameworkAdapterContractError(
        `Framework adapter "${adapter.id}" returned invalid route tags.`,
      );
    }
  }
}

export function defineFrameworkAdapter<const TAdapter extends FrameworkAdapter>(
  adapter: TAdapter,
): TAdapter {
  assertAdapter(adapter);
  return adapter;
}

export function createFrameworkAdapterRegistry(
  adapters: readonly FrameworkAdapter[],
): FrameworkAdapterRegistry {
  const registered = [...adapters];
  const ids = new Set<string>();
  for (const adapter of registered) {
    assertAdapter(adapter);
    if (ids.has(adapter.id)) {
      throw new FrameworkAdapterContractError(
        `Framework adapter id "${adapter.id}" is registered more than once.`,
      );
    }
    ids.add(adapter.id);
  }

  return {
    adapters: Object.freeze(registered),
    async scan(context): Promise<FrameworkAdapterScan> {
      const detections = await Promise.all(
        registered.map(async (adapter) => {
          try {
            const matches = await adapter.detect(context);
            assertMatches(adapter, matches);
            return { adapter, matches };
          } catch (error) {
            if (error instanceof FrameworkAdapterContractError) throw error;
            throw new FrameworkAdapterExecutionError(
              adapter.id,
              "detect",
              error,
            );
          }
        }),
      );

      const contributions = await Promise.all(
        detections
          .filter(({ matches }) => matches.length > 0)
          .map(
            async ({
              adapter,
              matches,
            }): Promise<FrameworkAdapterContribution> => {
              try {
                const result = await adapter.scan(context, matches);
                const routes =
                  typeof result === "object" && result !== null
                    ? (result as { routes?: unknown }).routes
                    : undefined;
                assertRoutes(
                  adapter,
                  matches,
                  routes as readonly DiscoveredRoute[],
                );
                return {
                  adapterId: adapter.id,
                  matches,
                  routes: routes as readonly DiscoveredRoute[],
                };
              } catch (error) {
                if (error instanceof FrameworkAdapterContractError) throw error;
                throw new FrameworkAdapterExecutionError(
                  adapter.id,
                  "scan",
                  error,
                );
              }
            },
          ),
      );

      const frameworks = [
        ...new Set(
          contributions.flatMap(({ matches }) =>
            matches.map(({ framework }) => framework),
          ),
        ),
      ];
      return {
        contributions,
        frameworks,
        routes: contributions.flatMap(({ routes }) => routes),
      };
    },
  };
}
