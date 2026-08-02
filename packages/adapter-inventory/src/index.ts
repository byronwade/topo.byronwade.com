import { z } from "zod";

import type {
  AdapterScaffoldInspection,
  AdapterScaffoldKind,
} from "@topo/adapter-scaffold";
import type { ApplicationGraph } from "@topo/schema";

export const AdapterInventoryKindSchema = z.enum([
  "framework",
  "component-preview",
  "api-endpoint",
  "flow-discovery",
  "application-runtime",
]);

export const AdapterInventoryProvenanceSchema = z.enum([
  "built-in",
  "scaffold",
  "configured",
  "observed",
]);

export const AdapterInventoryStatusSchema = z.enum([
  "active",
  "registered",
  "declared",
  "available",
]);

export const AdapterInventoryRegistrationSchema = z
  .object({
    configKey: z.enum([
      "frameworkAdapters",
      "componentPreviewAdapters",
      "apiEndpointAdapters",
      "flowAdapters",
      "applicationRuntimeAdapters",
    ]),
    moduleSpecifier: z.string().min(1),
  })
  .strict();

export const AdapterInventoryEntrySchema = z
  .object({
    id: z.string().min(1),
    adapterId: z.string().min(1),
    displayName: z.string().min(1),
    kind: AdapterInventoryKindSchema,
    provenance: AdapterInventoryProvenanceSchema,
    status: AdapterInventoryStatusSchema,
    active: z.boolean(),
    registered: z.boolean(),
    routeCount: z.number().int().nonnegative(),
    previewCount: z.number().int().nonnegative(),
    endpointCount: z.number().int().nonnegative().default(0),
    transitionCount: z.number().int().nonnegative().default(0),
    inferredFlowCount: z.number().int().nonnegative().default(0),
    screenIds: z.array(z.string().min(1)).default([]),
    componentIds: z.array(z.string().min(1)).default([]),
    endpointIds: z.array(z.string().min(1)).default([]),
    flowTransitionIds: z.array(z.string().min(1)).default([]),
    inferredFlowIds: z.array(z.string().min(1)).default([]),
    moduleSpecifier: z.string().min(1).optional(),
    manifestPath: z.string().min(1).optional(),
    registration: AdapterInventoryRegistrationSchema.optional(),
  })
  .strict();

export const AdapterInventoryIssueSchema = z
  .object({
    filePath: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const AdapterInventoryResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    adapters: z.array(AdapterInventoryEntrySchema),
    issues: z.array(AdapterInventoryIssueSchema),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
        registered: z.number().int().nonnegative(),
        declared: z.number().int().nonnegative(),
        issues: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type AdapterInventoryKind = z.infer<typeof AdapterInventoryKindSchema>;
export type AdapterInventoryEntry = z.infer<typeof AdapterInventoryEntrySchema>;
export type AdapterInventoryResponse = z.infer<
  typeof AdapterInventoryResponseSchema
>;

export interface AdapterInventoryExtensions {
  frameworkAdapters?: string[];
  componentPreviewAdapters?: string[];
  apiEndpointAdapters?: string[];
  flowAdapters?: string[];
  applicationRuntimeAdapters?: string[];
}

export interface BuildAdapterInventoryInput {
  graph: ApplicationGraph;
  inspection: AdapterScaffoldInspection;
  extensions?: AdapterInventoryExtensions;
  activeRuntimeAdapterId?: string;
}

interface BuiltInAdapter {
  adapterId: string;
  displayName: string;
  kind: AdapterInventoryKind;
}

const BUILT_IN_ADAPTERS: BuiltInAdapter[] = [
  {
    adapterId: "topo.next",
    displayName: "Next.js",
    kind: "framework",
  },
  {
    adapterId: "topo.tanstack",
    displayName: "TanStack Router",
    kind: "framework",
  },
  {
    adapterId: "topo.react",
    displayName: "React",
    kind: "framework",
  },
  {
    adapterId: "topo.vue",
    displayName: "Vue",
    kind: "framework",
  },
  {
    adapterId: "topo.nuxt",
    displayName: "Nuxt",
    kind: "framework",
  },
  {
    adapterId: "topo.svelte",
    displayName: "Svelte",
    kind: "framework",
  },
  {
    adapterId: "storybook",
    displayName: "Storybook",
    kind: "component-preview",
  },
  {
    adapterId: "topo",
    displayName: "Topo previews",
    kind: "component-preview",
  },
  {
    adapterId: "source-api",
    displayName: "Framework and router source APIs",
    kind: "api-endpoint",
  },
  {
    adapterId: "openapi",
    displayName: "OpenAPI contracts",
    kind: "api-endpoint",
  },
  {
    adapterId: "source-flow",
    displayName: "Source flow discovery",
    kind: "flow-discovery",
  },
  {
    adapterId: "next",
    displayName: "Next.js development server",
    kind: "application-runtime",
  },
  {
    adapterId: "tanstack",
    displayName: "TanStack development server",
    kind: "application-runtime",
  },
  {
    adapterId: "nuxt",
    displayName: "Nuxt development server",
    kind: "application-runtime",
  },
  {
    adapterId: "vite",
    displayName: "Vite development server",
    kind: "application-runtime",
  },
  {
    adapterId: "package-script",
    displayName: "Package script",
    kind: "application-runtime",
  },
];

const CONFIG_KEY_BY_KIND = {
  framework: "frameworkAdapters",
  "component-preview": "componentPreviewAdapters",
  "api-endpoint": "apiEndpointAdapters",
  "flow-discovery": "flowAdapters",
  "application-runtime": "applicationRuntimeAdapters",
} as const satisfies Record<
  AdapterScaffoldKind,
  keyof AdapterInventoryExtensions
>;

function frameworkScreensForAdapter(
  graph: ApplicationGraph,
  adapterId: string,
): ApplicationGraph["screens"] {
  return graph.screens.filter((screen) => {
    if (screen.adapterId) return screen.adapterId === adapterId;
    if (adapterId === "topo.next") return screen.framework.startsWith("next-");
    if (adapterId === "topo.tanstack")
      return screen.framework.startsWith("tanstack-");
    return screen.framework === adapterId;
  });
}

interface PreviewMembership {
  componentIds: string[];
  previewCount: number;
}

function previewMemberships(
  graph: ApplicationGraph,
): Map<string, PreviewMembership> {
  const memberships = new Map<string, PreviewMembership>();
  for (const component of graph.components) {
    for (const source of component.previewSources ?? []) {
      const membership = memberships.get(source.adapterId) ?? {
        componentIds: [],
        previewCount: 0,
      };
      membership.previewCount += 1;
      if (!membership.componentIds.includes(component.id)) {
        membership.componentIds.push(component.id);
      }
      memberships.set(source.adapterId, membership);
    }
  }
  for (const membership of memberships.values()) {
    membership.componentIds.sort();
  }
  return memberships;
}

function modulesForKind(
  extensions: AdapterInventoryExtensions,
  kind: AdapterInventoryKind,
): string[] {
  return extensions[CONFIG_KEY_BY_KIND[kind]] ?? [];
}

function routeCountForScreens(screens: ApplicationGraph["screens"]): number {
  return new Set(screens.map((screen) => screen.routePath)).size;
}

function endpointIdsForAdapter(
  graph: ApplicationGraph,
  adapterId: string,
): string[] {
  return graph.apiEndpoints
    .filter((endpoint) => endpoint.adapterIds.includes(adapterId))
    .map((endpoint) => endpoint.id)
    .sort();
}

function flowMembershipForAdapter(
  graph: ApplicationGraph,
  adapterId: string,
): { flowTransitionIds: string[]; inferredFlowIds: string[] } {
  return {
    flowTransitionIds: graph.flowTransitions
      .filter((transition) => transition.adapterId === adapterId)
      .map((transition) => transition.id)
      .sort(),
    inferredFlowIds: graph.inferredFlows
      .filter((flow) => flow.adapterIds.includes(adapterId))
      .map((flow) => flow.id)
      .sort(),
  };
}

export function buildAdapterInventory({
  graph,
  inspection,
  extensions = {},
  activeRuntimeAdapterId,
}: BuildAdapterInventoryInput): AdapterInventoryResponse {
  const previewsByAdapter = previewMemberships(graph);
  const adapters: AdapterInventoryEntry[] = [];

  for (const builtIn of BUILT_IN_ADAPTERS) {
    const frameworkScreens =
      builtIn.kind === "framework"
        ? frameworkScreensForAdapter(graph, builtIn.adapterId)
        : [];
    const previewMembership = previewsByAdapter.get(builtIn.adapterId);
    const endpointIds =
      builtIn.kind === "api-endpoint"
        ? endpointIdsForAdapter(graph, builtIn.adapterId)
        : [];
    const flowMembership =
      builtIn.kind === "flow-discovery"
        ? flowMembershipForAdapter(graph, builtIn.adapterId)
        : { flowTransitionIds: [], inferredFlowIds: [] };
    const active =
      builtIn.kind === "framework"
        ? frameworkScreens.length > 0
        : builtIn.kind === "component-preview"
          ? Boolean(previewMembership?.previewCount)
          : builtIn.kind === "api-endpoint"
            ? endpointIds.length > 0
            : builtIn.kind === "flow-discovery"
              ? flowMembership.flowTransitionIds.length > 0
          : activeRuntimeAdapterId === builtIn.adapterId;
    adapters.push({
      id: `builtin:${builtIn.kind}:${builtIn.adapterId}`,
      ...builtIn,
      provenance: "built-in",
      status: active ? "active" : "available",
      active,
      registered: false,
      routeCount: routeCountForScreens(frameworkScreens),
      previewCount:
        builtIn.kind === "component-preview"
          ? (previewMembership?.previewCount ?? 0)
          : 0,
      endpointCount: endpointIds.length,
      transitionCount: flowMembership.flowTransitionIds.length,
      inferredFlowCount: flowMembership.inferredFlowIds.length,
      screenIds: frameworkScreens.map((screen) => screen.id).sort(),
      componentIds:
        builtIn.kind === "component-preview"
          ? (previewMembership?.componentIds ?? [])
          : [],
      endpointIds,
      flowTransitionIds: flowMembership.flowTransitionIds,
      inferredFlowIds: flowMembership.inferredFlowIds,
    });
  }

  const scaffoldModules = new Set<string>();
  const scaffoldIds = new Set<string>();
  for (const inspected of inspection.adapters) {
    const { manifest } = inspected;
    const configuredModules = modulesForKind(extensions, manifest.kind);
    const registered = configuredModules.includes(
      manifest.registration.moduleSpecifier,
    );
    const frameworkScreens =
      manifest.kind === "framework"
        ? frameworkScreensForAdapter(graph, manifest.id)
        : [];
    const previewMembership = previewsByAdapter.get(manifest.id);
    const endpointIds =
      manifest.kind === "api-endpoint"
        ? endpointIdsForAdapter(graph, manifest.id)
        : [];
    const flowMembership =
      manifest.kind === "flow-discovery"
        ? flowMembershipForAdapter(graph, manifest.id)
        : { flowTransitionIds: [], inferredFlowIds: [] };
    const active =
      manifest.kind === "framework"
        ? frameworkScreens.length > 0
        : manifest.kind === "component-preview"
          ? Boolean(previewMembership?.previewCount)
          : manifest.kind === "api-endpoint"
            ? endpointIds.length > 0
            : manifest.kind === "flow-discovery"
              ? flowMembership.flowTransitionIds.length > 0
          : activeRuntimeAdapterId === manifest.id;
    scaffoldModules.add(manifest.registration.moduleSpecifier);
    scaffoldIds.add(`${manifest.kind}:${manifest.id}`);
    adapters.push({
      id: `scaffold:${manifest.kind}:${manifest.id}`,
      adapterId: manifest.id,
      displayName: manifest.displayName,
      kind: manifest.kind,
      provenance: "scaffold",
      status: active ? "active" : registered ? "registered" : "declared",
      active,
      registered,
      routeCount: routeCountForScreens(frameworkScreens),
      previewCount:
        manifest.kind === "component-preview"
          ? (previewMembership?.previewCount ?? 0)
          : 0,
      endpointCount: endpointIds.length,
      transitionCount: flowMembership.flowTransitionIds.length,
      inferredFlowCount: flowMembership.inferredFlowIds.length,
      screenIds: frameworkScreens.map((screen) => screen.id).sort(),
      componentIds:
        manifest.kind === "component-preview"
          ? (previewMembership?.componentIds ?? [])
          : [],
      endpointIds,
      flowTransitionIds: flowMembership.flowTransitionIds,
      inferredFlowIds: flowMembership.inferredFlowIds,
      moduleSpecifier: manifest.registration.moduleSpecifier,
      manifestPath: inspected.filePath,
      registration: manifest.registration,
    });
  }

  for (const kind of AdapterInventoryKindSchema.options) {
    const configKey = CONFIG_KEY_BY_KIND[kind];
    for (const moduleSpecifier of modulesForKind(extensions, kind)) {
      if (scaffoldModules.has(moduleSpecifier)) continue;
      adapters.push({
        id: `configured:${kind}:${moduleSpecifier}`,
        adapterId: moduleSpecifier,
        displayName: moduleSpecifier,
        kind,
        provenance: "configured",
        status: "registered",
        active: false,
        registered: true,
        routeCount: 0,
        previewCount: 0,
        endpointCount: 0,
        transitionCount: 0,
        inferredFlowCount: 0,
        screenIds: [],
        componentIds: [],
        endpointIds: [],
        flowTransitionIds: [],
        inferredFlowIds: [],
        moduleSpecifier,
        registration: { configKey, moduleSpecifier },
      });
    }
  }

  const builtInPreviewIds = new Set(
    BUILT_IN_ADAPTERS.filter(
      (adapter) => adapter.kind === "component-preview",
    ).map((adapter) => adapter.adapterId),
  );
  const builtInFrameworkIds = new Set(
    BUILT_IN_ADAPTERS.filter((adapter) => adapter.kind === "framework").map(
      (adapter) => adapter.adapterId,
    ),
  );
  const builtInEndpointIds = new Set(
    BUILT_IN_ADAPTERS.filter((adapter) => adapter.kind === "api-endpoint").map(
      (adapter) => adapter.adapterId,
    ),
  );
  const observedFrameworkIds = new Set(
    graph.screens.flatMap((screen) =>
      screen.adapterId ? [screen.adapterId] : [],
    ),
  );
  for (const adapterId of [...observedFrameworkIds].sort()) {
    if (
      builtInFrameworkIds.has(adapterId) ||
      scaffoldIds.has(`framework:${adapterId}`)
    ) {
      continue;
    }
    const frameworkScreens = frameworkScreensForAdapter(graph, adapterId);
    adapters.push({
      id: `observed:framework:${adapterId}`,
      adapterId,
      displayName: adapterId,
      kind: "framework",
      provenance: "observed",
      status: "active",
      active: true,
      registered: false,
      routeCount: routeCountForScreens(frameworkScreens),
      previewCount: 0,
      endpointCount: 0,
      transitionCount: 0,
      inferredFlowCount: 0,
      screenIds: frameworkScreens.map((screen) => screen.id).sort(),
      componentIds: [],
      endpointIds: [],
      flowTransitionIds: [],
      inferredFlowIds: [],
    });
  }
  for (const [adapterId, membership] of previewsByAdapter) {
    if (
      builtInPreviewIds.has(adapterId) ||
      scaffoldIds.has(`component-preview:${adapterId}`)
    ) {
      continue;
    }
    adapters.push({
      id: `observed:component-preview:${adapterId}`,
      adapterId,
      displayName: adapterId,
      kind: "component-preview",
      provenance: "observed",
      status: "active",
      active: true,
      registered: false,
      routeCount: 0,
      previewCount: membership.previewCount,
      endpointCount: 0,
      transitionCount: 0,
      inferredFlowCount: 0,
      screenIds: [],
      componentIds: membership.componentIds,
      endpointIds: [],
      flowTransitionIds: [],
      inferredFlowIds: [],
    });
  }
  const observedEndpointIds = new Set(
    graph.apiEndpoints.flatMap((endpoint) => endpoint.adapterIds),
  );
  for (const adapterId of [...observedEndpointIds].sort()) {
    if (
      builtInEndpointIds.has(adapterId) ||
      scaffoldIds.has(`api-endpoint:${adapterId}`)
    ) {
      continue;
    }
    const endpointIds = endpointIdsForAdapter(graph, adapterId);
    adapters.push({
      id: `observed:api-endpoint:${adapterId}`,
      adapterId,
      displayName: adapterId,
      kind: "api-endpoint",
      provenance: "observed",
      status: "active",
      active: true,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: endpointIds.length,
      transitionCount: 0,
      inferredFlowCount: 0,
      screenIds: [],
      componentIds: [],
      endpointIds,
      flowTransitionIds: [],
      inferredFlowIds: [],
    });
  }
  const builtInFlowIds = new Set(
    BUILT_IN_ADAPTERS.filter((adapter) => adapter.kind === "flow-discovery").map(
      (adapter) => adapter.adapterId,
    ),
  );
  const observedFlowIds = new Set(
    graph.flowTransitions.map((transition) => transition.adapterId),
  );
  for (const adapterId of [...observedFlowIds].sort()) {
    if (
      builtInFlowIds.has(adapterId) ||
      scaffoldIds.has(`flow-discovery:${adapterId}`)
    ) {
      continue;
    }
    const membership = flowMembershipForAdapter(graph, adapterId);
    adapters.push({
      id: `observed:flow-discovery:${adapterId}`,
      adapterId,
      displayName: adapterId,
      kind: "flow-discovery",
      provenance: "observed",
      status: "active",
      active: true,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: 0,
      transitionCount: membership.flowTransitionIds.length,
      inferredFlowCount: membership.inferredFlowIds.length,
      screenIds: [],
      componentIds: [],
      endpointIds: [],
      flowTransitionIds: membership.flowTransitionIds,
      inferredFlowIds: membership.inferredFlowIds,
    });
  }

  adapters.sort((left, right) => left.id.localeCompare(right.id));
  const response: AdapterInventoryResponse = {
    schemaVersion: 1,
    adapters,
    issues: inspection.issues.map((issue) => ({ ...issue })),
    summary: {
      total: adapters.length,
      active: adapters.filter((adapter) => adapter.active).length,
      registered: adapters.filter((adapter) => adapter.registered).length,
      declared: adapters.filter((adapter) => adapter.status === "declared")
        .length,
      issues: inspection.issues.length,
    },
  };

  return AdapterInventoryResponseSchema.parse(response);
}
