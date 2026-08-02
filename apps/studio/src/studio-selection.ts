import type { StudioSelectionState } from "@topo/studio-api";

export interface StudioSelectionFlowInventory {
  id: string;
  entryStepId?: string;
  stepIds: readonly string[];
}

export interface StudioSelectionInventory {
  screenIds: readonly string[];
  componentIds: readonly string[];
  endpointIds: readonly string[];
  componentPreviews: readonly {
    componentId: string;
    previewIds: readonly string[];
  }[];
  noteIds: readonly string[];
  findingIds: readonly string[];
  probes: readonly {
    id: string;
    screenId?: string;
  }[];
  flows: readonly StudioSelectionFlowInventory[];
}

export interface ReconciledStudioSelection {
  selection: StudioSelectionState;
  /** Only explicit inbound identities proven invalid need URL correction. */
  urlPatch: Partial<StudioSelectionState>;
}

function selectAvailableIdentity(
  requested: string | undefined,
  available: readonly string[],
): { selected?: string; corrected: boolean } {
  if (available.length === 0) return { selected: requested, corrected: false };
  if (requested && available.includes(requested)) {
    return { selected: requested, corrected: false };
  }
  return {
    selected: available[0],
    corrected: requested !== undefined,
  };
}

function selectOptionalIdentity(
  requested: string | undefined,
  available: readonly string[],
): { selected?: string; corrected: boolean } {
  if (requested === undefined) return { selected: undefined, corrected: false };
  return selectAvailableIdentity(requested, available);
}

/**
 * Resolve addressable Studio identities against one hydrated project snapshot.
 * Empty inventories preserve inbound links while the daemon is still loading;
 * hydrated inventories fall back deterministically and expose exact URL fixes.
 */
export function reconcileStudioSelection(
  requested: StudioSelectionState,
  inventory: StudioSelectionInventory,
): ReconciledStudioSelection {
  const screen = selectAvailableIdentity(
    requested.screenId,
    inventory.screenIds,
  );
  const component = selectAvailableIdentity(
    requested.componentId,
    inventory.componentIds,
  );
  const endpoint = selectOptionalIdentity(
    requested.endpointId,
    inventory.endpointIds,
  );
  const componentPreviewInventory = inventory.componentPreviews.find(
    (item) => item.componentId === component.selected,
  );
  const preview = componentPreviewInventory
    ? componentPreviewInventory.previewIds.length > 0
      ? selectAvailableIdentity(
          requested.previewId,
          componentPreviewInventory.previewIds,
        )
      : {
          selected: undefined,
          corrected: requested.previewId !== undefined,
        }
    : { selected: requested.previewId, corrected: false };
  const note = selectAvailableIdentity(requested.noteId, inventory.noteIds);
  const finding = selectOptionalIdentity(
    requested.findingId,
    inventory.findingIds,
  );
  const probe = selectOptionalIdentity(
    requested.probeId,
    inventory.probes.map((item) => item.id),
  );
  const selectedProbe = inventory.probes.find(
    (item) => item.id === probe.selected,
  );
  const probeScreenId = selectedProbe?.screenId;
  const resolvedScreen =
    requested.probeId &&
    probeScreenId &&
    inventory.screenIds.includes(probeScreenId)
      ? {
          selected: probeScreenId,
          corrected: screen.selected !== probeScreenId,
        }
      : screen;
  const flow = selectAvailableIdentity(
    requested.flowId,
    inventory.flows.map((item) => item.id),
  );
  const selectedFlow = inventory.flows.find(
    (item) => item.id === flow.selected,
  );
  const stepIds = selectedFlow?.stepIds ?? [];
  const preferredStepIds = selectedFlow
    ? [
        ...(selectedFlow.entryStepId &&
        stepIds.includes(selectedFlow.entryStepId)
          ? [selectedFlow.entryStepId]
          : []),
        ...stepIds.filter((id) => id !== selectedFlow.entryStepId),
      ]
    : stepIds;
  const flowStep = selectAvailableIdentity(
    requested.flowStepId,
    preferredStepIds,
  );
  const urlPatch: Partial<StudioSelectionState> = {};
  if (screen.corrected) urlPatch.screenId = screen.selected;
  if (component.corrected) urlPatch.componentId = component.selected;
  if (endpoint.corrected) urlPatch.endpointId = endpoint.selected;
  if (preview.corrected) urlPatch.previewId = preview.selected;
  if (note.corrected) urlPatch.noteId = note.selected;
  if (finding.corrected) urlPatch.findingId = finding.selected;
  if (probe.corrected) urlPatch.probeId = probe.selected;
  if (resolvedScreen.corrected) urlPatch.screenId = resolvedScreen.selected;
  if (flow.corrected) urlPatch.flowId = flow.selected;
  if (flowStep.corrected) urlPatch.flowStepId = flowStep.selected;

  return {
    selection: {
      screenId: resolvedScreen.selected,
      componentId: component.selected,
      endpointId: endpoint.selected,
      previewId: preview.selected,
      noteId: note.selected,
      findingId: finding.selected,
      probeId: probe.selected,
      flowId: flow.selected,
      flowStepId: flowStep.selected,
    },
    urlPatch,
  };
}
