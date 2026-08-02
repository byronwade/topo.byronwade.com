import type {
  FrameworkAdapterContext,
  MaybePromise,
} from "@topo/framework-adapter";
import {
  ComponentPreviewSourceSchema,
  type ComponentPreviewSource,
} from "@topo/schema";

export const COMPONENT_PREVIEW_ADAPTER_API_VERSION = 1 as const;

export interface DiscoveredComponentPreview {
  componentFilePath: string;
  preview: ComponentPreviewSource;
}

export interface ComponentPreviewAdapterResult {
  previews: readonly DiscoveredComponentPreview[];
}

export interface ComponentPreviewResolveOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface ComponentPreviewAdapter {
  readonly apiVersion: typeof COMPONENT_PREVIEW_ADAPTER_API_VERSION;
  readonly id: string;
  readonly displayName: string;
  scan(
    context: FrameworkAdapterContext,
  ): MaybePromise<ComponentPreviewAdapterResult>;
  resolveCaptureUrl(
    preview: ComponentPreviewSource,
    options: ComponentPreviewResolveOptions,
  ): MaybePromise<string>;
}

export interface ResolveComponentPreviewOptions {
  baseUrls: Readonly<Record<string, string>>;
  fetch?: typeof fetch;
}

export interface ComponentPreviewAdapterScan {
  contributions: readonly {
    adapterId: string;
    previews: readonly DiscoveredComponentPreview[];
  }[];
  previews: readonly DiscoveredComponentPreview[];
}

export interface ComponentPreviewAdapterRegistry {
  readonly adapters: readonly ComponentPreviewAdapter[];
  scan(context: FrameworkAdapterContext): Promise<ComponentPreviewAdapterScan>;
  resolveCaptureUrl(
    preview: ComponentPreviewSource,
    options: ResolveComponentPreviewOptions,
  ): Promise<string>;
}

export class ComponentPreviewAdapterContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComponentPreviewAdapterContractError";
  }
}

export class ComponentPreviewAdapterExecutionError extends Error {
  readonly adapterId: string;
  readonly stage: "scan" | "resolve";

  constructor(adapterId: string, stage: "scan" | "resolve", cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Component preview adapter "${adapterId}" failed during ${stage}: ${detail}`,
      { cause },
    );
    this.name = "ComponentPreviewAdapterExecutionError";
    this.adapterId = adapterId;
    this.stage = stage;
  }
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function assertWorkspacePath(value: string, label: string): void {
  if (
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").includes("..")
  ) {
    throw new ComponentPreviewAdapterContractError(
      `${label} must be a workspace-relative POSIX path; received "${value}".`,
    );
  }
}

function assertAdapter(adapter: ComponentPreviewAdapter): void {
  if (typeof adapter !== "object" || adapter === null) {
    throw new ComponentPreviewAdapterContractError(
      "A component preview adapter export must be an object.",
    );
  }
  if (adapter.apiVersion !== COMPONENT_PREVIEW_ADAPTER_API_VERSION) {
    throw new ComponentPreviewAdapterContractError(
      `Component preview adapter "${adapter.id || "<unknown>"}" targets API version ${String(adapter.apiVersion)}; Topo requires ${COMPONENT_PREVIEW_ADAPTER_API_VERSION}.`,
    );
  }
  if (!IDENTIFIER_PATTERN.test(adapter.id)) {
    throw new ComponentPreviewAdapterContractError(
      `Component preview adapter id must use lowercase letters, numbers, dots, and hyphens and begin with a letter; received "${adapter.id}".`,
    );
  }
  if (!adapter.displayName.trim()) {
    throw new ComponentPreviewAdapterContractError(
      `Component preview adapter "${adapter.id}" must have a display name.`,
    );
  }
  if (
    typeof adapter.scan !== "function" ||
    typeof adapter.resolveCaptureUrl !== "function"
  ) {
    throw new ComponentPreviewAdapterContractError(
      `Component preview adapter "${adapter.id}" must implement scan() and resolveCaptureUrl().`,
    );
  }
}

function parsePreviews(
  adapter: ComponentPreviewAdapter,
  value: unknown,
): DiscoveredComponentPreview[] {
  const previews =
    typeof value === "object" && value !== null
      ? (value as { previews?: unknown }).previews
      : undefined;
  if (!Array.isArray(previews)) {
    throw new ComponentPreviewAdapterContractError(
      `Component preview adapter "${adapter.id}" scan() must return an object with a previews array.`,
    );
  }

  return previews.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new ComponentPreviewAdapterContractError(
        `Component preview adapter "${adapter.id}" returned an invalid preview at index ${index}.`,
      );
    }
    const candidate = item as {
      componentFilePath?: unknown;
      preview?: unknown;
    };
    if (typeof candidate.componentFilePath !== "string") {
      throw new ComponentPreviewAdapterContractError(
        `Component preview adapter "${adapter.id}" returned a preview without componentFilePath.`,
      );
    }
    assertWorkspacePath(
      candidate.componentFilePath,
      `componentFilePath from adapter "${adapter.id}"`,
    );
    const preview = ComponentPreviewSourceSchema.parse(candidate.preview);
    assertWorkspacePath(
      preview.source.filePath,
      `preview source from adapter "${adapter.id}"`,
    );
    if (preview.adapterId !== adapter.id) {
      throw new ComponentPreviewAdapterContractError(
        `Component preview "${preview.id}" declares adapter "${preview.adapterId}" but was returned by "${adapter.id}".`,
      );
    }
    return { componentFilePath: candidate.componentFilePath, preview };
  });
}

export function defineComponentPreviewAdapter<
  const TAdapter extends ComponentPreviewAdapter,
>(adapter: TAdapter): TAdapter {
  assertAdapter(adapter);
  return adapter;
}

export function createComponentPreviewAdapterRegistry(
  adapters: readonly ComponentPreviewAdapter[],
): ComponentPreviewAdapterRegistry {
  const registered = [...adapters];
  const byId = new Map<string, ComponentPreviewAdapter>();
  for (const adapter of registered) {
    assertAdapter(adapter);
    if (byId.has(adapter.id)) {
      throw new ComponentPreviewAdapterContractError(
        `Component preview adapter id "${adapter.id}" is registered more than once.`,
      );
    }
    byId.set(adapter.id, adapter);
  }

  return {
    adapters: Object.freeze(registered),
    async scan(context): Promise<ComponentPreviewAdapterScan> {
      const contributions = await Promise.all(
        registered.map(async (adapter) => {
          try {
            return {
              adapterId: adapter.id,
              previews: parsePreviews(adapter, await adapter.scan(context)),
            };
          } catch (error) {
            if (error instanceof ComponentPreviewAdapterContractError)
              throw error;
            throw new ComponentPreviewAdapterExecutionError(
              adapter.id,
              "scan",
              error,
            );
          }
        }),
      );
      const previews = contributions.flatMap((item) => item.previews);
      const ids = new Set<string>();
      for (const { preview } of previews) {
        if (ids.has(preview.id)) {
          throw new ComponentPreviewAdapterContractError(
            `Component preview id "${preview.id}" was discovered more than once.`,
          );
        }
        ids.add(preview.id);
      }
      return { contributions, previews };
    },
    async resolveCaptureUrl(preview, options): Promise<string> {
      const adapter = byId.get(preview.adapterId);
      if (!adapter) {
        throw new ComponentPreviewAdapterContractError(
          `No component preview adapter is registered for "${preview.adapterId}".`,
        );
      }
      const baseUrl = options.baseUrls[preview.adapterId];
      if (!baseUrl) {
        throw new ComponentPreviewAdapterContractError(
          `No capture base URL is configured for component preview adapter "${preview.adapterId}". Add preview.componentBaseUrls["${preview.adapterId}"] to topo.config.ts.`,
        );
      }
      try {
        const resolved = await adapter.resolveCaptureUrl(preview, {
          baseUrl: new URL(baseUrl).toString(),
          fetch: options.fetch,
        });
        return new URL(resolved).toString();
      } catch (error) {
        if (error instanceof ComponentPreviewAdapterContractError) throw error;
        throw new ComponentPreviewAdapterExecutionError(
          adapter.id,
          "resolve",
          error,
        );
      }
    },
  };
}
