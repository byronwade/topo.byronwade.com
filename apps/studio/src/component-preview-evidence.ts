import type { ComponentNode, ComponentPreviewSource } from "@topo/schema";

import type { StudioComponentPreviewArtifact } from "./studio-model";

export type ComponentPreviewEvidenceState =
  "captured" | "failed" | "uncaptured" | "unavailable";

export interface ComponentPreviewEvidence {
  state: ComponentPreviewEvidenceState;
  componentId?: string;
  previewId?: string;
  preview?: ComponentPreviewSource;
  artifact?: StudioComponentPreviewArtifact;
}

/**
 * Select one exact preview variant and its newest matching artifact.
 * Source-declared preview order remains the deterministic default; artifacts
 * never invent a variant or replace the component graph as authority.
 */
export function selectComponentPreviewEvidence(
  component: ComponentNode | undefined,
  artifacts: readonly StudioComponentPreviewArtifact[],
  requestedPreviewId?: string,
): ComponentPreviewEvidence {
  if (!component || component.previewSources.length === 0) {
    return {
      state: "unavailable",
      componentId: component?.id,
    };
  }

  const preview =
    component.previewSources.find((item) => item.id === requestedPreviewId) ??
    component.previewSources[0]!;
  const artifact = artifacts
    .filter(
      (item) => item.targetId === component.id && item.previewId === preview.id,
    )
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))[0];

  if (!artifact) {
    return {
      state: "uncaptured",
      componentId: component.id,
      previewId: preview.id,
      preview,
    };
  }

  return {
    state: artifact.status === "failed" ? "failed" : "captured",
    componentId: component.id,
    previewId: preview.id,
    preview,
    artifact,
  };
}
