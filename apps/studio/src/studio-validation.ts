import {
  ApplicationGraphSchema,
  AtlasOrganizationSchema,
  FlowSchema,
  NoteRecordSchema,
} from "@topo/schema";
import {
  AdapterInventoryResponseSchema,
  CacheCleanResultSchema,
  CacheReportSchema,
  ComponentPreviewScaffoldResponseSchema,
  ComponentPreviewsResponseSchema,
  DoctorReportSchema,
  FlowsResponseSchema,
  GraphEventSchema,
  InteractionProbesResponseSchema,
  NotesResponseSchema,
  PreviewGatewaySessionsResponseSchema,
  ProjectSettingsResponseSchema,
  ResourceEventSchema,
  SnapshotsResponseSchema,
  StudioCustomizationResponseSchema,
  VisualEvidenceResponseSchema,
} from "@topo/protocol";

export const parseApplicationGraph = (value: unknown) =>
  ApplicationGraphSchema.parse(value);
export const parseAdapterInventory = (value: unknown) =>
  AdapterInventoryResponseSchema.parse(value);
export const parseAtlasOrganization = (value: unknown) =>
  AtlasOrganizationSchema.parse(value);
export const parseNotesResponse = (value: unknown) =>
  NotesResponseSchema.parse(value);
export const parseFlowsResponse = (value: unknown) =>
  FlowsResponseSchema.parse(value);
export const parseSnapshotsResponse = (value: unknown) =>
  SnapshotsResponseSchema.parse(value);
export const parseVisualEvidence = (value: unknown) =>
  VisualEvidenceResponseSchema.parse(value);
export const parseComponentPreviewsResponse = (value: unknown) =>
  ComponentPreviewsResponseSchema.parse(value);
export const parseComponentPreviewScaffoldResponse = (value: unknown) =>
  ComponentPreviewScaffoldResponseSchema.parse(value);
export const parseInteractionProbesResponse = (value: unknown) =>
  InteractionProbesResponseSchema.parse(value);
export const parseDoctorReport = (value: unknown) =>
  DoctorReportSchema.parse(value);
export const parsePreviewSessions = (value: unknown) =>
  PreviewGatewaySessionsResponseSchema.parse(value);
export const parseProjectSettings = (value: unknown) =>
  ProjectSettingsResponseSchema.parse(value);
export const parseCacheReport = (value: unknown) =>
  CacheReportSchema.parse(value);
export const parseCacheCleanResult = (value: unknown) =>
  CacheCleanResultSchema.parse(value);
export const parseStudioCustomization = (value: unknown) =>
  StudioCustomizationResponseSchema.parse(value);
export const parseNoteRecord = (value: unknown) =>
  NoteRecordSchema.parse(value);
export const parseFlowRecord = (value: unknown) => FlowSchema.parse(value);
export const parseGraphEvent = (value: unknown) =>
  GraphEventSchema.safeParse(value);
export const parseResourceEvent = (value: unknown) =>
  ResourceEventSchema.safeParse(value);
