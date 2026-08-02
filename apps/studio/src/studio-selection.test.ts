import { describe, expect, it } from "vitest";

import { reconcileStudioSelection } from "./studio-selection";

const inventory = {
  screenIds: ["screen:home", "screen:jobs"],
  componentIds: ["component:missing", "component:button"],
  endpointIds: ["api:http:GET:/api/customers"],
  componentPreviews: [
    { componentId: "component:missing", previewIds: [] },
    {
      componentId: "component:button",
      previewIds: ["preview:button:default", "preview:button:loading"],
    },
  ],
  noteIds: ["note:copy", "note:layout"],
  findingIds: ["finding:route", "finding:control"],
  probes: [
    { id: "interaction-probe:home", screenId: "screen:home" },
    { id: "interaction-probe:jobs", screenId: "screen:jobs" },
  ],
  flows: [
    {
      id: "flow:book",
      entryStepId: "step:start",
      stepIds: ["step:finish", "step:start"],
    },
    {
      id: "flow:invoice",
      entryStepId: "step:invoice",
      stepIds: ["step:invoice"],
    },
  ],
} as const;

describe("reconcileStudioSelection", () => {
  it("preserves exact identities that exist in the hydrated project", () => {
    expect(
      reconcileStudioSelection(
        {
          screenId: "screen:jobs",
          componentId: "component:button",
          previewId: "preview:button:loading",
          noteId: "note:layout",
          findingId: "finding:control",
          probeId: "interaction-probe:jobs",
          flowId: "flow:invoice",
          flowStepId: "step:invoice",
        },
        inventory,
      ),
    ).toEqual({
      selection: {
        screenId: "screen:jobs",
        componentId: "component:button",
        previewId: "preview:button:loading",
        noteId: "note:layout",
        findingId: "finding:control",
        probeId: "interaction-probe:jobs",
        flowId: "flow:invoice",
        flowStepId: "step:invoice",
      },
      urlPatch: {},
    });
  });

  it("corrects stale explicit links to deterministic project defaults", () => {
    expect(
      reconcileStudioSelection(
        {
          screenId: "screen:removed",
          componentId: "component:removed",
          previewId: "preview:removed",
          noteId: "note:removed",
          findingId: "finding:removed",
          probeId: "interaction-probe:removed",
          flowId: "flow:removed",
          flowStepId: "step:removed",
        },
        inventory,
      ),
    ).toEqual({
      selection: {
        screenId: "screen:home",
        componentId: "component:missing",
        previewId: undefined,
        noteId: "note:copy",
        findingId: "finding:route",
        probeId: "interaction-probe:home",
        flowId: "flow:book",
        flowStepId: "step:start",
      },
      urlPatch: {
        screenId: "screen:home",
        componentId: "component:missing",
        previewId: undefined,
        noteId: "note:copy",
        findingId: "finding:route",
        probeId: "interaction-probe:home",
        flowId: "flow:book",
        flowStepId: "step:start",
      },
    });
  });

  it("does not erase inbound identities while project collections are empty", () => {
    expect(
      reconcileStudioSelection(
        {
          screenId: "screen:loading",
          flowId: "flow:loading",
          flowStepId: "step:loading",
        },
        {
          screenIds: [],
          componentIds: [],
          endpointIds: [],
          componentPreviews: [],
          noteIds: [],
          findingIds: [],
          probes: [],
          flows: [],
        },
      ),
    ).toEqual({
      selection: {
        screenId: "screen:loading",
        componentId: undefined,
        previewId: undefined,
        noteId: undefined,
        findingId: undefined,
        probeId: undefined,
        flowId: "flow:loading",
        flowStepId: "step:loading",
      },
      urlPatch: {},
    });
  });

  it("corrects a stale preview within the exact selected component", () => {
    expect(
      reconcileStudioSelection(
        {
          componentId: "component:button",
          previewId: "preview:button:removed",
        },
        inventory,
      ),
    ).toMatchObject({
      selection: {
        componentId: "component:button",
        previewId: "preview:button:default",
      },
      urlPatch: { previewId: "preview:button:default" },
    });
  });

  it("lets a valid probe identity select its owning screen", () => {
    expect(
      reconcileStudioSelection(
        {
          screenId: "screen:home",
          probeId: "interaction-probe:jobs",
        },
        inventory,
      ),
    ).toEqual({
      selection: {
        screenId: "screen:jobs",
        componentId: "component:missing",
        previewId: undefined,
        noteId: "note:copy",
        findingId: undefined,
        probeId: "interaction-probe:jobs",
        flowId: "flow:book",
        flowStepId: "step:start",
      },
      urlPatch: { screenId: "screen:jobs" },
    });
  });
});
