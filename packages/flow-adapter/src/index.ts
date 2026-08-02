import {
  ExtensionIdSchema,
  HttpMethodSchema,
  type FlowTransitionKind,
  type HttpMethod,
  type SourceLocation,
  type SourceReadIssue,
} from "@topo/schema";

export const FLOW_DISCOVERY_ADAPTER_VERSION = 1 as const;

export interface FlowDiscoverySourceFile {
  /** POSIX-style path relative to the scanned source root. */
  filePath: string;
  extension: string;
}

export interface FlowDiscoveryScreenSource {
  screenId: string;
  routePath: string;
  /** The route module plus every statically reachable value dependency. */
  sourceFilePaths: readonly string[];
}

export interface FlowDiscoveryAdapterContext {
  rootDir: string;
  files: readonly FlowDiscoverySourceFile[];
  packageNames: ReadonlySet<string>;
  screens: readonly FlowDiscoveryScreenSource[];
  /** Reads only from the scanner's immutable source snapshot. */
  readFile(filePath: string): Promise<string>;
}

export type DiscoveredFlowTarget =
  | { kind: "route"; routePath: string }
  | { kind: "api-endpoint"; method: HttpMethod; path: string };

export interface DiscoveredFlowTransition {
  sourceScreenId: string;
  kind: FlowTransitionKind;
  target: DiscoveredFlowTarget;
  action: string;
  source: SourceLocation;
  confidence: number;
}

export interface FlowDiscoveryAdapterResult {
  transitions: readonly DiscoveredFlowTransition[];
  issues?: readonly SourceReadIssue[];
}

export interface FlowDiscoveryAdapter {
  readonly apiVersion: typeof FLOW_DISCOVERY_ADAPTER_VERSION;
  readonly id: string;
  readonly displayName: string;
  scan(
    context: FlowDiscoveryAdapterContext,
  ): FlowDiscoveryAdapterResult | Promise<FlowDiscoveryAdapterResult>;
}

export interface FlowDiscoveryAdapterContribution {
  adapterId: string;
  transitions: readonly DiscoveredFlowTransition[];
  issues: readonly SourceReadIssue[];
}

export interface FlowDiscoveryAdapterScan {
  contributions: readonly FlowDiscoveryAdapterContribution[];
  transitions: readonly (DiscoveredFlowTransition & { adapterId: string })[];
  issues: readonly (SourceReadIssue & { adapterId: string })[];
}

export class FlowDiscoveryAdapterContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowDiscoveryAdapterContractError";
  }
}

export class FlowDiscoveryAdapterExecutionError extends Error {
  readonly adapterId: string;

  constructor(adapterId: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Flow discovery adapter "${adapterId}" failed: ${detail}`, { cause });
    this.name = "FlowDiscoveryAdapterExecutionError";
    this.adapterId = adapterId;
  }
}

function assertWorkspacePath(filePath: string, adapterId: string): void {
  if (
    !filePath ||
    filePath.includes("\\") ||
    filePath.startsWith("/") ||
    filePath.split("/").includes("..")
  ) {
    throw new FlowDiscoveryAdapterContractError(
      `Flow discovery adapter "${adapterId}" must return workspace-relative POSIX source paths.`,
    );
  }
}

function assertAdapter(adapter: FlowDiscoveryAdapter): void {
  if (typeof adapter !== "object" || adapter === null) {
    throw new FlowDiscoveryAdapterContractError(
      "A flow discovery adapter export must be an object.",
    );
  }
  if (adapter.apiVersion !== FLOW_DISCOVERY_ADAPTER_VERSION) {
    throw new FlowDiscoveryAdapterContractError(
      `Flow discovery adapter "${adapter.id || "<unknown>"}" targets API version ${String(adapter.apiVersion)}; Topo requires ${FLOW_DISCOVERY_ADAPTER_VERSION}.`,
    );
  }
  if (!ExtensionIdSchema.safeParse(adapter.id).success) {
    throw new FlowDiscoveryAdapterContractError(
      `Flow discovery adapter id "${String(adapter.id)}" is invalid.`,
    );
  }
  if (!adapter.displayName?.trim() || typeof adapter.scan !== "function") {
    throw new FlowDiscoveryAdapterContractError(
      `Flow discovery adapter "${adapter.id}" must provide displayName and scan().`,
    );
  }
}

function assertResult(
  adapter: FlowDiscoveryAdapter,
  result: FlowDiscoveryAdapterResult,
  context: FlowDiscoveryAdapterContext,
): void {
  if (!result || !Array.isArray(result.transitions)) {
    throw new FlowDiscoveryAdapterContractError(
      `Flow discovery adapter "${adapter.id}" scan() must return a transitions array.`,
    );
  }
  const filePaths = new Set(context.files.map((file) => file.filePath));
  const screenIds = new Set(context.screens.map((screen) => screen.screenId));
  for (const transition of result.transitions) {
    if (!screenIds.has(transition.sourceScreenId)) {
      throw new FlowDiscoveryAdapterContractError(
        `Flow discovery adapter "${adapter.id}" returned unknown source screen "${transition.sourceScreenId}".`,
      );
    }
    assertWorkspacePath(transition.source.filePath, adapter.id);
    if (!filePaths.has(transition.source.filePath)) {
      throw new FlowDiscoveryAdapterContractError(
        `Flow discovery adapter "${adapter.id}" returned source "${transition.source.filePath}" outside the source snapshot.`,
      );
    }
    if (
      transition.source.line !== undefined &&
      (!Number.isInteger(transition.source.line) || transition.source.line < 1)
    ) {
      throw new FlowDiscoveryAdapterContractError(
        `Flow discovery adapter "${adapter.id}" returned an invalid source line.`,
      );
    }
    if (
      !transition.action?.trim() ||
      !Number.isFinite(transition.confidence) ||
      transition.confidence < 0 ||
      transition.confidence > 1
    ) {
      throw new FlowDiscoveryAdapterContractError(
        `Flow discovery adapter "${adapter.id}" returned invalid transition evidence.`,
      );
    }
    const targetPath =
      transition.target.kind === "route"
        ? transition.target.routePath
        : transition.target.path;
    if (
      !targetPath.startsWith("/") ||
      targetPath.startsWith("//") ||
      targetPath.includes("?") ||
      targetPath.includes("#")
    ) {
      throw new FlowDiscoveryAdapterContractError(
        `Flow discovery adapter "${adapter.id}" returned invalid target path "${targetPath}".`,
      );
    }
    if (
      transition.target.kind === "api-endpoint" &&
      !HttpMethodSchema.safeParse(transition.target.method).success
    ) {
      throw new FlowDiscoveryAdapterContractError(
        `Flow discovery adapter "${adapter.id}" returned an invalid HTTP method.`,
      );
    }
  }
  for (const issue of result.issues ?? []) {
    assertWorkspacePath(issue.filePath, adapter.id);
    if (!filePaths.has(issue.filePath) || !issue.message?.trim()) {
      throw new FlowDiscoveryAdapterContractError(
        `Flow discovery adapter "${adapter.id}" returned an invalid source issue.`,
      );
    }
  }
}

export function defineFlowDiscoveryAdapter<
  const TAdapter extends FlowDiscoveryAdapter,
>(adapter: TAdapter): TAdapter {
  assertAdapter(adapter);
  return adapter;
}

export function createFlowDiscoveryAdapterRegistry(
  adapters: readonly FlowDiscoveryAdapter[],
) {
  const registered = [...adapters];
  const ids = new Set<string>();
  for (const adapter of registered) {
    assertAdapter(adapter);
    if (ids.has(adapter.id)) {
      throw new FlowDiscoveryAdapterContractError(
        `Flow discovery adapter id "${adapter.id}" is registered more than once.`,
      );
    }
    ids.add(adapter.id);
  }
  return {
    adapters: Object.freeze(registered),
    async scan(
      context: FlowDiscoveryAdapterContext,
    ): Promise<FlowDiscoveryAdapterScan> {
      const contributions = await Promise.all(
        registered.map(async (adapter): Promise<FlowDiscoveryAdapterContribution> => {
          try {
            const result = await adapter.scan(context);
            assertResult(adapter, result, context);
            return {
              adapterId: adapter.id,
              transitions: result.transitions,
              issues: result.issues ?? [],
            };
          } catch (error) {
            if (error instanceof FlowDiscoveryAdapterContractError) throw error;
            throw new FlowDiscoveryAdapterExecutionError(adapter.id, error);
          }
        }),
      );
      return {
        contributions,
        transitions: contributions.flatMap((item) =>
          item.transitions.map((transition) => ({
            ...transition,
            adapterId: item.adapterId,
          })),
        ),
        issues: contributions.flatMap((item) =>
          item.issues.map((issue) => ({ ...issue, adapterId: item.adapterId })),
        ),
      };
    },
  };
}
