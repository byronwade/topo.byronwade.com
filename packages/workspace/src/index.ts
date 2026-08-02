import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { nextFrameworkAdapter } from "@topo/adapter-next";
import { sourceApiEndpointAdapter } from "@topo/adapter-api-source";
import { sourceFlowDiscoveryAdapter } from "@topo/adapter-flow-source";
import { nuxtFrameworkAdapter } from "@topo/adapter-nuxt";
import { openApiEndpointAdapter } from "@topo/adapter-openapi";
import { reactFrameworkAdapter } from "@topo/adapter-react";
import { storybookComponentPreviewAdapter } from "@topo/adapter-storybook";
import { svelteFrameworkAdapter } from "@topo/adapter-svelte";
import { tanStackFrameworkAdapter } from "@topo/adapter-tanstack";
import {
  createTopoComponentPreviewAdapter,
  topoComponentPreviewAdapter,
  type TopoConfiguredComponentPreviews,
} from "@topo/adapter-topo";
import { vueFrameworkAdapter } from "@topo/adapter-vue";
import type { FrameworkAdapter } from "@topo/framework-adapter";
import type { ApiEndpointAdapter } from "@topo/endpoint-adapter";
import type { FlowDiscoveryAdapter } from "@topo/flow-adapter";
import type { ComponentPreviewAdapter } from "@topo/preview-adapter";
import {
  createScannerSession as createSourceScannerSession,
  type ScannerSession,
} from "@topo/scanner";
import type { PreviewRouteExamples } from "@topo/schema";

export interface WorkspacePackage {
  name: string;
  directory: string;
  scripts: string[];
  dependencies: string[];
}

export interface WorkspaceInfo {
  rootDir: string;
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | "unknown";
  applications: WorkspacePackage[];
}

export interface WorkspaceScanOptions {
  ignore?: readonly string[];
  /** Resolve configured adapter packages and relative modules from this project root. */
  adapterRootDir?: string;
  /** Programmatic adapters, primarily for embedding Topo and adapter tests. */
  adapters?: readonly FrameworkAdapter[];
  /** Installed packages or relative ESM files exporting framework adapters. */
  adapterModules?: readonly string[];
  /** Programmatic API discovery adapters for embedding and tests. */
  endpointAdapters?: readonly ApiEndpointAdapter[];
  /** Installed packages or relative ESM files exporting API endpoint adapters. */
  apiEndpointAdapterModules?: readonly string[];
  /** Programmatic source-flow discovery adapters for embedding and tests. */
  flowAdapters?: readonly FlowDiscoveryAdapter[];
  /** Installed packages or relative ESM files exporting flow discovery adapters. */
  flowAdapterModules?: readonly string[];
  /** Programmatic component preview adapters for embedding and tests. */
  previewAdapters?: readonly ComponentPreviewAdapter[];
  /** Project-owned zero-prop preview exports keyed by component source path. */
  componentPreviews?: TopoConfiguredComponentPreviews;
  /** Concrete local paths keyed by canonical discovered route identity. */
  previewRoutes?: PreviewRouteExamples;
  /** Installed packages or relative ESM files exporting component preview adapters. */
  componentPreviewAdapterModules?: readonly string[];
}

export type WorkspaceScanner = ScannerSession;

export class FrameworkAdapterLoadError extends Error {
  readonly specifier: string;

  constructor(specifier: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Unable to load framework adapter module "${specifier}": ${detail}`, {
      cause,
    });
    this.name = "FrameworkAdapterLoadError";
    this.specifier = specifier;
  }
}

export const builtInFrameworkAdapters: readonly FrameworkAdapter[] =
  Object.freeze([
    nextFrameworkAdapter,
    tanStackFrameworkAdapter,
    reactFrameworkAdapter,
    vueFrameworkAdapter,
    nuxtFrameworkAdapter,
    svelteFrameworkAdapter,
  ]);

export const builtInComponentPreviewAdapters: readonly ComponentPreviewAdapter[] =
  Object.freeze([
    storybookComponentPreviewAdapter,
    topoComponentPreviewAdapter,
  ]);

export const builtInApiEndpointAdapters: readonly ApiEndpointAdapter[] =
  Object.freeze([sourceApiEndpointAdapter, openApiEndpointAdapter]);

export const builtInFlowDiscoveryAdapters: readonly FlowDiscoveryAdapter[] =
  Object.freeze([sourceFlowDiscoveryAdapter]);

function adapterExports(value: unknown): FrameworkAdapter[] {
  if (Array.isArray(value)) return value.flatMap(adapterExports);
  if (typeof value !== "object" || value === null) return [];
  return [value as FrameworkAdapter];
}

async function importAdapterModule(
  rootDir: string,
  specifier: string,
): Promise<FrameworkAdapter[]> {
  try {
    const absoluteRoot = path.resolve(rootDir);
    const projectRequire = createRequire(
      path.join(absoluteRoot, "package.json"),
    );
    const resolved =
      specifier.startsWith(".") || path.isAbsolute(specifier)
        ? path.resolve(absoluteRoot, specifier)
        : projectRequire.resolve(specifier);
    const loaded = (await import(pathToFileURL(resolved).href)) as Record<
      string,
      unknown
    >;
    const exported =
      loaded.frameworkAdapters ?? loaded.frameworkAdapter ?? loaded.default;
    const adapters = adapterExports(exported);
    if (adapters.length === 0) {
      throw new Error(
        "Expected a default export, frameworkAdapter export, or frameworkAdapters array.",
      );
    }
    return adapters;
  } catch (error) {
    throw new FrameworkAdapterLoadError(specifier, error);
  }
}

function componentPreviewAdapterExports(
  value: unknown,
): ComponentPreviewAdapter[] {
  if (Array.isArray(value))
    return value.flatMap(componentPreviewAdapterExports);
  if (typeof value !== "object" || value === null) return [];
  return [value as ComponentPreviewAdapter];
}

async function importComponentPreviewAdapterModule(
  rootDir: string,
  specifier: string,
): Promise<ComponentPreviewAdapter[]> {
  try {
    const absoluteRoot = path.resolve(rootDir);
    const projectRequire = createRequire(
      path.join(absoluteRoot, "package.json"),
    );
    const resolved =
      specifier.startsWith(".") || path.isAbsolute(specifier)
        ? path.resolve(absoluteRoot, specifier)
        : projectRequire.resolve(specifier);
    const loaded = (await import(pathToFileURL(resolved).href)) as Record<
      string,
      unknown
    >;
    const exported =
      loaded.componentPreviewAdapters ??
      loaded.componentPreviewAdapter ??
      loaded.default;
    const adapters = componentPreviewAdapterExports(exported);
    if (adapters.length === 0) {
      throw new Error(
        "Expected a default export, componentPreviewAdapter export, or componentPreviewAdapters array.",
      );
    }
    return adapters;
  } catch (error) {
    throw new FrameworkAdapterLoadError(specifier, error);
  }
}

function apiEndpointAdapterExports(value: unknown): ApiEndpointAdapter[] {
  if (Array.isArray(value)) return value.flatMap(apiEndpointAdapterExports);
  if (typeof value !== "object" || value === null) return [];
  return [value as ApiEndpointAdapter];
}

function flowDiscoveryAdapterExports(value: unknown): FlowDiscoveryAdapter[] {
  if (Array.isArray(value)) return value.flatMap(flowDiscoveryAdapterExports);
  if (typeof value !== "object" || value === null) return [];
  return [value as FlowDiscoveryAdapter];
}

async function importFlowDiscoveryAdapterModule(
  rootDir: string,
  specifier: string,
): Promise<FlowDiscoveryAdapter[]> {
  try {
    const absoluteRoot = path.resolve(rootDir);
    const projectRequire = createRequire(path.join(absoluteRoot, "package.json"));
    const resolved =
      specifier.startsWith(".") || path.isAbsolute(specifier)
        ? path.resolve(absoluteRoot, specifier)
        : projectRequire.resolve(specifier);
    const loaded = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    const exported =
      loaded.flowDiscoveryAdapters ??
      loaded.flowDiscoveryAdapter ??
      loaded.default;
    const adapters = flowDiscoveryAdapterExports(exported);
    if (adapters.length === 0) {
      throw new Error(
        "Expected a default export, flowDiscoveryAdapter export, or flowDiscoveryAdapters array.",
      );
    }
    return adapters;
  } catch (error) {
    throw new FrameworkAdapterLoadError(specifier, error);
  }
}

async function importApiEndpointAdapterModule(
  rootDir: string,
  specifier: string,
): Promise<ApiEndpointAdapter[]> {
  try {
    const absoluteRoot = path.resolve(rootDir);
    const projectRequire = createRequire(path.join(absoluteRoot, "package.json"));
    const resolved =
      specifier.startsWith(".") || path.isAbsolute(specifier)
        ? path.resolve(absoluteRoot, specifier)
        : projectRequire.resolve(specifier);
    const loaded = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    const exported =
      loaded.apiEndpointAdapters ?? loaded.apiEndpointAdapter ?? loaded.default;
    const adapters = apiEndpointAdapterExports(exported);
    if (adapters.length === 0) {
      throw new Error(
        "Expected a default export, apiEndpointAdapter export, or apiEndpointAdapters array.",
      );
    }
    return adapters;
  } catch (error) {
    throw new FrameworkAdapterLoadError(specifier, error);
  }
}

export async function loadFrameworkAdapterModules(
  rootDir: string,
  specifiers: readonly string[],
): Promise<FrameworkAdapter[]> {
  const loaded = await Promise.all(
    specifiers.map((specifier) => importAdapterModule(rootDir, specifier)),
  );
  return loaded.flat();
}

export async function loadComponentPreviewAdapterModules(
  rootDir: string,
  specifiers: readonly string[],
): Promise<ComponentPreviewAdapter[]> {
  const loaded = await Promise.all(
    specifiers.map((specifier) =>
      importComponentPreviewAdapterModule(rootDir, specifier),
    ),
  );
  return loaded.flat();
}

export async function loadApiEndpointAdapterModules(
  rootDir: string,
  specifiers: readonly string[],
): Promise<ApiEndpointAdapter[]> {
  const loaded = await Promise.all(
    specifiers.map((specifier) => importApiEndpointAdapterModule(rootDir, specifier)),
  );
  return loaded.flat();
}

export async function loadFlowDiscoveryAdapterModules(
  rootDir: string,
  specifiers: readonly string[],
): Promise<FlowDiscoveryAdapter[]> {
  const loaded = await Promise.all(
    specifiers.map((specifier) =>
      importFlowDiscoveryAdapterModule(rootDir, specifier),
    ),
  );
  return loaded.flat();
}

export async function createWorkspaceScanner(
  rootDir: string,
  options: WorkspaceScanOptions = {},
): Promise<WorkspaceScanner> {
  const adapterRootDir = options.adapterRootDir ?? rootDir;
  const [
    moduleAdapters,
    modulePreviewAdapters,
    moduleEndpointAdapters,
    moduleFlowAdapters,
  ] = await Promise.all([
    loadFrameworkAdapterModules(adapterRootDir, options.adapterModules ?? []),
    loadComponentPreviewAdapterModules(
      adapterRootDir,
      options.componentPreviewAdapterModules ?? [],
    ),
    loadApiEndpointAdapterModules(
      adapterRootDir,
      options.apiEndpointAdapterModules ?? [],
    ),
    loadFlowDiscoveryAdapterModules(
      adapterRootDir,
      options.flowAdapterModules ?? [],
    ),
  ]);
  return createSourceScannerSession(rootDir, {
    ignore: options.ignore,
    previewRoutes: options.previewRoutes,
    adapters: [
      ...builtInFrameworkAdapters,
      ...(options.adapters ?? []),
      ...moduleAdapters,
    ],
    endpointAdapters: [
      ...builtInApiEndpointAdapters,
      ...(options.endpointAdapters ?? []),
      ...moduleEndpointAdapters,
    ],
    flowAdapters: [
      ...builtInFlowDiscoveryAdapters,
      ...(options.flowAdapters ?? []),
      ...moduleFlowAdapters,
    ],
    previewAdapters: [
      storybookComponentPreviewAdapter,
      createTopoComponentPreviewAdapter(options.componentPreviews),
      ...(options.previewAdapters ?? []),
      ...modulePreviewAdapters,
    ],
  });
}

export async function scanWorkspace(
  rootDir: string,
  options: WorkspaceScanOptions = {},
) {
  return (await createWorkspaceScanner(rootDir, options)).scan();
}

async function readPackage(
  directory: string,
): Promise<WorkspacePackage | undefined> {
  try {
    const value = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    ) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (!value.name) return undefined;
    return {
      name: value.name,
      directory,
      scripts: Object.keys(value.scripts ?? {}),
      dependencies: [
        ...Object.keys(value.dependencies ?? {}),
        ...Object.keys(value.devDependencies ?? {}),
      ],
    };
  } catch {
    return undefined;
  }
}

export async function inspectWorkspace(
  rootDir: string,
): Promise<WorkspaceInfo> {
  const absoluteRoot = path.resolve(rootDir);
  const packageJson = await readPackage(absoluteRoot);
  let declaredPackageManager = "";
  try {
    const manifest = JSON.parse(
      await readFile(path.join(absoluteRoot, "package.json"), "utf8"),
    ) as { packageManager?: string };
    declaredPackageManager = manifest.packageManager ?? "";
  } catch {
    // Package metadata is optional for a partial workspace.
  }
  const packageManager: WorkspaceInfo["packageManager"] =
    declaredPackageManager.startsWith("pnpm")
      ? "pnpm"
      : declaredPackageManager.startsWith("npm")
        ? "npm"
        : declaredPackageManager.startsWith("yarn")
          ? "yarn"
          : declaredPackageManager.startsWith("bun")
            ? "bun"
            : packageJson?.dependencies.includes("pnpm")
              ? "pnpm"
              : "unknown";
  const applications: WorkspacePackage[] = [];
  for (const folder of ["apps", "packages"]) {
    try {
      const { readdir } = await import("node:fs/promises");
      for (const entry of await readdir(path.join(absoluteRoot, folder), {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        const item = await readPackage(
          path.join(absoluteRoot, folder, entry.name),
        );
        if (item) applications.push(item);
      }
    } catch {
      // A single absent workspace folder does not make the project invalid.
    }
  }
  return { rootDir: absoluteRoot, packageManager, applications };
}
