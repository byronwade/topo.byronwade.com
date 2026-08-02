import path from "node:path";

import {
  parseModule,
  type ParsedExport,
  type ParsedModule,
} from "@topo/parser-oxc";
import {
  COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  defineComponentPreviewAdapter,
  type DiscoveredComponentPreview,
} from "@topo/preview-adapter";
import type { FrameworkAdapterContext } from "@topo/framework-adapter";
import type { ComponentPreviewReadiness } from "@topo/schema";

export const TOPO_COMPONENT_PREVIEW_ADAPTER_ID = "topo" as const;

export interface TopoConfiguredComponentPreview {
  readonly source: string;
  readonly exportName: string;
  readonly title?: string;
  readonly provenance: "configured" | "ai-accepted";
  readonly readiness?: ComponentPreviewReadiness;
}

export type TopoConfiguredComponentPreviews = Readonly<
  Record<string, readonly TopoConfiguredComponentPreview[]>
>;

const COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const;

function extensionStem(filePath: string): string {
  return filePath.slice(0, -path.posix.extname(filePath).length);
}

function moduleExportName(item: ParsedExport): string {
  return item.kind === "default" ? "default" : item.name;
}

function titleFromExport(exportName: string): string {
  if (exportName === "default") return "Default";
  return exportName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function isRenderableExport(item: ParsedExport): boolean {
  if (item.requiredProps > 0) return false;
  return item.runtimeKind === "function" || item.runtimeKind === "arrow";
}

function parseableModule(
  source: string,
  filePath: string,
  strict: boolean,
): ParsedModule | undefined {
  const parsed = parseModule(source, filePath);
  const errors = parsed.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length === 0) return parsed;
  if (!strict) return undefined;
  const first = errors[0]!;
  throw new Error(
    `Configured component preview source "${filePath}" could not be parsed by Oxc at ${first.line}:${first.column}: ${first.message}`,
  );
}

function componentFiles(context: FrameworkAdapterContext): string[] {
  return context.files
    .map((file) => file.filePath)
    .filter((filePath) => /(^|\/)(components|ui)\//.test(filePath))
    .filter((filePath) =>
      COMPONENT_EXTENSIONS.includes(
        path.posix.extname(filePath) as (typeof COMPONENT_EXTENSIONS)[number],
      ),
    )
    .filter(
      (filePath) =>
        ![".test.", ".spec.", ".stories.", ".topo."].some((marker) =>
          filePath.includes(marker),
        ),
    )
    .sort((left, right) => left.localeCompare(right));
}

function explicitPreviewFile(
  componentFilePath: string,
  files: ReadonlySet<string>,
): string | undefined {
  const stem = extensionStem(componentFilePath);
  return COMPONENT_EXTENSIONS.map(
    (extension) => `${stem}.topo${extension}`,
  ).find((candidate) => files.has(candidate));
}

function contribution(
  componentFilePath: string,
  sourceFilePath: string,
  item: ParsedExport,
  priority: number,
  discovery: "colocated" | "automatic",
): DiscoveredComponentPreview {
  const exportName = moduleExportName(item);
  const locator = `${sourceFilePath}#${exportName}`;
  return {
    componentFilePath,
    preview: {
      id: `topo:${locator}`,
      title: titleFromExport(exportName),
      adapterId: TOPO_COMPONENT_PREVIEW_ADAPTER_ID,
      discovery,
      source: { filePath: sourceFilePath, line: item.line },
      exportName,
      locator,
      priority,
      readiness: {
        readySelector: 'html[data-topo-preview-status="ready"]',
        errorSelector: 'html[data-topo-preview-status="error"]',
        timeoutMs: 10_000,
      },
    },
  };
}

async function configuredContributions(
  context: FrameworkAdapterContext,
  configured: TopoConfiguredComponentPreviews,
): Promise<DiscoveredComponentPreview[]> {
  const files = new Set(context.files.map((file) => file.filePath));
  const contributions: DiscoveredComponentPreview[] = [];

  for (const componentFilePath of Object.keys(configured).sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (!files.has(componentFilePath)) {
      throw new Error(
        `Configured component preview target "${componentFilePath}" does not exist in the scanned application.`,
      );
    }
    for (const entry of configured[componentFilePath] ?? []) {
      if (!files.has(entry.source)) {
        throw new Error(
          `Configured component preview source "${entry.source}" for "${componentFilePath}" does not exist in the scanned application.`,
        );
      }
      const source = await context.readFile(entry.source);
      const item = parseableModule(source, entry.source, true)!.exports.find(
        (candidate) => moduleExportName(candidate) === entry.exportName,
      );
      if (!item) {
        throw new Error(
          `Configured component preview source "${entry.source}" does not export "${entry.exportName}".`,
        );
      }
      if (!isRenderableExport(item)) {
        throw new Error(
          `Configured component preview "${entry.source}#${entry.exportName}" must be a renderable export with no required props.`,
        );
      }
      const discovery =
        entry.provenance === "ai-accepted" ? "generated" : "configured";
      const locator = `${entry.source}#${entry.exportName}`;
      contributions.push({
        componentFilePath,
        preview: {
          id: `topo:${discovery}:${componentFilePath}:${locator}`,
          title: entry.title ?? titleFromExport(entry.exportName),
          adapterId: TOPO_COMPONENT_PREVIEW_ADAPTER_ID,
          discovery,
          source: { filePath: entry.source, line: item.line },
          exportName: entry.exportName,
          locator,
          priority: discovery === "configured" ? 300 : 500,
          readiness: entry.readiness ?? {
            readySelector: 'html[data-topo-preview-status="ready"]',
            errorSelector: 'html[data-topo-preview-status="error"]',
            timeoutMs: 10_000,
          },
        },
      });
    }
  }

  return contributions;
}

export async function discoverTopoComponentPreviews(
  context: FrameworkAdapterContext,
  configured: TopoConfiguredComponentPreviews = {},
): Promise<DiscoveredComponentPreview[]> {
  const files = new Set(context.files.map((file) => file.filePath));
  const explicitPreviews: DiscoveredComponentPreview[] = [];
  const automaticPreviews: DiscoveredComponentPreview[] = [];

  for (const componentFilePath of componentFiles(context)) {
    const explicitFilePath = explicitPreviewFile(componentFilePath, files);
    if (explicitFilePath) {
      const source = await context.readFile(explicitFilePath);
      const parsed = parseableModule(source, explicitFilePath, false);
      for (const item of parsed?.exports ?? []) {
        if (!isRenderableExport(item)) continue;
        explicitPreviews.push(
          contribution(
            componentFilePath,
            explicitFilePath,
            item,
            200,
            "colocated",
          ),
        );
      }
    }

    const source = await context.readFile(componentFilePath);
    const parsed = parseableModule(source, componentFilePath, false);
    const componentName = path.posix.basename(
      componentFilePath,
      path.posix.extname(componentFilePath),
    );
    const direct = parsed?.exports.find(
      (item) =>
        isRenderableExport(item) &&
        (item.kind === "default" || item.name === componentName),
    );
    if (direct) {
      automaticPreviews.push(
        contribution(
          componentFilePath,
          componentFilePath,
          direct,
          400,
          "automatic",
        ),
      );
    }
  }

  return [
    ...explicitPreviews,
    ...(await configuredContributions(context, configured)),
    ...automaticPreviews,
  ];
}

export function createTopoComponentPreviewAdapter(
  configured: TopoConfiguredComponentPreviews = {},
) {
  return defineComponentPreviewAdapter({
    apiVersion: COMPONENT_PREVIEW_ADAPTER_API_VERSION,
    id: TOPO_COMPONENT_PREVIEW_ADAPTER_ID,
    displayName: "Topo previews",
    scan: async (context) => ({
      previews: await discoverTopoComponentPreviews(context, configured),
    }),
    async resolveCaptureUrl(preview, { baseUrl }) {
      if (!preview.exportName) {
        throw new Error(
          `Topo preview "${preview.id}" does not declare an export name.`,
        );
      }
      const url = new URL("preview", baseUrl);
      url.searchParams.set("source", preview.source.filePath);
      url.searchParams.set("export", preview.exportName);
      return url.toString();
    },
  });
}

export const topoComponentPreviewAdapter = createTopoComponentPreviewAdapter();
