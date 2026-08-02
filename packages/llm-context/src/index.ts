import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildAdapterInventory,
  type AdapterInventoryExtensions,
  type AdapterInventoryResponse,
} from "@topo/adapter-inventory";
import {
  inspectAdapterScaffolds,
  type AdapterScaffoldReadIssue,
  type InspectedAdapterScaffold,
} from "@topo/adapter-scaffold";
import {
  createComponentGroups,
  createRouteDistricts,
  createRouteSections,
} from "@topo/canvas-engine";
import { createFlowStore, type FlowReadIssue } from "@topo/flows";
import {
  createNoteStore,
  type NoteReadIssue,
  type NoteRecord,
} from "@topo/notes";
import {
  StudioCustomizationSchema,
  type DoctorReport,
  type StudioCustomization,
} from "@topo/protocol";
import {
  ApplicationGraphSchema,
  AtlasOrganizationSchema,
  PreviewRouteExamplesSchema,
  SourceLocationSchema,
  type ApplicationGraph,
  type AtlasOrganization,
  type Flow,
  type Framework,
  type PreviewCapturePolicy,
  type PreviewRouteExamples,
} from "@topo/schema";
import {
  createProjectStateStore,
  type ProjectState,
  type StoredSnapshot,
} from "@topo/storage";
import { z } from "zod";

export const LLM_CONTEXT_VERSION = 7 as const;

export const LLM_CONTEXT_KINDS = [
  "project",
  "adapter",
  "preview-profile",
  "route",
  "screen",
  "component",
  "api-endpoint",
  "edge",
  "finding",
  "doctor-check",
  "interaction-probe",
  "note",
  "flow",
  "flow-step",
  "flow-transition",
  "inferred-flow",
  "inferred-flow-step",
  "snapshot",
  "visual-baseline",
  "visual-comparison",
  "component-preview",
  "job",
  "issue",
] as const;

const LLM_CONTEXT_KIND_SET = new Set<string>(LLM_CONTEXT_KINDS);

export const LlmContextKindSchema = z.enum(LLM_CONTEXT_KINDS);
export type LlmContextKind = z.infer<typeof LlmContextKindSchema>;

export const LlmRelationshipSchema = z.object({
  type: z.string().min(1),
  targetKind: LlmContextKindSchema,
  targetId: z.string().min(1),
});

export type LlmRelationship = z.infer<typeof LlmRelationshipSchema>;

export const LlmContextRecordSchema = z.object({
  schemaVersion: z.literal(LLM_CONTEXT_VERSION),
  kind: LlmContextKindSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  text: z.string(),
  routePath: z.string().startsWith("/").optional(),
  source: SourceLocationSchema.optional(),
  relationships: z.array(LlmRelationshipSchema),
  data: z.record(z.unknown()),
});

export type LlmContextRecord = z.infer<typeof LlmContextRecordSchema>;

const StoredProjectLifecycleMetadataSchema = z.object({
  schemaVersion: z.literal(3),
  installedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  topoVersion: z.string().min(1),
  packageName: z.string().min(1),
  packageSpec: z.string().min(1),
  packageManager: z.enum(["pnpm", "npm", "yarn", "bun"]),
  sourceRoot: z.string().min(1),
});

export const ProjectLifecycleMetadataSchema =
  StoredProjectLifecycleMetadataSchema.extend({
    sourceFile: z.literal(".topo/install.json"),
  });

export type ProjectLifecycleMetadata = z.infer<
  typeof ProjectLifecycleMetadataSchema
>;

interface LifecycleReadIssue {
  readonly filePath: string;
  readonly message: string;
}

export const LLM_KIND_CATALOG: Readonly<
  Record<LlmContextKind, { description: string; sourceOfTruth: string }>
> = {
  project: {
    description:
      "Sanitized project identity, framework, preview URL, install lifecycle, and context capabilities.",
    sourceOfTruth:
      "package.json, topo.config.ts, .topo/install.json, and the current graph",
  },
  adapter: {
    description:
      "A built-in, configured, scaffolded, or observed framework, endpoint, flow-discovery, component-preview, or application-runtime adapter and its current status.",
    sourceOfTruth:
      "the normalized graph, topo.config.ts, and topo/adapters/*/adapter.json",
  },
  "preview-profile": {
    description:
      "Preview profile names only; authentication material is deliberately excluded.",
    sourceOfTruth: "topo.config.ts",
  },
  route: {
    description:
      "A unique framework route with all discovered screen-state records.",
    sourceOfTruth: "framework adapters and application source files",
  },
  screen: {
    description:
      "A renderable route and state such as default, loading, error, or not-found.",
    sourceOfTruth: "the normalized application graph",
  },
  component: {
    description:
      "A discovered component, preview coverage state, source, and route usage.",
    sourceOfTruth: "component discovery and application source files",
  },
  "api-endpoint": {
    description:
      "A normalized HTTP operation with implementation and contract evidence, parameters, request content, responses, and security declaration state.",
    sourceOfTruth:
      "framework route handlers, router registrations, and OpenAPI contracts",
  },
  edge: {
    description:
      "A hierarchy, navigation, or related graph relationship with confidence.",
    sourceOfTruth: "the normalized application graph",
  },
  finding: {
    description:
      "Static or runtime diagnostic evidence with severity, status, and confidence.",
    sourceOfTruth: "diagnostic analyzers and durable project state",
  },
  "doctor-check": {
    description:
      "One environment, application, or security readiness observation with evidence and remediation.",
    sourceOfTruth: "the latest canonical Topo Doctor report",
  },
  "interaction-probe": {
    description:
      "One isolated control observation with safety status, typed effects, locator, route, and evidence.",
    sourceOfTruth: ".topo/state.json and isolated Playwright diagnostics",
  },
  note: {
    description:
      "A Markdown-backed review note with route or entity attachment.",
    sourceOfTruth: ".topo/notes/*.md",
  },
  flow: {
    description:
      "A versioned user flow with status, entry step, tags, and branching steps.",
    sourceOfTruth: ".topo/flows/*.json",
  },
  "flow-step": {
    description:
      "One independently queryable flow step with route, action, expectation, and transitions.",
    sourceOfTruth: ".topo/flows/*.json",
  },
  "flow-transition": {
    description:
      "A source-located navigation, redirect, form submission, or request discovered without executing project code.",
    sourceOfTruth:
      "application source files through registered flow discovery adapters",
  },
  "inferred-flow": {
    description:
      "A read-only journey candidate derived from source-located flow transitions.",
    sourceOfTruth: "the normalized application graph",
  },
  "inferred-flow-step": {
    description:
      "One independently queryable step in an inferred journey candidate.",
    sourceOfTruth: "the normalized application graph",
  },
  snapshot: {
    description:
      "Snapshot capture metadata and a resource URI for the binary image when available.",
    sourceOfTruth: ".topo/state.json and .topo/snapshots/*.png",
  },
  "visual-baseline": {
    description:
      "An explicitly accepted screen baseline with immutable image identity and acceptance time.",
    sourceOfTruth: ".topo/state.json and .topo/snapshots/*.png",
  },
  "visual-comparison": {
    description:
      "The latest deterministic pixel comparison between a screen baseline and current capture.",
    sourceOfTruth: ".topo/state.json and .topo/comparisons/*.png",
  },
  "component-preview": {
    description:
      "Component preview capture metadata, source identity, and a resource URI for the binary image when available.",
    sourceOfTruth: ".topo/state.json and .topo/previews/*.png",
  },
  job: {
    description:
      "A local scan, capture, diagnostic, or export job and its lifecycle state.",
    sourceOfTruth: ".topo/state.json",
  },
  issue: {
    description:
      "A source record that could not be parsed and must not be hidden from agents.",
    sourceOfTruth: "adapter, note, and flow store inspection",
  },
};

const KindCatalogEntrySchema = z.object({
  kind: LlmContextKindSchema,
  description: z.string(),
  sourceOfTruth: z.string(),
});

export const LlmContextManifestSchema = z.object({
  schemaVersion: z.literal(LLM_CONTEXT_VERSION),
  generatedAt: z.string().datetime(),
  project: z.object({
    name: z.string().optional(),
    projectRoot: z.string(),
    sourceRoot: z.string(),
    /** Backward-readable alias for sourceRoot introduced in version 2. */
    rootDir: z.string(),
    framework: z.string(),
    previewBaseUrl: z.string().url(),
    profileNames: z.array(z.string()),
    previewRoutes: PreviewRouteExamplesSchema.optional(),
    atlas: AtlasOrganizationSchema.optional(),
    studio: StudioCustomizationSchema.optional(),
    lifecycle: ProjectLifecycleMetadataSchema.optional(),
  }),
  totalRecords: z.number().int().nonnegative(),
  counts: z.record(LlmContextKindSchema, z.number().int().nonnegative()),
  kinds: z.array(KindCatalogEntrySchema),
  warnings: z.array(z.string()),
  files: z.record(z.string()),
});

export type LlmContextManifest = z.infer<typeof LlmContextManifestSchema>;

export interface LlmContext {
  manifest: LlmContextManifest;
  records: LlmContextRecord[];
  graph: ApplicationGraph;
}

export interface LlmProjectMetadata {
  name?: string;
  projectRoot?: string;
  sourceRoot?: string;
  profileNames?: string[];
  previewRoutes?: PreviewRouteExamples;
  capture?: PreviewCapturePolicy;
  atlas?: AtlasOrganization;
  studio?: StudioCustomization;
  extensions?: AdapterInventoryExtensions;
}

export interface BuildLlmContextInput {
  graph: ApplicationGraph;
  adapterInventory?: AdapterInventoryResponse;
  adapters?: InspectedAdapterScaffold[];
  notes?: NoteRecord[];
  flows?: Flow[];
  state?: ProjectState;
  doctorReport?: DoctorReport;
  noteIssues?: NoteReadIssue[];
  flowIssues?: FlowReadIssue[];
  adapterIssues?: AdapterScaffoldReadIssue[];
  lifecycle?: ProjectLifecycleMetadata;
  lifecycleIssues?: LifecycleReadIssue[];
  project?: LlmProjectMetadata;
  generatedAt?: string;
}

export interface LlmContextQuery {
  query?: string;
  kinds?: readonly LlmContextKind[];
  routePath?: string;
  limit?: number;
  offset?: number;
}

export interface LlmContextQueryResult {
  total: number;
  count: number;
  offset: number;
  items: LlmContextRecord[];
  hasMore: boolean;
  nextOffset?: number;
}

export interface LlmContextExportResult {
  directory: string;
  manifestPath: string;
  recordsPath: string;
  markdownPath: string;
  schemaPath: string;
}

export interface SnapshotArtifact {
  id: string;
  artifactPath: string;
  mimeType: "image/png";
  data: Buffer;
}

export interface ComponentPreviewImageArtifact {
  id: string;
  artifactPath: string;
  mimeType: "image/png";
  data: Buffer;
}

export interface VisualImageArtifact {
  id: string;
  artifactPath: string;
  mimeType: "image/png";
  data: Buffer;
}

function routeId(framework: Framework, routePath: string): string {
  return `route:${framework}:${routePath}`;
}

function adapterRecordId(
  adapter: AdapterInventoryResponse["adapters"][number],
): string {
  return adapter.provenance === "scaffold"
    ? `adapter:${adapter.adapterId}`
    : `adapter:${adapter.id}`;
}

function flowStepId(flowId: string, stepId: string): string {
  return `flow-step:${flowId}:${stepId}`;
}

function inferredFlowStepId(flowId: string, stepId: string): string {
  return `inferred-flow-step:${flowId}:${stepId}`;
}

function record(
  value: Omit<LlmContextRecord, "schemaVersion" | "text"> & { text?: string },
): LlmContextRecord {
  const text =
    value.text ??
    [value.title, value.summary, JSON.stringify(value.data)].join("\n");
  const result: LlmContextRecord = {
    ...value,
    schemaVersion: LLM_CONTEXT_VERSION,
    text,
  };
  assertContextRecord(result);
  return result;
}

function assertPositiveInteger(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

/**
 * Validate the fixed context envelope without asking Zod to clone every
 * already-typed data payload. The exported Zod schema remains the public
 * parser for untrusted consumers; this assertion protects records assembled
 * inside the projector and keeps its hot path proportional to record count.
 */
function assertContextRecord(value: LlmContextRecord): void {
  if (value.schemaVersion !== LLM_CONTEXT_VERSION) {
    throw new Error(`Context record ${value.id} has an invalid schema version`);
  }
  if (!LLM_CONTEXT_KIND_SET.has(value.kind)) {
    throw new Error(`Context record ${value.id} has an invalid kind`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("Context record id must be a non-empty string");
  }
  if (typeof value.title !== "string" || value.title.length === 0) {
    throw new Error(`Context record ${value.id} title must be non-empty`);
  }
  if (typeof value.summary !== "string" || typeof value.text !== "string") {
    throw new Error(`Context record ${value.id} text fields must be strings`);
  }
  if (value.routePath !== undefined && !value.routePath.startsWith("/")) {
    throw new Error(`Context record ${value.id} route path must start with /`);
  }
  if (value.source) {
    if (
      typeof value.source.filePath !== "string" ||
      value.source.filePath.length === 0
    ) {
      throw new Error(
        `Context record ${value.id} source path must be non-empty`,
      );
    }
    if (value.source.line !== undefined) {
      assertPositiveInteger(value.source.line, `${value.id} source line`);
    }
    if (value.source.column !== undefined) {
      assertPositiveInteger(value.source.column, `${value.id} source column`);
    }
  }
  if (!Array.isArray(value.relationships)) {
    throw new Error(
      `Context record ${value.id} relationships must be an array`,
    );
  }
  for (const relationship of value.relationships) {
    if (
      typeof relationship.type !== "string" ||
      relationship.type.length === 0 ||
      !LLM_CONTEXT_KIND_SET.has(relationship.targetKind) ||
      typeof relationship.targetId !== "string" ||
      relationship.targetId.length === 0
    ) {
      throw new Error(`Context record ${value.id} has an invalid relationship`);
    }
  }
  if (
    typeof value.data !== "object" ||
    value.data === null ||
    Array.isArray(value.data)
  ) {
    throw new Error(`Context record ${value.id} data must be an object`);
  }
}

function relation(
  type: string,
  targetKind: LlmContextKind,
  targetId: string,
): LlmRelationship {
  return { type, targetKind, targetId };
}

interface GraphContextIndex {
  readonly routeIdsByPath: ReadonlyMap<string, readonly string[]>;
  readonly screenById: ReadonlyMap<string, ApplicationGraph["screens"][number]>;
  readonly screensBySource: ReadonlyMap<
    string,
    readonly ApplicationGraph["screens"][number][]
  >;
}

function createGraphContextIndex(graph: ApplicationGraph): GraphContextIndex {
  const routeIdsByPath = new Map<string, Set<string>>();
  const screenById = new Map<string, ApplicationGraph["screens"][number]>();
  const screensBySource = new Map<
    string,
    ApplicationGraph["screens"][number][]
  >();
  for (const screen of graph.screens) {
    screenById.set(screen.id, screen);
    const routeIds = routeIdsByPath.get(screen.routePath) ?? new Set<string>();
    routeIds.add(routeId(screen.framework, screen.routePath));
    routeIdsByPath.set(screen.routePath, routeIds);
    const sourceScreens = screensBySource.get(screen.source.filePath);
    if (sourceScreens) sourceScreens.push(screen);
    else screensBySource.set(screen.source.filePath, [screen]);
  }
  return {
    routeIdsByPath: new Map(
      [...routeIdsByPath].map(([routePath, ids]) => [
        routePath,
        [...ids].sort(),
      ]),
    ),
    screenById,
    screensBySource,
  };
}

function routeRelations(
  graphIndex: GraphContextIndex,
  routePath: string | undefined,
  type: string,
): LlmRelationship[] {
  if (!routePath) return [];
  return (graphIndex.routeIdsByPath.get(routePath) ?? []).map((id) =>
    relation(type, "route", id),
  );
}

function atlasRouteRelationships(
  graph: ApplicationGraph,
  atlas: AtlasOrganization | undefined,
): LlmRelationship[] {
  if (!atlas) return [];
  const prefixes = Object.values(atlas.routeGroups).flatMap(
    (group) => group.prefixes,
  );
  if (prefixes.length === 0) return [];
  const routeIds = new Set(
    graph.screens
      .filter((screen) =>
        prefixes.some(
          (prefix) =>
            prefix === "/" ||
            screen.routePath === prefix ||
            screen.routePath.startsWith(`${prefix}/`),
        ),
      )
      .map((screen) => routeId(screen.framework, screen.routePath)),
  );
  return [...routeIds]
    .sort()
    .map((id) => relation("organizes-route", "route", id));
}

function atlasComponentRelationships(
  graph: ApplicationGraph,
  atlas: AtlasOrganization | undefined,
): LlmRelationship[] {
  if (!atlas || Object.keys(atlas.componentGroups).length === 0) return [];
  return createComponentGroups(graph.components, atlas)
    .filter((group) => group.source === "configured")
    .flatMap((group) => group.componentIds)
    .sort()
    .map((id) => relation("organizes-component", "component", id));
}

function previewRouteRelationships(
  graph: ApplicationGraph,
  previewRoutes: PreviewRouteExamples | undefined,
): LlmRelationship[] {
  if (!previewRoutes) return [];
  const configuredPaths = new Set(Object.keys(previewRoutes));
  const routeIds = new Set(
    graph.screens
      .filter((screen) => configuredPaths.has(screen.routePath))
      .map((screen) => routeId(screen.framework, screen.routePath)),
  );
  return [...routeIds]
    .sort()
    .map((id) => relation("configures-preview", "route", id));
}

function uniqueRelationships(
  relationships: readonly LlmRelationship[],
): LlmRelationship[] {
  const seen = new Set<string>();
  return relationships.filter((relationship) => {
    const key = `${relationship.type}:${relationship.targetKind}:${relationship.targetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contextRecordKey(kind: LlmContextKind, id: string): string {
  return `${kind}\u0000${id}`;
}

interface RouteAtlasContextPlacement {
  section: {
    id: string;
    label: string;
    source: "automatic" | "configured" | "mixed";
    order: number;
    routePrefixes: string[];
  };
  district: {
    id: string;
    label: string;
    source: "automatic" | "configured";
    order: number;
    routePrefixes: string[];
  };
  hierarchy: {
    level: number;
    parentRouteId?: string;
    childRouteIds: string[];
  };
}

function routeAtlasPlacement(
  graph: ApplicationGraph,
  atlas: AtlasOrganization | undefined,
): Map<string, RouteAtlasContextPlacement> {
  const placement = new Map<string, RouteAtlasContextPlacement>();
  const sections = createRouteSections(
    createRouteDistricts(graph.screens, atlas),
  );
  const contextIdBySceneRouteId = new Map(
    sections.flatMap((section) =>
      section.districts.flatMap((district) =>
        district.routes.map(
          (route) =>
            [route.id, routeId(graph.framework, route.routePath)] as const,
        ),
      ),
    ),
  );
  const contextRouteId = (sceneRouteId: string): string => {
    const contextId = contextIdBySceneRouteId.get(sceneRouteId);
    if (!contextId) {
      throw new Error(
        `Route atlas hierarchy references unknown route "${sceneRouteId}"`,
      );
    }
    return contextId;
  };
  for (const section of sections) {
    for (const [districtOrder, district] of section.districts.entries()) {
      for (const route of district.routes) {
        placement.set(route.routePath, {
          section: {
            id: section.id,
            label: section.label,
            source: section.source,
            order: section.order,
            routePrefixes: section.routePrefixes,
          },
          district: {
            id: district.id,
            label: district.label,
            source: district.source,
            order: districtOrder,
            routePrefixes: district.routePrefixes,
          },
          hierarchy: {
            level: route.hierarchyLevel,
            ...(route.parentRouteId
              ? { parentRouteId: contextRouteId(route.parentRouteId) }
              : {}),
            childRouteIds: route.childRouteIds.map(contextRouteId),
          },
        });
      }
    }
  }
  return placement;
}

function componentAtlasPlacement(
  graph: ApplicationGraph,
  atlas: AtlasOrganization | undefined,
): Map<string, Record<string, unknown>> {
  const placement = new Map<string, Record<string, unknown>>();
  for (const group of createComponentGroups(graph.components, atlas)) {
    const value = {
      group: {
        id: group.id,
        label: group.label,
        source: group.source,
        order: group.order,
        sourcePrefix: group.sourcePrefix,
        sourcePrefixes: group.sourcePrefixes,
      },
      coverage: {
        componentCount: group.componentCount,
        routeUsageCount: group.routeUsageCount,
        previewCount: group.previewCount,
        previewStatusCounts: group.previewStatusCounts,
      },
    };
    for (const componentId of group.componentIds) {
      placement.set(componentId, value);
    }
  }
  return placement;
}

function buildRouteRecords(
  graph: ApplicationGraph,
  atlas?: AtlasOrganization,
  adapterRecordsByScreenId: ReadonlyMap<string, readonly string[]> = new Map(),
): LlmContextRecord[] {
  const groups = new Map<string, ApplicationGraph["screens"]>();
  const atlasPlacement = routeAtlasPlacement(graph, atlas);
  for (const screen of graph.screens) {
    const id = routeId(screen.framework, screen.routePath);
    groups.set(id, [...(groups.get(id) ?? []), screen]);
  }

  return [...groups.entries()].map(([id, screens]) => {
    const first = screens[0];
    if (!first) throw new Error(`Route group "${id}" has no screens`);
    const states = [...new Set(screens.map((screen) => screen.state))].sort();
    const adapterIds = [
      ...new Set(
        screens.flatMap((screen) =>
          screen.adapterId ? [screen.adapterId] : [],
        ),
      ),
    ].sort();
    const placement = atlasPlacement.get(first.routePath);
    return record({
      kind: "route",
      id,
      title: first.routePath,
      summary: `${first.framework} route with states: ${states.join(", ")}.`,
      routePath: first.routePath,
      source: first.source,
      relationships: uniqueRelationships([
        ...screens.map((screen) =>
          relation("has-screen-state", "screen", screen.id),
        ),
        ...screens.flatMap((screen) =>
          (adapterRecordsByScreenId.get(screen.id) ?? []).map((adapterId) =>
            relation("discovered-by", "adapter", adapterId),
          ),
        ),
        ...(placement?.hierarchy.parentRouteId
          ? [
              relation(
                "parent-route",
                "route",
                placement.hierarchy.parentRouteId,
              ),
            ]
          : []),
        ...(placement?.hierarchy.childRouteIds.map((childRouteId) =>
          relation("child-route", "route", childRouteId),
        ) ?? []),
      ]),
      data: {
        framework: first.framework,
        adapterIds,
        routePath: first.routePath,
        previewRoute:
          screens.find((screen) => screen.state === "default")?.previewRoute ??
          first.previewRoute,
        group: first.group,
        atlas: placement,
        states,
        screenIds: screens.map((screen) => screen.id),
      },
    });
  });
}

function uniqueFindings(graph: ApplicationGraph, state?: ProjectState) {
  const findings = new Map(
    graph.findings.map((finding) => [finding.id, finding]),
  );
  for (const finding of state?.findings ?? [])
    findings.set(finding.id, finding);
  return [...findings.values()];
}

/** Validate an untrusted graph once, then project the canonical context. */
export function buildLlmContext(input: BuildLlmContextInput): LlmContext {
  return buildLlmContextFromValidatedGraph({
    ...input,
    graph: ApplicationGraphSchema.parse(input.graph),
  });
}

/**
 * Project a graph already accepted at the scanner, protocol, or storage seam.
 * Callers must not use this entry point for untrusted JSON.
 */
export function buildLlmContextFromValidatedGraph(
  input: BuildLlmContextInput,
): LlmContext {
  const graph = input.graph;
  const graphIndex = createGraphContextIndex(graph);
  const notes = input.notes ?? [];
  const flows = input.flows ?? [];
  const adapters = input.adapters ?? [];
  const adapterInventory = input.adapterInventory;
  const adapterCount = adapterInventory?.adapters.length ?? adapters.length;
  const state = input.state;
  const records: LlmContextRecord[] = [];
  const projectId = "project:current";
  const componentPlacement = componentAtlasPlacement(
    graph,
    input.project?.atlas,
  );
  const adapterRecordsByScreenId = new Map<string, string[]>();
  const adapterRecordsByComponentId = new Map<string, string[]>();
  const adapterRecordsByEndpointId = new Map<string, string[]>();
  const adapterRecordsByFlowTransitionId = new Map<string, string[]>();
  const adapterRecordsByInferredFlowId = new Map<string, string[]>();
  for (const adapter of adapterInventory?.adapters ?? []) {
    const targetId = adapterRecordId(adapter);
    for (const screenId of adapter.screenIds) {
      adapterRecordsByScreenId.set(screenId, [
        ...(adapterRecordsByScreenId.get(screenId) ?? []),
        targetId,
      ]);
    }
    for (const componentId of adapter.componentIds) {
      adapterRecordsByComponentId.set(componentId, [
        ...(adapterRecordsByComponentId.get(componentId) ?? []),
        targetId,
      ]);
    }
    for (const endpointId of adapter.endpointIds) {
      adapterRecordsByEndpointId.set(endpointId, [
        ...(adapterRecordsByEndpointId.get(endpointId) ?? []),
        targetId,
      ]);
    }
    for (const transitionId of adapter.flowTransitionIds) {
      adapterRecordsByFlowTransitionId.set(transitionId, [
        ...(adapterRecordsByFlowTransitionId.get(transitionId) ?? []),
        targetId,
      ]);
    }
    for (const flowId of adapter.inferredFlowIds) {
      adapterRecordsByInferredFlowId.set(flowId, [
        ...(adapterRecordsByInferredFlowId.get(flowId) ?? []),
        targetId,
      ]);
    }
  }

  records.push(
    record({
      kind: "project",
      id: projectId,
      title: input.project?.name ?? path.basename(graph.rootDir),
      summary: `${graph.framework} application atlas with ${graph.screens.length} screens, ${graph.components.length} components, ${graph.apiEndpoints.length} API endpoints, ${graph.flowTransitions.length} discovered transitions, ${graph.inferredFlows.length} inferred journeys, ${notes.length} notes, ${flows.length} recorded flows, and ${adapterCount} adapters.`,
      source:
        input.project?.atlas ||
        input.project?.capture ||
        Object.keys(input.project?.previewRoutes ?? {}).length > 0
          ? { filePath: "topo.config.ts", line: 1 }
          : input.lifecycle
            ? { filePath: ".topo/install.json", line: 1 }
            : undefined,
      relationships: uniqueRelationships([
        ...atlasRouteRelationships(graph, input.project?.atlas),
        ...atlasComponentRelationships(graph, input.project?.atlas),
        ...previewRouteRelationships(graph, input.project?.previewRoutes),
        ...graph.apiEndpoints.map((endpoint) =>
          relation("exposes-api-endpoint", "api-endpoint", endpoint.id),
        ),
        ...graph.flowTransitions.map((transition) =>
          relation("has-flow-transition", "flow-transition", transition.id),
        ),
        ...graph.inferredFlows.map((flow) =>
          relation("has-inferred-flow", "inferred-flow", flow.id),
        ),
      ]),
      data: {
        projectRoot: input.project?.projectRoot ?? graph.rootDir,
        sourceRoot: input.project?.sourceRoot ?? graph.rootDir,
        rootDir: graph.rootDir,
        framework: graph.framework,
        recognition: graph.projectRecognition,
        previewBaseUrl: graph.previewBaseUrl,
        profileNames: input.project?.profileNames ?? [],
        ...(input.project?.previewRoutes
          ? { previewRoutes: input.project.previewRoutes }
          : {}),
        ...(input.project?.capture ? { capture: input.project.capture } : {}),
        ...(input.project?.atlas ? { atlas: input.project.atlas } : {}),
        ...(input.project?.studio ? { studio: input.project.studio } : {}),
        ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
        graphVersion: graph.version,
        ...(state ? { jobHistory: state.jobHistory } : {}),
      },
    }),
  );

  if (adapterInventory) {
    for (const adapter of adapterInventory.adapters) {
      const relationships = [relation("extends-project", "project", projectId)];
      if (adapter.kind === "framework" && adapter.active) {
        const routeIds = new Set(
          adapter.screenIds.flatMap((screenId) => {
            const screen = graphIndex.screenById.get(screenId);
            return screen ? [routeId(screen.framework, screen.routePath)] : [];
          }),
        );
        relationships.push(
          ...[...routeIds]
            .sort()
            .map((id) => relation("discovers-route", "route", id)),
        );
      }
      if (adapter.kind === "component-preview" && adapter.active) {
        relationships.push(
          ...adapter.componentIds.map((componentId) =>
            relation("provides-preview", "component", componentId),
          ),
        );
      }
      if (adapter.kind === "api-endpoint" && adapter.active) {
        relationships.push(
          ...adapter.endpointIds.map((endpointId) =>
            relation("discovers-api-endpoint", "api-endpoint", endpointId),
          ),
        );
      }
      if (adapter.kind === "flow-discovery" && adapter.active) {
        relationships.push(
          ...adapter.flowTransitionIds.map((transitionId) =>
            relation(
              "discovers-flow-transition",
              "flow-transition",
              transitionId,
            ),
          ),
          ...adapter.inferredFlowIds.map((flowId) =>
            relation("contributes-to-inference", "inferred-flow", flowId),
          ),
        );
      }
      records.push(
        record({
          kind: "adapter",
          id: adapterRecordId(adapter),
          title: adapter.displayName,
          summary: `${adapter.kind} adapter ${adapter.displayName} is ${adapter.status} with ${adapter.routeCount} routes, ${adapter.previewCount} component previews, ${adapter.endpointCount} API endpoints, ${adapter.transitionCount} flow transitions, and ${adapter.inferredFlowCount} inferred journeys.`,
          source: adapter.manifestPath
            ? { filePath: adapter.manifestPath }
            : adapter.provenance === "configured"
              ? { filePath: "topo.config.ts", line: 1 }
              : undefined,
          relationships,
          data: { ...adapter },
        }),
      );
    }
  } else {
    for (const adapter of adapters) {
      records.push(
        record({
          kind: "adapter",
          id: `adapter:${adapter.manifest.id}`,
          title: adapter.manifest.displayName,
          summary: `${adapter.manifest.kind} adapter scaffold declared at ${adapter.manifest.registration.moduleSpecifier}; registration must be verified from project configuration.`,
          source: { filePath: adapter.filePath },
          relationships: [relation("extends-project", "project", projectId)],
          data: { ...adapter.manifest },
        }),
      );
    }
  }

  for (const profileName of input.project?.profileNames ?? []) {
    records.push(
      record({
        kind: "preview-profile",
        id: `preview-profile:${profileName}`,
        title: profileName,
        summary: `Preview profile "${profileName}". Authentication headers, cookies, and storage are excluded from LLM context.`,
        relationships: [relation("belongs-to", "project", projectId)],
        data: { name: profileName, secretsIncluded: false },
      }),
    );
  }

  records.push(
    ...buildRouteRecords(graph, input.project?.atlas, adapterRecordsByScreenId),
  );

  for (const screen of graph.screens) {
    records.push(
      record({
        kind: "screen",
        id: screen.id,
        title: screen.title,
        summary: `${screen.state} screen for ${screen.routePath}; render status ${screen.renderStatus}.`,
        routePath: screen.routePath,
        source: screen.source,
        relationships: uniqueRelationships([
          relation(
            "screen-state-of",
            "route",
            routeId(screen.framework, screen.routePath),
          ),
          ...(adapterRecordsByScreenId.get(screen.id) ?? []).map((adapterId) =>
            relation("discovered-by", "adapter", adapterId),
          ),
        ]),
        data: screen,
      }),
    );
  }

  for (const component of graph.components) {
    records.push(
      record({
        kind: "component",
        id: component.id,
        title: component.name,
        summary: `Component preview status ${component.previewStatus}; used by ${component.usedBy.length} screens.`,
        source: component.source,
        relationships: uniqueRelationships([
          ...component.usedBy.map((screenId) =>
            relation("used-by", "screen", screenId),
          ),
          ...(adapterRecordsByComponentId.get(component.id) ?? []).map(
            (adapterId) => relation("previewed-by", "adapter", adapterId),
          ),
        ]),
        data: {
          ...component,
          atlas: componentPlacement.get(component.id),
        },
      }),
    );
  }

  for (const endpoint of graph.apiEndpoints) {
    records.push(
      record({
        kind: "api-endpoint",
        id: endpoint.id,
        title: endpoint.title,
        summary:
          endpoint.summary ??
          `${endpoint.method} ${endpoint.path}; ${endpoint.security.status} security; ${endpoint.responses.length} documented responses.`,
        routePath: endpoint.path,
        source: endpoint.discoveries[0]?.source,
        relationships: uniqueRelationships([
          relation("belongs-to", "project", projectId),
          ...(adapterRecordsByEndpointId.get(endpoint.id) ?? []).map(
            (adapterId) => relation("discovered-by", "adapter", adapterId),
          ),
        ]),
        data: endpoint,
        text: [
          endpoint.title,
          endpoint.method,
          endpoint.path,
          endpoint.operationId ?? "",
          endpoint.summary ?? "",
          endpoint.description ?? "",
          endpoint.tags.join(" "),
          JSON.stringify(endpoint.parameters),
          endpoint.requestContentTypes.join(" "),
          JSON.stringify(endpoint.responses),
          JSON.stringify(endpoint.security),
          JSON.stringify(endpoint.discoveries),
        ].join("\n"),
      }),
    );
  }

  for (const edge of graph.edges) {
    const targetKind = graph.apiEndpoints.some(
      (endpoint) => endpoint.id === edge.target,
    )
      ? "api-endpoint"
      : "screen";
    records.push(
      record({
        kind: "edge",
        id: edge.id,
        title: `${edge.kind}: ${edge.source} → ${edge.target}`,
        summary: `${edge.kind} graph edge with ${Math.round(edge.confidence * 100)}% confidence.`,
        source: edge.sourceLocation,
        relationships: [
          relation("source", "screen", edge.source),
          relation("target", targetKind, edge.target),
        ],
        data: edge,
      }),
    );
  }

  for (const finding of uniqueFindings(graph, state)) {
    const matchingScreens = (
      finding.source?.filePath
        ? (graphIndex.screensBySource.get(finding.source.filePath) ?? [])
        : []
    ).map((screen) => relation("observed-on-screen", "screen", screen.id));
    records.push(
      record({
        kind: "finding",
        id: finding.id,
        title: finding.title,
        summary: `${finding.severity} ${finding.status} finding at ${Math.round(finding.confidence * 100)}% confidence. ${finding.description}`,
        source: finding.source,
        relationships: matchingScreens,
        data: finding,
      }),
    );
  }

  for (const issue of graph.sourceIssues) {
    const adapter = adapterInventory?.adapters.find(
      (item) => item.adapterId === issue.adapterId,
    );
    records.push(
      record({
        kind: "issue",
        id: `source-issue:${issue.id}`,
        title: `Unreadable ${issue.area} source`,
        summary: issue.message,
        source: { filePath: issue.filePath },
        relationships: adapter
          ? [relation("reported-by", "adapter", adapterRecordId(adapter))]
          : [relation("concerns-project", "project", projectId)],
        data: issue,
      }),
    );
  }

  for (const transition of graph.flowTransitions) {
    const targetRelationship =
      transition.target.kind === "screen"
        ? relation("transitions-to", "screen", transition.target.screenId)
        : transition.target.kind === "api-endpoint" &&
            transition.target.endpointId
          ? relation(
              "calls-api-endpoint",
              "api-endpoint",
              transition.target.endpointId,
            )
          : undefined;
    records.push(
      record({
        kind: "flow-transition",
        id: transition.id,
        title: transition.action,
        summary: `${transition.kind} from ${transition.sourceRoutePath} with ${Math.round(transition.confidence * 100)}% confidence; target ${transition.target.status}.`,
        routePath: transition.sourceRoutePath,
        source: transition.source,
        relationships: [
          relation("belongs-to", "project", projectId),
          relation("starts-on", "screen", transition.sourceScreenId),
          ...(targetRelationship ? [targetRelationship] : []),
          ...(adapterRecordsByFlowTransitionId.get(transition.id) ?? []).map(
            (adapterId) => relation("discovered-by", "adapter", adapterId),
          ),
        ],
        data: transition,
      }),
    );
  }

  for (const inferred of graph.inferredFlows) {
    const entryStep = inferred.steps.find(
      (step) => step.id === inferred.entryStepId,
    );
    records.push(
      record({
        kind: "inferred-flow",
        id: inferred.id,
        title: inferred.title,
        summary: `${inferred.transitionCount} source transitions form a ${inferred.steps.length}-step read-only candidate at ${Math.round(inferred.confidence * 100)}% confidence${inferred.truncated ? "; bounded traversal truncated" : ""}.`,
        routePath: entryStep?.routePath,
        source: entryStep?.sources[0],
        relationships: [
          relation("belongs-to", "project", projectId),
          ...(adapterRecordsByInferredFlowId.get(inferred.id) ?? []).map(
            (adapterId) => relation("inferred-by", "adapter", adapterId),
          ),
          ...inferred.steps.map((step) =>
            relation(
              "has-step",
              "inferred-flow-step",
              inferredFlowStepId(inferred.id, step.id),
            ),
          ),
          ...inferred.steps.flatMap((step) =>
            step.transitionIds.map((transitionId) =>
              relation("inferred-from", "flow-transition", transitionId),
            ),
          ),
        ],
        data: inferred,
      }),
    );
    for (const step of inferred.steps) {
      const targetRelationship = step.screenId
        ? relation("uses-screen", "screen", step.screenId)
        : step.endpointId
          ? relation("calls-api-endpoint", "api-endpoint", step.endpointId)
          : undefined;
      records.push(
        record({
          kind: "inferred-flow-step",
          id: inferredFlowStepId(inferred.id, step.id),
          title: `${inferred.title} · ${step.title}`,
          summary: `${step.kind} inferred step${step.action ? `: ${step.action}` : ""}.`,
          routePath: step.routePath,
          source: step.sources[0],
          relationships: [
            relation("step-of", "inferred-flow", inferred.id),
            ...(targetRelationship ? [targetRelationship] : []),
            ...step.transitionIds.map((transitionId) =>
              relation("inferred-from", "flow-transition", transitionId),
            ),
            ...step.nextStepIds.map((nextStepId) =>
              relation(
                "next-step",
                "inferred-flow-step",
                inferredFlowStepId(inferred.id, nextStepId),
              ),
            ),
          ],
          data: { inferredFlowId: inferred.id, ...step },
        }),
      );
    }
  }

  for (const doctorCheck of input.doctorReport?.checks ?? []) {
    records.push(
      record({
        kind: "doctor-check",
        id: doctorCheck.id,
        title: doctorCheck.title,
        summary: `${doctorCheck.status} ${doctorCheck.scope} check. ${doctorCheck.detail}`,
        relationships: [relation("belongs-to", "project", projectId)],
        data: {
          ...doctorCheck,
          reportSchemaVersion: input.doctorReport?.schemaVersion,
          observedAt: input.doctorReport?.generatedAt,
        },
        text: [
          doctorCheck.id,
          doctorCheck.title,
          doctorCheck.status,
          doctorCheck.severity,
          doctorCheck.scope,
          doctorCheck.detail,
          doctorCheck.action ?? "",
          JSON.stringify(doctorCheck.evidence),
        ].join("\n"),
      }),
    );
  }

  for (const note of notes) {
    const matchingRoutes = routeRelations(
      graphIndex,
      note.targetRoute,
      "attached-to-route",
    );
    const explicitTarget =
      note.targetKind && note.targetId
        ? [relation("attached-to-entity", note.targetKind, note.targetId)]
        : [];
    const anchoredScreens = note.anchor?.source?.filePath
      ? [...(graphIndex.screensBySource.get(note.anchor.source.filePath) ?? [])]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((screen) => relation("anchored-to-screen", "screen", screen.id))
      : [];
    const anchorStatus = note.anchor?.status ?? "unbound";
    records.push(
      record({
        kind: "note",
        id: note.id,
        title: note.title,
        summary: `${note.status} ${anchorStatus} ${note.type} note${note.targetRoute ? ` attached to ${note.targetRoute}` : ""}.`,
        routePath: note.targetRoute,
        relationships: [
          ...matchingRoutes,
          ...explicitTarget,
          ...anchoredScreens,
        ],
        data: { ...note },
        text: [
          note.title,
          note.body,
          note.type,
          note.status,
          anchorStatus,
          note.author ?? "",
          note.targetRoute ?? "",
          note.targetId ?? "",
          note.anchor ? JSON.stringify(note.anchor) : "",
        ].join("\n"),
      }),
    );
    if (note.targetId && !note.targetKind) {
      records.push(
        record({
          kind: "issue",
          id: `ambiguous-note-target:${note.id}`,
          title: `Ambiguous entity target on note ${note.id}`,
          summary: `Note "${note.title}" has targetId "${note.targetId}" but no targetKind. Add version 1 targetKind frontmatter to make the relationship explicit.`,
          relationships: [relation("concerns-note", "note", note.id)],
          data: {
            issueType: "ambiguous-note-target",
            noteId: note.id,
            targetId: note.targetId,
          },
        }),
      );
    }
  }

  for (const flow of flows) {
    records.push(
      record({
        kind: "flow",
        id: flow.id,
        title: flow.title,
        summary:
          `${flow.status} flow with ${flow.steps.length} steps. ${flow.description}`.trim(),
        relationships: flow.steps.map((step) =>
          relation("has-step", "flow-step", flowStepId(flow.id, step.id)),
        ),
        data: flow,
      }),
    );
    for (const step of flow.steps) {
      const matchingRoutes = routeRelations(
        graphIndex,
        step.routePath,
        "visits-route",
      );
      records.push(
        record({
          kind: "flow-step",
          id: flowStepId(flow.id, step.id),
          title: `${flow.title} · ${step.title}`,
          summary: [step.action, step.expected]
            .filter(Boolean)
            .join(" Expected: "),
          routePath: step.routePath,
          relationships: [
            relation("step-of", "flow", flow.id),
            ...matchingRoutes,
            ...(step.screenId
              ? [relation("uses-screen", "screen", step.screenId)]
              : []),
            ...step.noteIds.map((noteId) =>
              relation("references-note", "note", noteId),
            ),
            ...step.nextStepIds.map((nextStepId) =>
              relation(
                "next-step",
                "flow-step",
                flowStepId(flow.id, nextStepId),
              ),
            ),
          ],
          data: { flowId: flow.id, ...step },
        }),
      );
    }
  }

  for (const snapshot of state?.snapshots ?? []) {
    records.push(
      record({
        kind: "snapshot",
        id: snapshot.id,
        title: `Snapshot ${snapshot.routePath}`,
        summary: `${snapshot.status} snapshot from ${snapshot.capturedAt}${snapshot.width && snapshot.height ? ` at ${snapshot.width}×${snapshot.height}` : ""}.`,
        routePath: snapshot.routePath,
        relationships: [
          relation("captures-screen", "screen", snapshot.screenId),
        ],
        data: {
          ...snapshot,
          mimeType: snapshot.artifactPath ? "image/png" : undefined,
          resourceUri: snapshot.artifactPath
            ? `topo://snapshot/${encodeURIComponent(snapshot.id)}/image`
            : undefined,
        },
      }),
    );
  }

  for (const baseline of state?.visualBaselines ?? []) {
    records.push(
      record({
        kind: "visual-baseline",
        id: baseline.id,
        title: `Baseline ${baseline.routePath}`,
        summary: `Accepted visual baseline from ${baseline.acceptedAt} at ${baseline.width}×${baseline.height}.`,
        routePath: baseline.routePath,
        relationships: [
          relation("baselines-screen", "screen", baseline.screenId),
          relation("accepted-from", "snapshot", baseline.sourceSnapshotId),
        ],
        data: {
          ...baseline,
          mimeType: "image/png",
          resourceUri: `topo://visual-baseline/${encodeURIComponent(baseline.id)}/image`,
        },
      }),
    );
  }

  for (const comparison of state?.visualComparisons ?? []) {
    records.push(
      record({
        kind: "visual-comparison",
        id: comparison.id,
        title: `Visual comparison ${comparison.routePath}`,
        summary: `${comparison.status} comparison from ${comparison.comparedAt}: ${(comparison.changeRatio * 100).toFixed(3)}% of pixels changed.`,
        routePath: comparison.routePath,
        relationships: [
          relation("compares-screen", "screen", comparison.screenId),
          relation("uses-baseline", "visual-baseline", comparison.baselineId),
          relation(
            "compares-snapshot",
            "snapshot",
            comparison.currentSnapshotId,
          ),
        ],
        data: {
          ...comparison,
          mimeType: comparison.artifactPath ? "image/png" : undefined,
          resourceUri: comparison.artifactPath
            ? `topo://visual-comparison/${encodeURIComponent(comparison.id)}/image`
            : undefined,
        },
      }),
    );
  }

  for (const artifact of state?.previewArtifacts ?? []) {
    records.push(
      record({
        kind: "component-preview",
        id: artifact.id,
        title: `${artifact.title} · component preview`,
        summary: `${artifact.status} ${artifact.adapterId} preview from ${artifact.capturedAt}${artifact.width && artifact.height ? ` at ${artifact.width}×${artifact.height}` : ""}.`,
        source: artifact.source,
        relationships: [
          relation("captures-component", "component", artifact.targetId),
        ],
        data: {
          ...artifact,
          mimeType: artifact.artifactPath ? "image/png" : undefined,
          resourceUri: artifact.artifactPath
            ? `topo://component-preview/${encodeURIComponent(artifact.id)}/image`
            : undefined,
        },
      }),
    );
  }

  for (const probe of state?.interactionProbes ?? []) {
    records.push(
      record({
        kind: "interaction-probe",
        id: probe.id,
        title: `${probe.control.label} · interaction probe`,
        summary: `${probe.status} observation on ${probe.routePath} with ${probe.effects.length} recognized effect${probe.effects.length === 1 ? "" : "s"} at ${probe.observedAt}.`,
        routePath: probe.routePath,
        relationships: [
          relation("belongs-to", "project", projectId),
          ...routeRelations(graphIndex, probe.routePath, "probes-route"),
          ...(probe.screenId
            ? [relation("probes-screen", "screen", probe.screenId)]
            : []),
        ],
        data: { ...probe },
      }),
    );
  }

  for (const job of state?.jobs ?? []) {
    records.push(
      record({
        kind: "job",
        id: job.id,
        title: `${job.kind} job`,
        summary: `${job.status} at ${Math.round(job.progress * 100)}%${job.message ? `: ${job.message}` : ""}.`,
        relationships: [relation("belongs-to", "project", projectId)],
        data: { ...job },
      }),
    );
  }

  for (const issue of [
    ...(input.adapterIssues ?? []),
    ...(input.noteIssues ?? []),
    ...(input.flowIssues ?? []),
    ...(input.lifecycleIssues ?? []),
  ]) {
    records.push(
      record({
        kind: "issue",
        id: `read-issue:${issue.filePath}`,
        title: `Unreadable source record: ${issue.filePath}`,
        summary: issue.message,
        source: { filePath: issue.filePath },
        relationships: [relation("belongs-to", "project", projectId)],
        data: { ...issue },
      }),
    );
  }

  const knownRecords = new Set<string>();
  const integrityIssues: LlmContextRecord[] = [];
  for (const item of records) {
    const key = contextRecordKey(item.kind, item.id);
    if (knownRecords.has(key)) {
      integrityIssues.push(
        record({
          kind: "issue",
          id: `duplicate-record:${item.kind}:${item.id}`,
          title: `Duplicate context record: ${item.kind} ${item.id}`,
          summary: `More than one ${item.kind} record uses the stable id "${item.id}".`,
          relationships: [relation("belongs-to", "project", projectId)],
          data: {
            issueType: "duplicate-record",
            recordKind: item.kind,
            recordId: item.id,
          },
        }),
      );
    }
    knownRecords.add(key);
  }
  for (const item of records) {
    for (const [index, relationship] of item.relationships.entries()) {
      if (
        knownRecords.has(
          contextRecordKey(relationship.targetKind, relationship.targetId),
        )
      )
        continue;
      integrityIssues.push(
        record({
          kind: "issue",
          id: `dangling-relationship:${item.kind}:${item.id}:${index}`,
          title: `Dangling relationship from ${item.kind} ${item.id}`,
          summary: `${relationship.type} references missing ${relationship.targetKind} "${relationship.targetId}".`,
          relationships: [relation("belongs-to", "project", projectId)],
          data: {
            issueType: "dangling-relationship",
            sourceKind: item.kind,
            sourceId: item.id,
            relationship,
          },
        }),
      );
    }
  }
  records.push(...integrityIssues);

  const kindOrder = new Map(
    LLM_CONTEXT_KINDS.map((kind, index) => [kind, index]),
  );
  records.sort(
    (left, right) =>
      (kindOrder.get(left.kind) ?? 999) - (kindOrder.get(right.kind) ?? 999) ||
      left.id.localeCompare(right.id),
  );

  const counts = Object.fromEntries(
    LLM_CONTEXT_KINDS.map((kind) => [kind, 0]),
  ) as Record<LlmContextKind, number>;
  for (const item of records) counts[item.kind] += 1;
  const warnings = records
    .filter((item) => item.kind === "issue")
    .map((item) => item.summary);
  const files = {
    manifest: "manifest.json",
    schema: "schema.json",
    markdown: "context.md",
    records: "records.jsonl",
    collections: "records/<kind>.jsonl",
  };
  const manifest = LlmContextManifestSchema.parse({
    schemaVersion: LLM_CONTEXT_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    project: {
      name: input.project?.name,
      projectRoot: input.project?.projectRoot ?? graph.rootDir,
      sourceRoot: input.project?.sourceRoot ?? graph.rootDir,
      rootDir: graph.rootDir,
      framework: graph.framework,
      previewBaseUrl: graph.previewBaseUrl,
      profileNames: input.project?.profileNames ?? [],
      previewRoutes: input.project?.previewRoutes,
      atlas: input.project?.atlas,
      studio: input.project?.studio,
      lifecycle: input.lifecycle,
    },
    totalRecords: records.length,
    counts,
    kinds: LLM_CONTEXT_KINDS.map((kind) => ({
      kind,
      ...LLM_KIND_CATALOG[kind],
    })),
    warnings,
    files,
  });
  return { manifest, records, graph };
}

export async function loadLlmContext(
  rootDir: string,
  graph: ApplicationGraph,
  project?: LlmProjectMetadata,
  runtime?: { doctorReport?: DoctorReport },
): Promise<LlmContext> {
  const [adapterInspection, noteInspection, flowInspection, state, lifecycle] =
    await Promise.all([
      inspectAdapterScaffolds(rootDir),
      createNoteStore(rootDir).inspect(),
      createFlowStore(rootDir).inspect(),
      createProjectStateStore(rootDir).read(),
      inspectProjectLifecycle(rootDir),
    ]);
  return buildLlmContextFromValidatedGraph({
    graph,
    adapterInventory: buildAdapterInventory({
      graph,
      inspection: adapterInspection,
      extensions: project?.extensions,
    }),
    notes: noteInspection.notes,
    flows: flowInspection.flows,
    state,
    noteIssues: noteInspection.issues,
    flowIssues: flowInspection.issues,
    adapterIssues: adapterInspection.issues,
    lifecycle: lifecycle.metadata,
    lifecycleIssues: lifecycle.issues,
    project,
    doctorReport: runtime?.doctorReport,
  });
}

async function inspectProjectLifecycle(rootDir: string): Promise<{
  metadata?: ProjectLifecycleMetadata;
  issues: LifecycleReadIssue[];
}> {
  const filePath = ".topo/install.json";
  try {
    const raw = JSON.parse(
      await readFile(path.join(path.resolve(rootDir), filePath), "utf8"),
    ) as unknown;
    const parsed = StoredProjectLifecycleMetadataSchema.safeParse(raw);
    if (parsed.success) {
      return {
        metadata: { ...parsed.data, sourceFile: filePath },
        issues: [],
      };
    }
    const version =
      typeof raw === "object" &&
      raw !== null &&
      "schemaVersion" in raw &&
      typeof raw.schemaVersion === "number"
        ? raw.schemaVersion
        : "unknown";
    return {
      issues: [
        {
          filePath,
          message: `Topo install metadata uses version ${String(version)} or is malformed; version 3 is required. Run topo migrate before relying on lifecycle evidence.`,
        },
      ],
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { issues: [] };
    }
    return {
      issues: [
        {
          filePath,
          message:
            error instanceof SyntaxError
              ? "Topo install metadata is not valid JSON."
              : error instanceof Error
                ? error.message
                : String(error),
        },
      ],
    };
  }
}

function normalizeLimit(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.min(100, Math.max(1, Math.trunc(value ?? 25)))
    : 25;
}

function normalizeOffset(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value ?? 0)) : 0;
}

export function queryLlmContext(
  context: LlmContext,
  query: LlmContextQuery = {},
): LlmContextQueryResult {
  const tokens = (query.query ?? "")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const kinds = query.kinds?.length ? new Set(query.kinds) : undefined;
  const ranked = context.records
    .filter((item) => !kinds || kinds.has(item.kind))
    .filter((item) => !query.routePath || item.routePath === query.routePath)
    .map((item) => {
      const haystack =
        `${item.id}\n${item.title}\n${item.summary}\n${item.text}`.toLocaleLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return undefined;
      const phrase = (query.query ?? "").trim().toLocaleLowerCase();
      const score =
        (phrase && item.id.toLocaleLowerCase() === phrase ? 100 : 0) +
        (phrase && item.title.toLocaleLowerCase().includes(phrase) ? 40 : 0) +
        tokens.reduce(
          (total, token) =>
            total + (item.summary.toLocaleLowerCase().includes(token) ? 5 : 1),
          0,
        );
      return { item, score };
    })
    .filter(
      (value): value is { item: LlmContextRecord; score: number } =>
        value !== undefined,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.kind.localeCompare(right.item.kind) ||
        left.item.id.localeCompare(right.item.id),
    );
  const offset = normalizeOffset(query.offset);
  const limit = normalizeLimit(query.limit);
  const items = ranked.slice(offset, offset + limit).map(({ item }) => item);
  const hasMore = offset + items.length < ranked.length;
  return {
    total: ranked.length,
    count: items.length,
    offset,
    items,
    hasMore,
    ...(hasMore ? { nextOffset: offset + items.length } : {}),
  };
}

export function getLlmContextRecord(
  context: LlmContext,
  kind: LlmContextKind,
  id: string,
): LlmContextRecord | undefined {
  return context.records.find((item) => item.kind === kind && item.id === id);
}

export function renderLlmQueryMarkdown(result: LlmContextQueryResult): string {
  const lines = [
    `# Topo context query`,
    "",
    `Showing ${result.count} of ${result.total} matching records from offset ${result.offset}.`,
    "",
  ];
  for (const item of result.items) {
    lines.push(
      `## ${item.title}`,
      "",
      `- Kind: \`${item.kind}\``,
      `- ID: \`${item.id}\``,
    );
    if (item.routePath) lines.push(`- Route: \`${item.routePath}\``);
    if (item.source)
      lines.push(
        `- Source: \`${item.source.filePath}${item.source.line ? `:${item.source.line}` : ""}\``,
      );
    lines.push("", item.summary || "(no summary)", "");
  }
  if (result.hasMore)
    lines.push(
      `More records are available at offset ${result.nextOffset}.`,
      "",
    );
  return lines.join("\n");
}

export function renderLlmContextMarkdown(context: LlmContext): string {
  const routes = context.records.filter((item) => item.kind === "route");
  const displayedRoutes = routes.slice(0, 100);
  const lines = [
    "# Topo LLM context",
    "",
    `Generated: ${context.manifest.generatedAt}`,
    `Framework: ${context.manifest.project.framework}`,
    `Records: ${context.manifest.totalRecords}`,
    "",
    "## Record counts",
    "",
    ...LLM_CONTEXT_KINDS.map(
      (kind) => `- ${kind}: ${context.manifest.counts[kind] ?? 0}`,
    ),
    "",
    "## Routes",
    "",
    "| Route | Summary |",
    "| --- | --- |",
    ...displayedRoutes.map(
      (item) =>
        `| ${item.routePath ?? "—"} | ${item.summary.replace(/\|/g, "\\|")} |`,
    ),
  ];
  if (displayedRoutes.length < routes.length) {
    lines.push(
      "",
      `${routes.length - displayedRoutes.length} additional routes are available in records/route.jsonl.`,
    );
  }
  if (context.manifest.warnings.length) {
    lines.push(
      "",
      "## Read warnings",
      "",
      ...context.manifest.warnings.map((warning) => `- ${warning}`),
    );
  }
  lines.push(
    "",
    "## Reading the complete context",
    "",
    "Use manifest.json for discovery, schema.json for the record contract, records.jsonl for all records, or records/<kind>.jsonl for one bounded collection.",
    "",
  );
  return lines.join("\n");
}

export const LLM_CONTEXT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `https://topo.local/schemas/llm-context-v${LLM_CONTEXT_VERSION}.json`,
  title: "Topo LLM Context Record",
  type: "object",
  required: [
    "schemaVersion",
    "kind",
    "id",
    "title",
    "summary",
    "text",
    "relationships",
    "data",
  ],
  properties: {
    schemaVersion: { const: LLM_CONTEXT_VERSION },
    kind: { enum: LLM_CONTEXT_KINDS },
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    summary: { type: "string" },
    text: { type: "string" },
    routePath: { type: "string", pattern: "^/" },
    source: {
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "targetKind", "targetId"],
        properties: {
          type: { type: "string" },
          targetKind: { enum: LLM_CONTEXT_KINDS },
          targetId: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    data: { type: "object" },
  },
  additionalProperties: false,
} as const;

function jsonLines(records: readonly LlmContextRecord[]): string {
  return records.length
    ? `${records.map((item) => JSON.stringify(item)).join("\n")}\n`
    : "";
}

export async function exportLlmContext(
  rootDir: string,
  context: LlmContext,
): Promise<LlmContextExportResult> {
  const directory = path.join(path.resolve(rootDir), ".topo", "llm");
  const recordDirectory = path.join(directory, "records");
  await mkdir(recordDirectory, { recursive: true });
  const manifestPath = path.join(directory, "manifest.json");
  const recordsPath = path.join(directory, "records.jsonl");
  const markdownPath = path.join(directory, "context.md");
  const schemaPath = path.join(directory, "schema.json");
  await Promise.all([
    writeFile(
      manifestPath,
      `${JSON.stringify(context.manifest, null, 2)}\n`,
      "utf8",
    ),
    writeFile(recordsPath, jsonLines(context.records), "utf8"),
    writeFile(markdownPath, renderLlmContextMarkdown(context), "utf8"),
    writeFile(
      schemaPath,
      `${JSON.stringify(LLM_CONTEXT_JSON_SCHEMA, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(directory, "README.md"),
      "# Generated Topo LLM context\n\nThis directory is derived from application source, Markdown notes, JSON flows, diagnostics, route snapshots, accepted visual baselines, pixel comparisons, component preview captures, and local job state. Do not edit generated files by hand. Run `topo context export` to refresh them.\n",
      "utf8",
    ),
    ...LLM_CONTEXT_KINDS.map((kind) =>
      writeFile(
        path.join(recordDirectory, `${kind}.jsonl`),
        jsonLines(context.records.filter((item) => item.kind === kind)),
        "utf8",
      ),
    ),
  ]);
  return { directory, manifestPath, recordsPath, markdownPath, schemaPath };
}

export async function readSnapshotArtifact(
  rootDir: string,
  id: string,
): Promise<SnapshotArtifact | undefined> {
  const state = await createProjectStateStore(rootDir).read();
  const snapshot: StoredSnapshot | undefined = state.snapshots.find(
    (item) => item.id === id,
  );
  if (!snapshot?.artifactPath) return undefined;
  const absoluteRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(absoluteRoot, snapshot.artifactPath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Snapshot artifact escapes the project root");
  return {
    id,
    artifactPath: snapshot.artifactPath,
    mimeType: "image/png",
    data: await readFile(absolutePath),
  };
}

export async function readComponentPreviewArtifact(
  rootDir: string,
  id: string,
): Promise<ComponentPreviewImageArtifact | undefined> {
  const state = await createProjectStateStore(rootDir).read();
  const artifact = state.previewArtifacts.find((item) => item.id === id);
  if (!artifact?.artifactPath) return undefined;
  const absoluteRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(absoluteRoot, artifact.artifactPath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Component preview artifact escapes the project root");
  }
  return {
    id,
    artifactPath: artifact.artifactPath,
    mimeType: "image/png",
    data: await readFile(absolutePath),
  };
}

async function readVisualArtifact(
  rootDir: string,
  id: string,
  kind: "baseline" | "comparison",
): Promise<VisualImageArtifact | undefined> {
  const state = await createProjectStateStore(rootDir).read();
  const artifact =
    kind === "baseline"
      ? state.visualBaselines.find((item) => item.id === id)
      : state.visualComparisons.find((item) => item.id === id);
  if (!artifact?.artifactPath) return undefined;
  const absoluteRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(absoluteRoot, artifact.artifactPath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Visual ${kind} artifact escapes the project root`);
  }
  return {
    id,
    artifactPath: artifact.artifactPath,
    mimeType: "image/png",
    data: await readFile(absolutePath),
  };
}

export function readVisualBaselineArtifact(
  rootDir: string,
  id: string,
): Promise<VisualImageArtifact | undefined> {
  return readVisualArtifact(rootDir, id, "baseline");
}

export function readVisualComparisonArtifact(
  rootDir: string,
  id: string,
): Promise<VisualImageArtifact | undefined> {
  return readVisualArtifact(rootDir, id, "comparison");
}
