import { describe, expect, it } from "vitest";

import {
  NOTE_COMPOSER_PRESETS,
  buildNoteComposerInput,
  createNoteComposerDraft,
  resolveNoteComposerTarget,
} from "./note-composer";
import { fixtureFlows, fixtureGraph } from "./studio-model";

const screen = fixtureGraph.screens[1]!;
const flow = fixtureFlows[0]!;
const step = flow.steps[1]!;

function context(
  selection: {
    screenId?: string;
    flowId?: string;
    flowStepId?: string;
  } = {},
) {
  return { graph: fixtureGraph, flows: fixtureFlows, selection };
}

describe("note composer", () => {
  it("keeps all eight Paper choices while using only canonical note types", () => {
    expect(NOTE_COMPOSER_PRESETS).toHaveLength(8);
    expect(
      new Set(NOTE_COMPOSER_PRESETS.map((preset) => preset.noteType)),
    ).toEqual(
      new Set([
        "element",
        "screen",
        "region",
        "flow",
        "checklist",
        "decision",
        "canvas",
      ]),
    );
    expect(
      NOTE_COMPOSER_PRESETS.find((preset) => preset.id === "flow-marker"),
    ).toMatchObject({ noteType: "flow", targetMode: "none" });
  });

  it("targets a screen by exact selected identity without fabricating an anchor", () => {
    const draft = createNoteComposerDraft(
      "element-pin",
      context({ screenId: screen.id }),
    );
    const input = buildNoteComposerInput({
      ...draft,
      title: "  Check the primary action  ",
      body: "  Confirm its keyboard behavior.  ",
    });

    expect(input).toEqual({
      type: "element",
      title: "Check the primary action",
      body: "Confirm its keyboard behavior.",
      targetKind: "screen",
      targetId: screen.id,
      targetRoute: screen.routePath,
    });
    expect(input).not.toHaveProperty("anchor");
  });

  it("targets only a selected step that belongs to the selected flow", () => {
    expect(
      resolveNoteComposerTarget(
        "flow-note",
        context({ flowId: flow.id, flowStepId: step.id }),
      ),
    ).toMatchObject({
      targetKind: "flow-step",
      targetId: step.id,
      targetRoute: step.routePath,
    });

    expect(
      resolveNoteComposerTarget(
        "flow-note",
        context({ flowId: flow.id, flowStepId: "not-in-this-flow" }),
      ),
    ).toMatchObject({ targetKind: "flow", targetId: flow.id });
  });

  it("can resolve an explicitly selected step when no flow id is present", () => {
    expect(
      resolveNoteComposerTarget("flow-note", context({ flowStepId: step.id })),
    ).toMatchObject({
      targetKind: "flow-step",
      targetId: step.id,
      targetRoute: step.routePath,
    });
  });

  it("keeps free-standing choices free of hidden targets", () => {
    for (const presetId of [
      "checklist",
      "decision",
      "canvas-note",
      "flow-marker",
    ] as const) {
      const input = buildNoteComposerInput(
        createNoteComposerDraft(
          presetId,
          context({
            screenId: screen.id,
            flowId: flow.id,
            flowStepId: step.id,
          }),
        ),
      );
      expect(input).not.toHaveProperty("targetKind");
      expect(input).not.toHaveProperty("targetId");
      expect(input).not.toHaveProperty("targetRoute");
      expect(input).not.toHaveProperty("anchor");
    }
  });

  it("keeps an anchored note unbound when its selected identity is missing", () => {
    const input = buildNoteComposerInput(
      createNoteComposerDraft(
        "region-note",
        context({ screenId: "missing-screen" }),
      ),
    );
    expect(input).toMatchObject({ type: "region" });
    expect(input).not.toHaveProperty("targetId");
    expect(input).not.toHaveProperty("anchor");
  });

  it("rejects a blank title before calling the note store", () => {
    expect(() =>
      buildNoteComposerInput({
        ...createNoteComposerDraft("screen-note", context()),
        title: "   ",
      }),
    ).toThrow("A note title is required.");
  });
});
