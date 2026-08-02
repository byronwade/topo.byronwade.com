import { describe, expect, it } from "vitest";

import type { ComponentNode } from "@topo/schema";

import { selectComponentPreviewEvidence } from "./component-preview-evidence";
import type { StudioComponentPreviewArtifact } from "./studio-model";

const component: ComponentNode = {
  id: "component:button",
  kind: "component",
  name: "Button",
  source: { filePath: "components/Button.tsx", line: 1 },
  previewStatus: "renderable",
  previewSources: [
    {
      id: "preview:button:default",
      title: "Default",
      adapterId: "topo",
      source: { filePath: "components/Button.topo.tsx", line: 3 },
      exportName: "Default",
      locator: "components/Button.topo.tsx#Default",
    },
    {
      id: "preview:button:loading",
      title: "Loading",
      adapterId: "topo",
      source: { filePath: "components/Button.topo.tsx", line: 7 },
      exportName: "Loading",
      locator: "components/Button.topo.tsx#Loading",
    },
  ],
  usedBy: ["screen:home"],
};

function artifact(
  previewId: string,
  capturedAt: string,
  status: "captured" | "failed" = "captured",
): StudioComponentPreviewArtifact {
  return {
    version: 1,
    id: `${previewId}:${capturedAt}`,
    targetKind: "component",
    targetId: component.id,
    previewId,
    adapterId: "topo",
    title: previewId,
    source: { filePath: "components/Button.topo.tsx", line: 1 },
    capturedAt,
    status,
    ...(status === "captured"
      ? { contentHash: "a".repeat(64), imageUrl: "data:image/png;base64,AA==" }
      : { error: "Preview export threw" }),
  };
}

describe("selectComponentPreviewEvidence", () => {
  it("defaults to source order and chooses the newest exact artifact", () => {
    const selected = selectComponentPreviewEvidence(component, [
      artifact("preview:button:default", "2026-08-01T12:00:00.000Z"),
      artifact("preview:button:default", "2026-08-02T12:00:00.000Z"),
      artifact("preview:button:loading", "2026-08-03T12:00:00.000Z"),
    ]);

    expect(selected).toMatchObject({
      state: "captured",
      componentId: component.id,
      previewId: "preview:button:default",
      artifact: { capturedAt: "2026-08-02T12:00:00.000Z" },
    });
  });

  it("selects an exact requested variant and preserves failure evidence", () => {
    expect(
      selectComponentPreviewEvidence(
        component,
        [
          artifact(
            "preview:button:loading",
            "2026-08-02T12:00:00.000Z",
            "failed",
          ),
        ],
        "preview:button:loading",
      ),
    ).toMatchObject({
      state: "failed",
      previewId: "preview:button:loading",
      artifact: { error: "Preview export threw" },
    });
  });

  it("distinguishes uncaptured variants from components without previews", () => {
    expect(
      selectComponentPreviewEvidence(component, [], "preview:button:loading"),
    ).toMatchObject({
      state: "uncaptured",
      previewId: "preview:button:loading",
    });
    expect(
      selectComponentPreviewEvidence(
        { ...component, previewStatus: "missing", previewSources: [] },
        [],
      ),
    ).toEqual({ state: "unavailable", componentId: component.id });
  });
});
