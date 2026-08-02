import { z } from "zod";

import {
  ApplicationGraphSchema,
  ComponentPreviewArtifactSchema,
  FindingSchema,
  FlowSchema,
  InteractionProbeArtifactSchema,
  NoteRecordSchema,
  PreviewCapturePolicySchema,
  RouteSnapshotSchema,
  SourceReadIssueSchema,
  VisualBaselineSchema,
  VisualComparisonSchema,
  type ApplicationGraph,
} from "@topo/schema";

export {
  AdapterInventoryEntrySchema,
  AdapterInventoryIssueSchema,
  AdapterInventoryKindSchema,
  AdapterInventoryProvenanceSchema,
  AdapterInventoryRegistrationSchema,
  AdapterInventoryResponseSchema,
  AdapterInventoryStatusSchema,
} from "@topo/adapter-inventory";
export type {
  AdapterInventoryEntry,
  AdapterInventoryKind,
  AdapterInventoryResponse,
} from "@topo/adapter-inventory";

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  pid: z.number().int().positive(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ProjectSettingsResponseSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  projectRoot: z.string().min(1),
  sourceRoot: z.string().min(1),
  configPath: z.string().min(1),
  capture: PreviewCapturePolicySchema,
});

export type ProjectSettingsResponse = z.infer<
  typeof ProjectSettingsResponseSchema
>;

const ArtifactImageUrlSchema = z.string().url();

export const NotesResponseSchema = z.object({
  schemaVersion: z.literal(1),
  notes: z.array(NoteRecordSchema),
  issues: z.array(SourceReadIssueSchema),
});

export type NotesResponse = z.infer<typeof NotesResponseSchema>;

export const FlowsResponseSchema = z.object({
  schemaVersion: z.literal(1),
  flows: z.array(FlowSchema),
  issues: z.array(SourceReadIssueSchema),
});

export type FlowsResponse = z.infer<typeof FlowsResponseSchema>;

export const SnapshotResponseRecordSchema = RouteSnapshotSchema.extend({
  imageUrl: ArtifactImageUrlSchema.optional(),
});

export const SnapshotsResponseSchema = z.object({
  schemaVersion: z.literal(1),
  snapshots: z.array(SnapshotResponseRecordSchema),
});

export type SnapshotsResponse = z.infer<typeof SnapshotsResponseSchema>;

export const ComponentPreviewResponseRecordSchema =
  ComponentPreviewArtifactSchema.extend({
    imageUrl: ArtifactImageUrlSchema.optional(),
  });

export const ComponentPreviewsResponseSchema = z.object({
  schemaVersion: z.literal(1),
  previewArtifacts: z.array(ComponentPreviewResponseRecordSchema),
});

export type ComponentPreviewsResponse = z.infer<
  typeof ComponentPreviewsResponseSchema
>;

export const ComponentPreviewScaffoldRequestSchema = z.object({
  componentId: z.string().min(1).max(2_048),
});

export type ComponentPreviewScaffoldRequest = z.infer<
  typeof ComponentPreviewScaffoldRequestSchema
>;

export const ComponentPreviewScaffoldResultSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: z.string().min(1),
  componentName: z.string().min(1),
  componentSource: z.string().min(1),
  previewSource: z.string().min(1),
  exportName: z.string().min(1),
  exportKind: z.enum(["function", "const", "class", "default"]),
  requiredProps: z.number().int().nonnegative(),
  mode: z.enum(["ready", "fixture-required"]),
  canApply: z.literal(true),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  templateHash: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  conflicts: z.array(z.never()).length(0),
  status: z.literal("created"),
  createdAt: z.string().datetime(),
});

export type ComponentPreviewScaffoldResult = z.infer<
  typeof ComponentPreviewScaffoldResultSchema
>;

export const ComponentPreviewScaffoldResponseSchema = z.object({
  schemaVersion: z.literal(1),
  result: ComponentPreviewScaffoldResultSchema,
  graph: ApplicationGraphSchema,
});

export type ComponentPreviewScaffoldResponse = z.infer<
  typeof ComponentPreviewScaffoldResponseSchema
>;

export const InteractionProbesResponseSchema = z.object({
  schemaVersion: z.literal(1),
  interactionProbes: z.array(InteractionProbeArtifactSchema),
});

export type InteractionProbesResponse = z.infer<
  typeof InteractionProbesResponseSchema
>;

export const PreviewGatewaySessionSchema = z.object({
  profileName: z.string().min(1),
  baseUrl: z.string().url(),
  launchUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export type PreviewGatewaySession = z.infer<typeof PreviewGatewaySessionSchema>;

export const PreviewGatewaySessionsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessions: z.array(PreviewGatewaySessionSchema),
  })
  .superRefine((value, context) => {
    const profileNames = new Set<string>();
    const origins = new Set<string>();
    for (const [index, session] of value.sessions.entries()) {
      if (profileNames.has(session.profileName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "profileName"],
          message: `Duplicate preview profile: ${session.profileName}`,
        });
      }
      profileNames.add(session.profileName);
      const origin = new URL(session.baseUrl).origin;
      if (origins.has(origin)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "baseUrl"],
          message: `Preview profiles must use isolated origins: ${origin}`,
        });
      }
      origins.add(origin);
      if (new URL(session.launchUrl).origin !== origin) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "launchUrl"],
          message: "Preview launch URL must use its profile origin",
        });
      }
    }
  });

export type PreviewGatewaySessionsResponse = z.infer<
  typeof PreviewGatewaySessionsResponseSchema
>;

export const StudioEntryIdSchema = z.string().regex(/^[a-z][A-Za-z0-9-]*$/, {
  message:
    "Studio entry IDs begin with a lowercase letter and use letters, numbers, or hyphens",
});

export const StudioDestinationPathSchema = z
  .string()
  .regex(/^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/, {
    message: "Studio destination paths must be absolute pathnames",
  });

export const StudioLocalUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      url.protocol === "http:" &&
      (host === "localhost" || host === "::1" || host.startsWith("127."))
    );
  }, "Studio destination URLs must use loopback HTTP");

export const StudioCustomizationSchema = z
  .object({
    defaultDestination: StudioEntryIdSchema.optional(),
    remove: z
      .object({
        destinations: z.array(StudioEntryIdSchema).default([]),
        commands: z.array(StudioEntryIdSchema).default([]),
      })
      .default({}),
    destinations: z
      .record(
        StudioEntryIdSchema,
        z.object({
          label: z.string().min(1).optional(),
          description: z.string().min(1).optional(),
          path: StudioDestinationPathSchema.optional(),
          url: StudioLocalUrlSchema.optional(),
          statusBar: z.boolean().optional(),
        }),
      )
      .default({}),
    commands: z
      .record(
        StudioEntryIdSchema,
        z.object({
          label: z.string().min(1).optional(),
          shortcut: z.string().min(1).optional(),
          to: StudioEntryIdSchema.optional(),
          view: z.string().min(1).optional(),
        }),
      )
      .default({}),
  })
  .default({});

export type StudioCustomization = z.infer<typeof StudioCustomizationSchema>;

export const StudioCustomizationResponseSchema =
  StudioCustomizationSchema.removeDefault().extend({
    schemaVersion: z.literal(1),
  });

export type StudioCustomizationResponse = z.infer<
  typeof StudioCustomizationResponseSchema
>;

export const DoctorCheckStatusSchema = z.enum(["pass", "warning", "error"]);
export type DoctorCheckStatus = z.infer<typeof DoctorCheckStatusSchema>;

export const DoctorCheckScopeSchema = z.enum([
  "environment",
  "application",
  "security",
]);
export type DoctorCheckScope = z.infer<typeof DoctorCheckScopeSchema>;

export const DoctorCheckSchema = z.object({
  id: z.string().min(1),
  scope: DoctorCheckScopeSchema,
  title: z.string().min(1),
  status: DoctorCheckStatusSchema,
  severity: z.enum(["error", "warning", "info"]),
  detail: z.string().min(1),
  action: z.string().min(1).optional(),
  evidence: z.record(z.unknown()).default({}),
});
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export const DoctorReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  projectRoot: z.string().min(1),
  sourceRoot: z.string().min(1),
  ok: z.boolean(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }),
  checks: z.array(DoctorCheckSchema),
});
export type DoctorReport = z.infer<typeof DoctorReportSchema>;

export const DiagnosticCheckModeSchema = z.enum(["static", "runtime"]);
export type DiagnosticCheckMode = z.infer<typeof DiagnosticCheckModeSchema>;

export const DiagnosticCheckFailOnSchema = z.enum([
  "none",
  "info",
  "low",
  "medium",
  "high",
]);
export type DiagnosticCheckFailOn = z.infer<typeof DiagnosticCheckFailOnSchema>;

export const DiagnosticCheckReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  projectRoot: z.string().min(1),
  sourceRoot: z.string().min(1),
  mode: DiagnosticCheckModeSchema,
  policy: z.object({
    failOn: DiagnosticCheckFailOnSchema,
    routes: z.array(z.string().startsWith("/")),
  }),
  ok: z.boolean(),
  summary: z.object({
    filesScanned: z.number().int().nonnegative(),
    findings: z.object({
      total: z.number().int().nonnegative(),
      open: z.number().int().nonnegative(),
      blocking: z.number().int().nonnegative(),
      bySeverity: z.object({
        info: z.number().int().nonnegative(),
        low: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        high: z.number().int().nonnegative(),
      }),
    }),
    probes: z.object({
      total: z.number().int().nonnegative(),
      effectObserved: z.number().int().nonnegative(),
      possiblyInert: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      activationErrors: z.number().int().nonnegative(),
      blocking: z.number().int().nonnegative(),
    }),
  }),
  findings: z.array(FindingSchema),
  interactionProbes: z.array(InteractionProbeArtifactSchema),
});

export type DiagnosticCheckReport = z.infer<typeof DiagnosticCheckReportSchema>;

export const CacheEntryKindSchema = z.enum(["file", "directory", "symlink"]);
export type CacheEntryKind = z.infer<typeof CacheEntryKindSchema>;

export const CacheTotalsSchema = z.object({
  bytes: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  directories: z.number().int().nonnegative(),
  symlinks: z.number().int().nonnegative(),
});
export type CacheTotals = z.infer<typeof CacheTotalsSchema>;

export const CacheEntrySummarySchema = z.object({
  path: z.string().min(1),
  kind: CacheEntryKindSchema,
  totals: CacheTotalsSchema,
});
export type CacheEntrySummary = z.infer<typeof CacheEntrySummarySchema>;

export const CacheReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  projectRoot: z.string().min(1),
  cacheRoot: z.string().min(1),
  exists: z.boolean(),
  totals: CacheTotalsSchema,
  entries: z.array(CacheEntrySummarySchema),
});
export type CacheReport = z.infer<typeof CacheReportSchema>;

export const CacheCleanRequestSchema = z
  .object({
    dryRun: z.boolean().optional(),
  })
  .strict();
export type CacheCleanRequest = z.infer<typeof CacheCleanRequestSchema>;

export const CacheCleanResultSchema = z.object({
  schemaVersion: z.literal(1),
  dryRun: z.boolean(),
  before: CacheReportSchema,
  after: CacheReportSchema,
  removed: CacheTotalsSchema,
});
export type CacheCleanResult = z.infer<typeof CacheCleanResultSchema>;

export const VisualEvidenceResponseSchema = z.object({
  schemaVersion: z.literal(1),
  baselines: z.array(
    VisualBaselineSchema.extend({ imageUrl: z.string().url().optional() }),
  ),
  comparisons: z.array(
    VisualComparisonSchema.extend({ imageUrl: z.string().url().optional() }),
  ),
});

export type VisualEvidenceResponse = z.infer<
  typeof VisualEvidenceResponseSchema
>;

export const AcceptVisualBaselineRequestSchema = z
  .object({
    screenId: z.string().min(1),
  })
  .strict();

export type AcceptVisualBaselineRequest = z.infer<
  typeof AcceptVisualBaselineRequestSchema
>;

export const GraphEventSchema = z.object({
  type: z.enum(["graph.snapshot", "graph.updated"]),
  graph: ApplicationGraphSchema,
});

export type GraphEvent = z.infer<typeof GraphEventSchema>;

export function graphEvent(
  type: GraphEvent["type"],
  graph: ApplicationGraph,
): GraphEvent {
  return { type, graph };
}

export const ResourceKindSchema = z.enum([
  "adapters",
  "notes",
  "flows",
  "snapshots",
  "visuals",
  "component-previews",
  "interaction-probes",
  "doctor",
  "cache",
]);

export type ResourceKind = z.infer<typeof ResourceKindSchema>;

export const ResourceEventSchema = z.object({
  type: z.literal("resource.updated"),
  resource: ResourceKindSchema,
  occurredAt: z.string().datetime(),
});

export type ResourceEvent = z.infer<typeof ResourceEventSchema>;

export const TopoEventSchema = z.union([GraphEventSchema, ResourceEventSchema]);
export type TopoEvent = z.infer<typeof TopoEventSchema>;

export function resourceEvent(
  resource: ResourceEvent["resource"],
  occurredAt = new Date().toISOString(),
): ResourceEvent {
  return { type: "resource.updated", resource, occurredAt };
}
