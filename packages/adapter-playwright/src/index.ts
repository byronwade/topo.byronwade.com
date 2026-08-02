export { captureRoute, openPreview } from "@topo/browser";
export { probeRoute, isDestructiveControl } from "@topo/analyzer-runtime";

export interface PlaywrightAdapterCapabilities { capture: true; isolatedRuntimeProbe: true; destructiveActionsSkipped: true; }
export const capabilities: PlaywrightAdapterCapabilities = { capture: true, isolatedRuntimeProbe: true, destructiveActionsSkipped: true };
