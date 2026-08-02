import { z } from "zod";

import { GraphVersion } from "./constants.js";

export { GraphVersion } from "./constants.js";
export { emptyApplicationGraph } from "./factories.js";

export const BuiltInFrameworkSchema = z.enum([
  "next-app",
  "next-pages",
  "tanstack-router",
  "tanstack-start",
  "react",
  "react-router",
  "vue",
  "vue-router",
  "nuxt",
  "svelte",
  "sveltekit",
  "mixed",
  "unknown",
]);

export type BuiltInFramework = z.infer<typeof BuiltInFrameworkSchema>;

/**
 * Framework ids are intentionally open so third-party adapters can contribute
 * graph nodes without requiring a Topo schema release.
 */
export const FrameworkSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);

export type Framework = z.infer<typeof FrameworkSchema>;

export const ScreenStateSchema = z.enum([
  "default",
  "loading",
  "error",
  "not-found",
  "empty",
  "unknown",
]);

export type ScreenState = z.infer<typeof ScreenStateSchema>;

export const SourceLocationSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});

export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const SourceReadIssueSchema = z.object({
  filePath: z.string().min(1),
  message: z.string().min(1),
});

export type SourceReadIssue = z.infer<typeof SourceReadIssueSchema>;

/**
 * Sanitized project-owned capture policy. This deliberately excludes browser
 * executable paths, authentication profiles, headers, cookies, storage, and
 * every other capability-bearing preview value.
 */
export const PreviewCapturePolicySchema = z.object({
  version: z.literal(1),
  autoCapture: z.boolean(),
  headless: z.boolean(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});

export type PreviewCapturePolicy = z.infer<typeof PreviewCapturePolicySchema>;

export const ExtensionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);

export const GraphSourceIssueSchema = SourceReadIssueSchema.extend({
  version: z.literal(1),
  id: z.string().min(1),
  area: z.enum(["api-endpoint", "flow-discovery", "source"]),
  adapterId: ExtensionIdSchema.optional(),
});

export type GraphSourceIssue = z.infer<typeof GraphSourceIssueSchema>;

export const AtlasRouteGroupIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message:
    "Atlas route group IDs begin with a lowercase letter and use lowercase letters, numbers, or hyphens",
});

const AtlasRoutePrefixSchema = z
  .string()
  .regex(/^\/(?:[^/?#]+(?:\/[^/?#]+)*)?$/, {
    message:
      "Atlas route group prefixes must be canonical absolute route paths",
  });

export const AtlasRouteGroupRuleSchema = z.object({
  label: z.string().min(1),
  order: z.number().int().nonnegative().default(100),
  prefixes: z
    .array(AtlasRoutePrefixSchema)
    .min(1)
    .refine((prefixes) => new Set(prefixes).size === prefixes.length, {
      message: "Atlas route group prefixes must be unique",
    }),
});

export type AtlasRouteGroupRule = z.infer<typeof AtlasRouteGroupRuleSchema>;

export const AtlasComponentGroupIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, {
    message:
      "Atlas component group IDs begin with a lowercase letter and use lowercase letters, numbers, or hyphens",
  });

const AtlasComponentSourcePrefixSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.split("/").includes(".."),
    "Atlas component prefixes must be source-root-relative POSIX paths",
  );

export const AtlasComponentGroupRuleSchema = z.object({
  label: z.string().min(1),
  order: z.number().int().nonnegative().default(100),
  prefixes: z
    .array(AtlasComponentSourcePrefixSchema)
    .min(1)
    .refine((prefixes) => new Set(prefixes).size === prefixes.length, {
      message: "Atlas component group prefixes must be unique",
    }),
});

export type AtlasComponentGroupRule = z.infer<
  typeof AtlasComponentGroupRuleSchema
>;

export const AtlasOrganizationSchema = z
  .object({
    version: z.literal(1).default(1),
    routeGroups: z
      .record(AtlasRouteGroupIdSchema, AtlasRouteGroupRuleSchema)
      .default({}),
    componentGroups: z
      .record(AtlasComponentGroupIdSchema, AtlasComponentGroupRuleSchema)
      .default({}),
  })
  .superRefine((organization, context) => {
    const owners = new Map<string, string>();
    for (const [groupId, group] of Object.entries(organization.routeGroups)) {
      for (const prefix of group.prefixes) {
        const owner = owners.get(prefix);
        if (owner) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["routeGroups", groupId, "prefixes"],
            message: `Atlas route prefix "${prefix}" is already owned by "${owner}"`,
          });
        } else {
          owners.set(prefix, groupId);
        }
      }
    }
    const componentOwners = new Map<string, string>();
    for (const [groupId, group] of Object.entries(
      organization.componentGroups,
    )) {
      for (const prefix of group.prefixes) {
        const owner = componentOwners.get(prefix);
        if (owner) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["componentGroups", groupId, "prefixes"],
            message: `Atlas component prefix "${prefix}" is already owned by "${owner}"`,
          });
        } else {
          componentOwners.set(prefix, groupId);
        }
      }
    }
  })
  .default({});

export type AtlasOrganization = z.infer<typeof AtlasOrganizationSchema>;

function routeSegmentsWithNoQuery(routePath: string): string[] {
  return (routePath.split("?", 1)[0] ?? routePath).split("/").filter(Boolean);
}

/** True when a route still contains a built-in framework parameter token. */
export function isParameterizedRoutePath(routePath: string): boolean {
  return routeSegmentsWithNoQuery(routePath).some(
    (segment) =>
      /\[{1,2}(?:\.\.\.)?[^\]]+\]{1,2}/.test(segment) ||
      /(?:^|[-_.]):[^/]+/.test(segment) ||
      /^\$[^/]+$/.test(segment),
  );
}

function previewRoutePathIssue(value: string): string | undefined {
  if (!/^\/(?:[^#]*)$/.test(value) || value.startsWith("//")) {
    return "Preview route examples must be absolute application paths without another origin or hash";
  }
  if (isParameterizedRoutePath(value)) {
    return "Preview route examples must replace every route parameter";
  }
  return undefined;
}

export const PreviewRoutePathSchema = z
  .string()
  .superRefine((value, context) => {
    const message = previewRoutePathIssue(value);
    if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
  });

/** Simple project-owned examples keyed by canonical discovered route identity. */
export const PreviewRouteExamplesSchema = z
  .record(z.string(), PreviewRoutePathSchema)
  .superRefine((examples, context) => {
    for (const routePath of Object.keys(examples)) {
      if (!/^\/(?:[^?#]*)$/.test(routePath) || routePath.startsWith("//")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [routePath],
          message:
            "Preview route keys must be absolute application paths without another origin, query, or hash",
        });
      }
    }
  })
  .default({});

export type PreviewRouteExamples = z.infer<typeof PreviewRouteExamplesSchema>;

export type ScreenPreviewRoute =
  | { version: 1; status: "identity"; path: string }
  | {
      version: 1;
      status: "configured";
      path: string;
      source: "topo.config.ts";
    }
  | { version: 1; status: "unresolved"; reason: string };

function isScreenPreviewRoute(value: unknown): value is ScreenPreviewRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  if (route.version !== 1) return false;
  if (route.status === "unresolved") {
    return typeof route.reason === "string" && route.reason.length > 0;
  }
  if (route.status !== "identity" && route.status !== "configured") {
    return false;
  }
  if (
    typeof route.path !== "string" ||
    previewRoutePathIssue(route.path) !== undefined
  ) {
    return false;
  }
  return route.status === "identity" || route.source === "topo.config.ts";
}

export const ScreenPreviewRouteSchema = z.custom<ScreenPreviewRoute>(
  isScreenPreviewRoute,
  { message: "Invalid version-one screen preview route" },
);

export function resolveScreenPreviewRoute(
  routePath: string,
  examples: PreviewRouteExamples = {},
): ScreenPreviewRoute {
  const configuredPath = examples[routePath];
  if (configuredPath) {
    return {
      version: 1,
      status: "configured",
      path: configuredPath,
      source: "topo.config.ts",
    };
  }
  if (isParameterizedRoutePath(routePath)) {
    return {
      version: 1,
      status: "unresolved",
      reason: `Add preview.routes[${JSON.stringify(routePath)}] to topo.config.ts with one concrete local path.`,
    };
  }
  return { version: 1, status: "identity", path: routePath };
}

export const ComponentPreviewReadinessSchema = z.object({
  readySelector: z.string().min(1),
  errorSelector: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
});

export type ComponentPreviewReadiness = z.infer<
  typeof ComponentPreviewReadinessSchema
>;

export const ComponentPreviewSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  adapterId: ExtensionIdSchema,
  discovery: z
    .enum(["storybook", "colocated", "configured", "automatic", "generated"])
    .optional(),
  source: SourceLocationSchema,
  exportName: z.string().min(1).optional(),
  locator: z.string().min(1),
  priority: z.number().int().min(0).max(1_000).optional(),
  readiness: ComponentPreviewReadinessSchema.optional(),
});

export type ComponentPreviewSource = z.infer<
  typeof ComponentPreviewSourceSchema
>;

export const ContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const ComponentPreviewArtifactSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  targetKind: z.literal("component"),
  targetId: z.string().min(1),
  previewId: z.string().min(1),
  adapterId: ExtensionIdSchema,
  title: z.string().min(1),
  source: SourceLocationSchema,
  capturedAt: z.string().datetime(),
  status: z.enum(["captured", "failed"]),
  artifactPath: z.string().min(1).optional(),
  contentHash: ContentHashSchema.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  error: z.string().min(1).optional(),
});

export type ComponentPreviewArtifact = z.infer<
  typeof ComponentPreviewArtifactSchema
>;

export const RouteSnapshotSchema = z.object({
  id: z.string().min(1),
  screenId: z.string().min(1),
  routePath: z.string().startsWith("/"),
  previewPath: PreviewRoutePathSchema.optional(),
  capturedAt: z.string().datetime(),
  status: z.enum(["captured", "failed"]),
  artifactPath: z.string().min(1).optional(),
  contentHash: ContentHashSchema.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  error: z.string().min(1).optional(),
});

export type RouteSnapshot = z.infer<typeof RouteSnapshotSchema>;

export const VisualBaselineSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  screenId: z.string().min(1),
  routePath: z.string().startsWith("/"),
  sourceSnapshotId: z.string().min(1),
  acceptedAt: z.string().datetime(),
  artifactPath: z.string().min(1),
  contentHash: ContentHashSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type VisualBaseline = z.infer<typeof VisualBaselineSchema>;

export const VisualComparisonStatusSchema = z.enum([
  "unchanged",
  "changed",
  "dimension-changed",
  "failed",
]);

export type VisualComparisonStatus = z.infer<
  typeof VisualComparisonStatusSchema
>;

export const VisualComparisonSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  screenId: z.string().min(1),
  routePath: z.string().startsWith("/"),
  baselineId: z.string().min(1),
  baselineHash: ContentHashSchema,
  currentSnapshotId: z.string().min(1),
  currentHash: ContentHashSchema,
  comparedAt: z.string().datetime(),
  status: VisualComparisonStatusSchema,
  threshold: z.number().min(0).max(1),
  changedPixels: z.number().int().nonnegative(),
  totalPixels: z.number().int().positive(),
  changeRatio: z.number().min(0).max(1),
  baselineSize: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  currentSize: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  artifactPath: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export type VisualComparison = z.infer<typeof VisualComparisonSchema>;

export const ScreenNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("screen"),
  title: z.string().min(1),
  routePath: z.string().min(1),
  framework: FrameworkSchema,
  /** Exact route-discovery adapter identity when emitted by a current scanner. */
  adapterId: ExtensionIdSchema.optional(),
  state: ScreenStateSchema,
  group: z.string().min(1),
  source: SourceLocationSchema,
  previewRoute: ScreenPreviewRouteSchema.optional(),
  renderStatus: z.enum(["unseen", "captured", "live", "blocked"]),
  tags: z.array(z.string()).default([]),
});

export type ScreenNode = z.infer<typeof ScreenNodeSchema>;

/** Backward-compatible preview path for graph records created before v1 evidence. */
export function screenPreviewPath(screen: ScreenNode): string | undefined {
  if (screen.previewRoute?.status === "unresolved") return undefined;
  return screen.previewRoute?.path ?? screen.routePath;
}

export const ComponentNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("component"),
  name: z.string().min(1),
  source: SourceLocationSchema,
  previewStatus: z.enum(["renderable", "missing", "blocked", "unknown"]),
  previewSources: z.array(ComponentPreviewSourceSchema).default([]),
  usedBy: z.array(z.string()).default([]),
});

export type ComponentNode = z.infer<typeof ComponentNodeSchema>;

export const HTTP_METHODS = [
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
] as const;

export const HttpMethodSchema = z.enum(HTTP_METHODS);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const ApiEndpointParameterSchema = z.object({
  name: z.string().min(1),
  in: z.enum(["path", "query", "header", "cookie"]),
  required: z.boolean(),
  description: z.string().min(1).optional(),
  schema: z.record(z.unknown()).optional(),
});

export type ApiEndpointParameter = z.infer<
  typeof ApiEndpointParameterSchema
>;

export const ApiEndpointResponseSchema = z.object({
  status: z.string().min(1),
  description: z.string().min(1).optional(),
  contentTypes: z.array(z.string().min(1)).default([]),
});

export type ApiEndpointResponse = z.infer<typeof ApiEndpointResponseSchema>;

export const ApiEndpointDiscoverySchema = z.object({
  adapterId: ExtensionIdSchema,
  kind: z.enum(["framework-source", "router-source", "openapi"]),
  framework: FrameworkSchema.optional(),
  source: SourceLocationSchema,
  confidence: z.number().min(0).max(1),
});

export type ApiEndpointDiscovery = z.infer<
  typeof ApiEndpointDiscoverySchema
>;

export const ApiEndpointNodeSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  kind: z.literal("api-endpoint"),
  protocol: z.literal("http"),
  method: HttpMethodSchema,
  path: z.string().startsWith("/"),
  title: z.string().min(1),
  operationId: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  frameworks: z.array(FrameworkSchema).default([]),
  adapterIds: z.array(ExtensionIdSchema).min(1),
  tags: z.array(z.string().min(1)).default([]),
  parameters: z.array(ApiEndpointParameterSchema).default([]),
  requestContentTypes: z.array(z.string().min(1)).default([]),
  responses: z.array(ApiEndpointResponseSchema).default([]),
  security: z.object({
    status: z.enum(["declared", "none", "unknown"]),
    schemes: z.array(z.string().min(1)).default([]),
  }),
  discoveries: z.array(ApiEndpointDiscoverySchema).min(1),
});

export type ApiEndpointNode = z.infer<typeof ApiEndpointNodeSchema>;

export const ProjectRecognitionFrameworkSchema = z.object({
  framework: FrameworkSchema,
  confidence: z.number().min(0).max(1),
  adapterIds: z.array(ExtensionIdSchema).min(1),
  reasons: z.array(z.string().min(1)).min(1),
});

export type ProjectRecognitionFramework = z.infer<
  typeof ProjectRecognitionFrameworkSchema
>;

export const ProjectCapabilitySchema = z.object({
  id: z.enum([
    "routing",
    "api",
    "component-previews",
    "storybook",
    "playwright",
    "testing",
    "typescript",
  ]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)).min(1),
  sources: z.array(SourceLocationSchema).default([]),
});

export type ProjectCapability = z.infer<typeof ProjectCapabilitySchema>;

/**
 * Evidence-backed project recognition derived from the same immutable source
 * snapshot used for route, component, and endpoint discovery.
 */
export const ProjectRecognitionSchema = z.object({
  version: z.literal(1),
  status: z.enum(["recognized", "mixed", "unknown"]),
  frameworks: z.array(ProjectRecognitionFrameworkSchema),
  capabilities: z.array(ProjectCapabilitySchema),
  sourceFileCount: z.number().int().nonnegative(),
});

export type ProjectRecognition = z.infer<typeof ProjectRecognitionSchema>;

export const FlowTransitionKindSchema = z.enum([
  "navigation",
  "redirect",
  "submission",
  "request",
]);

export type FlowTransitionKind = z.infer<typeof FlowTransitionKindSchema>;

export const FlowTransitionTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("screen"),
    status: z.literal("resolved"),
    routePath: z.string().startsWith("/"),
    screenId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("route"),
    status: z.literal("unresolved"),
    routePath: z.string().startsWith("/"),
  }),
  z.object({
    kind: z.literal("api-endpoint"),
    status: z.enum(["resolved", "unresolved"]),
    method: HttpMethodSchema,
    path: z.string().startsWith("/"),
    endpointId: z.string().min(1).optional(),
  }),
]);

export type FlowTransitionTarget = z.infer<
  typeof FlowTransitionTargetSchema
>;

/** One statically discovered action from a canonical source screen. */
export const FlowTransitionSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  adapterId: ExtensionIdSchema,
  kind: FlowTransitionKindSchema,
  sourceScreenId: z.string().min(1),
  sourceRoutePath: z.string().startsWith("/"),
  target: FlowTransitionTargetSchema,
  action: z.string().min(1),
  source: SourceLocationSchema,
  confidence: z.number().min(0).max(1),
});

export type FlowTransition = z.infer<typeof FlowTransitionSchema>;

export const InferredFlowStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["screen", "api-endpoint", "unresolved-route"]),
  title: z.string().min(1),
  routePath: z.string().startsWith("/").optional(),
  screenId: z.string().min(1).optional(),
  endpointId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  transitionIds: z.array(z.string().min(1)).default([]),
  sources: z.array(SourceLocationSchema).default([]),
  nextStepIds: z.array(z.string().min(1)).default([]),
});

export type InferredFlowStep = z.infer<typeof InferredFlowStepSchema>;

/**
 * A read-only, evidence-backed journey candidate. It never replaces or writes
 * an authoritative `.topo/flows/*.json` record.
 */
export const InferredFlowSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    entryStepId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    adapterIds: z.array(ExtensionIdSchema).min(1),
    transitionCount: z.number().int().positive(),
    truncated: z.boolean(),
    steps: z.array(InferredFlowStepSchema).min(2),
  })
  .superRefine((flow, context) => {
    const stepIds = new Set(flow.steps.map((step) => step.id));
    if (!stepIds.has(flow.entryStepId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entryStepId"],
        message: `Inferred flow entry step "${flow.entryStepId}" does not exist`,
      });
    }
    for (const [index, step] of flow.steps.entries()) {
      for (const nextStepId of step.nextStepIds) {
        if (!stepIds.has(nextStepId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", index, "nextStepIds"],
            message: `Inferred flow next step "${nextStepId}" does not exist`,
          });
        }
      }
    }
  });

export type InferredFlow = z.infer<typeof InferredFlowSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: z.enum(["hierarchy", "navigation", "related"]),
  confidence: z.number().min(0).max(1),
  adapterId: ExtensionIdSchema.optional(),
  label: z.string().min(1).optional(),
  sourceLocation: SourceLocationSchema.optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high"]),
  status: z.enum(["open", "accepted", "resolved", "ignored"]),
  title: z.string().min(1),
  description: z.string().min(1),
  source: SourceLocationSchema.optional(),
  evidence: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export type Finding = z.infer<typeof FindingSchema>;

export const RuntimeEffectKindSchema = z.enum([
  "navigation",
  "network",
  "dom",
  "dialog",
  "form-submit",
  "download",
  "focus",
  "storage",
  "app-event",
  "runtime-error",
]);

export type RuntimeEffectKind = z.infer<typeof RuntimeEffectKindSchema>;

export const RuntimeEffectSchema = z.object({
  kind: RuntimeEffectKindSchema,
  summary: z.string().min(1),
});

export type RuntimeEffect = z.infer<typeof RuntimeEffectSchema>;

export const InteractionProbeArtifactSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  routePath: z.string().startsWith("/"),
  previewPath: PreviewRoutePathSchema.optional(),
  screenId: z.string().min(1).optional(),
  control: z.object({
    index: z.number().int().min(-1),
    id: z.string().min(1),
    label: z.string().min(1),
    tagName: z.string().min(1),
    role: z.string().min(1),
    locator: z.string().min(1),
  }),
  status: z.enum([
    "effect-observed",
    "possibly-inert",
    "skipped",
    "activation-error",
  ]),
  effects: z.array(RuntimeEffectSchema).default([]),
  evidence: z.array(z.string().min(1)).default([]),
  observedAt: z.string().datetime(),
  error: z.string().min(1).optional(),
});

export type InteractionProbeArtifact = z.infer<
  typeof InteractionProbeArtifactSchema
>;

export function parseInteractionProbeArtifact(
  value: unknown,
): InteractionProbeArtifact {
  return InteractionProbeArtifactSchema.parse(value);
}

export const NOTE_TYPES = [
  "element",
  "screen",
  "region",
  "flow",
  "checklist",
  "decision",
  "canvas",
] as const;

export const NOTE_VERSION = 1 as const;

export const NOTE_TARGET_KINDS = [
  "screen",
  "component",
  "api-endpoint",
  "edge",
  "finding",
  "flow",
  "flow-step",
  "snapshot",
] as const;

export const NOTE_STATUSES = ["open", "resolved"] as const;

export const NOTE_ANCHOR_STATUSES = [
  "unbound",
  "attached",
  "drifted",
  "orphaned",
] as const;

export const NoteTypeSchema = z.enum(NOTE_TYPES);
export const NoteTargetKindSchema = z.enum(NOTE_TARGET_KINDS);
export const NoteStatusSchema = z.enum(NOTE_STATUSES);
export const NoteAnchorStatusSchema = z.enum(NOTE_ANCHOR_STATUSES);

export type NoteType = z.infer<typeof NoteTypeSchema>;
export type NoteTargetKind = z.infer<typeof NoteTargetKindSchema>;
export type NoteStatus = z.infer<typeof NoteStatusSchema>;
export type NoteAnchorStatus = z.infer<typeof NoteAnchorStatusSchema>;

export const NoteAnchorSchema = z
  .object({
    status: NoteAnchorStatusSchema,
    source: SourceLocationSchema.strict().optional(),
    componentSymbol: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    accessibleName: z.string().min(1).optional(),
    testLocator: z.string().min(1).optional(),
    domFingerprint: z.string().min(1).optional(),
    coordinates: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1).optional(),
        height: z.number().positive().max(1).optional(),
      })
      .strict()
      .optional(),
    driftPixels: z.number().nonnegative().optional(),
    verifiedAt: z.string().datetime().optional(),
  })
  .strict();

export type NoteAnchor = z.infer<typeof NoteAnchorSchema>;

export const NoteIdSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/,
    "Note id must use only letters, numbers, dots, colons, underscores, and hyphens",
  );

export const NoteRecordSchema = z
  .object({
    version: z.literal(NOTE_VERSION),
    id: NoteIdSchema,
    type: NoteTypeSchema,
    title: z.string().trim().min(1),
    body: z.string(),
    targetKind: NoteTargetKindSchema.optional(),
    targetId: z.string().min(1).optional(),
    targetRoute: z.string().startsWith("/").optional(),
    status: NoteStatusSchema.default("open"),
    author: z.string().trim().min(1).optional(),
    anchor: NoteAnchorSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type NoteRecord = z.infer<typeof NoteRecordSchema>;

export const WriteNoteInputSchema = z
  .object({
    id: NoteIdSchema.optional(),
    type: NoteTypeSchema.optional(),
    title: z.string().trim().min(1),
    body: z.string().optional(),
    targetKind: NoteTargetKindSchema.optional(),
    targetId: z.string().min(1).optional(),
    targetRoute: z.string().startsWith("/").optional(),
    status: NoteStatusSchema.optional(),
    author: z.string().trim().min(1).optional(),
    anchor: NoteAnchorSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.targetId && !input.targetKind) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "targetId requires targetKind",
      });
    }
  });

export type WriteNoteInput = z.input<typeof WriteNoteInputSchema>;

export const UpdateNoteInputSchema = z
  .object({
    type: NoteTypeSchema.optional(),
    title: z.string().trim().min(1).optional(),
    body: z.string().optional(),
    targetKind: NoteTargetKindSchema.nullable().optional(),
    targetId: z.string().min(1).nullable().optional(),
    targetRoute: z.string().startsWith("/").nullable().optional(),
    status: NoteStatusSchema.optional(),
    author: z.string().trim().min(1).nullable().optional(),
    anchor: NoteAnchorSchema.nullable().optional(),
  })
  .strict();

export type UpdateNoteInput = z.infer<typeof UpdateNoteInputSchema>;

export const FlowStatusSchema = z.enum(["draft", "verified", "deprecated"]);

export type FlowStatus = z.infer<typeof FlowStatusSchema>;

export const FlowIdSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/,
    "Flow id must use only letters, numbers, dots, colons, underscores, and hyphens",
  );

export const FlowStepIdSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/,
    "Flow step id must use only letters, numbers, dots, colons, underscores, and hyphens",
  );

export const FlowStepSchema = z.object({
  id: FlowStepIdSchema,
  title: z.string().min(1),
  routePath: z.string().startsWith("/").optional(),
  screenId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  expected: z.string().min(1).optional(),
  noteIds: z.array(z.string().min(1)).default([]),
  nextStepIds: z.array(z.string().min(1)).default([]),
});

export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowSchema = z
  .object({
    version: z.literal(1),
    id: FlowIdSchema,
    title: z.string().min(1),
    description: z.string().default(""),
    status: FlowStatusSchema.default("draft"),
    entryStepId: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).default([]),
    steps: z.array(FlowStepSchema).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((flow, context) => {
    const ids = new Set<string>();
    for (const [index, step] of flow.steps.entries()) {
      if (ids.has(step.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "id"],
          message: `Flow step id "${step.id}" is duplicated`,
        });
      }
      ids.add(step.id);
    }

    if (flow.entryStepId && !ids.has(flow.entryStepId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entryStepId"],
        message: `Entry step "${flow.entryStepId}" does not exist`,
      });
    }

    for (const [index, step] of flow.steps.entries()) {
      for (const nextStepId of step.nextStepIds) {
        if (!ids.has(nextStepId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", index, "nextStepIds"],
            message: `Next step "${nextStepId}" does not exist`,
          });
        }
      }
    }
  });

export type Flow = z.infer<typeof FlowSchema>;

export const WriteFlowInputSchema = z
  .object({
    id: FlowIdSchema.optional(),
    title: z.string().trim().min(1),
    description: z.string().optional(),
    status: FlowStatusSchema.optional(),
    entryStepId: FlowStepIdSchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
    steps: z.array(FlowStepSchema).optional(),
  })
  .strict();

export type WriteFlowInput = z.input<typeof WriteFlowInputSchema>;

export const UpdateFlowInputSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    status: FlowStatusSchema.optional(),
    entryStepId: FlowStepIdSchema.nullable().optional(),
    tags: z.array(z.string().min(1)).optional(),
    steps: z.array(FlowStepSchema).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "A flow update must include at least one field",
  });

export type UpdateFlowInput = z.infer<typeof UpdateFlowInputSchema>;

export function parseFlow(value: unknown): Flow {
  return FlowSchema.parse(value);
}

export const ApplicationGraphSchema = z.object({
  version: z.literal(GraphVersion),
  generatedAt: z.string().datetime(),
  rootDir: z.string().min(1),
  previewBaseUrl: z.string().url().default("http://localhost:3000"),
  framework: FrameworkSchema,
  screens: z.array(ScreenNodeSchema),
  components: z.array(ComponentNodeSchema),
  apiEndpoints: z.array(ApiEndpointNodeSchema).default([]),
  projectRecognition: ProjectRecognitionSchema.default({
    version: 1,
    status: "unknown",
    frameworks: [],
    capabilities: [],
    sourceFileCount: 0,
  }),
  flowTransitions: z.array(FlowTransitionSchema).default([]),
  inferredFlows: z.array(InferredFlowSchema).default([]),
  edges: z.array(GraphEdgeSchema),
  findings: z.array(FindingSchema),
  sourceIssues: z.array(GraphSourceIssueSchema).default([]),
});

export type ApplicationGraph = z.infer<typeof ApplicationGraphSchema>;

export function parseApplicationGraph(value: unknown): ApplicationGraph {
  return ApplicationGraphSchema.parse(value);
}
