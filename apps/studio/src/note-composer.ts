import type {
  ApplicationGraph,
  Flow,
  NoteTargetKind,
  NoteType,
  ScreenNode,
  WriteNoteInput,
} from "@topo/schema";

export type NoteComposerPresetId =
  | "element-pin"
  | "screen-note"
  | "region-note"
  | "flow-note"
  | "checklist"
  | "decision"
  | "canvas-note"
  | "flow-marker";

export interface NoteComposerPreset {
  id: NoteComposerPresetId;
  label: string;
  group: "anchored" | "free-standing";
  noteType: NoteType;
  targetMode: "screen" | "flow" | "none";
  description: string;
}

export const NOTE_COMPOSER_PRESETS = [
  {
    id: "element-pin",
    label: "Element pin",
    group: "anchored",
    noteType: "element",
    targetMode: "screen",
    description:
      "Records the selected screen now. Element identity and coordinates remain unbound until placement is captured.",
  },
  {
    id: "screen-note",
    label: "Screen note",
    group: "anchored",
    noteType: "screen",
    targetMode: "screen",
    description:
      "Records the exact selected screen without implying an element or coordinate anchor.",
  },
  {
    id: "region-note",
    label: "Region note",
    group: "anchored",
    noteType: "region",
    targetMode: "screen",
    description:
      "Records the selected screen now. Region coordinates remain unbound until placement is captured.",
  },
  {
    id: "flow-note",
    label: "Flow note",
    group: "anchored",
    noteType: "flow",
    targetMode: "flow",
    description:
      "Records the explicitly selected flow step when available, otherwise the selected flow.",
  },
  {
    id: "checklist",
    label: "Checklist",
    group: "free-standing",
    noteType: "checklist",
    targetMode: "none",
    description:
      "Creates a free-standing Markdown checklist with no inferred application relationship.",
  },
  {
    id: "decision",
    label: "Decision",
    group: "free-standing",
    noteType: "decision",
    targetMode: "none",
    description:
      "Creates a free-standing engineering decision with no inferred application relationship.",
  },
  {
    id: "canvas-note",
    label: "Canvas note",
    group: "free-standing",
    noteType: "canvas",
    targetMode: "none",
    description:
      "Creates a free-standing canvas note without inventing a screen or coordinate anchor.",
  },
  {
    id: "flow-marker",
    label: "Flow marker",
    group: "free-standing",
    noteType: "flow",
    targetMode: "none",
    description:
      "Creates a free-standing flow note. It is stored as type flow without an inferred flow relationship.",
  },
] as const satisfies readonly NoteComposerPreset[];

export interface NoteComposerSelection {
  screenId?: string;
  flowId?: string;
  flowStepId?: string;
}

export interface NoteComposerContext {
  graph: ApplicationGraph;
  flows: readonly Flow[];
  selection: NoteComposerSelection;
}

export interface NoteComposerTarget {
  targetKind?: NoteTargetKind;
  targetId?: string;
  targetRoute?: string;
  label: string;
  evidence: string;
}

export interface NoteComposerDraft {
  presetId: NoteComposerPresetId;
  title: string;
  body: string;
  target: NoteComposerTarget;
}

function selectedScreen(context: NoteComposerContext): ScreenNode | undefined {
  if (!context.selection.screenId) return undefined;
  return context.graph.screens.find(
    (screen) => screen.id === context.selection.screenId,
  );
}

function screenTarget(
  context: NoteComposerContext,
  description: string,
): NoteComposerTarget {
  const screen = selectedScreen(context);
  if (!screen) {
    return {
      label: "No screen selected",
      evidence: `${description} This note will remain unbound.`,
    };
  }
  return {
    targetKind: "screen",
    targetId: screen.id,
    targetRoute: screen.routePath,
    label: screen.title,
    evidence: `${screen.routePath} · ${screen.source.filePath}. ${description}`,
  };
}

function flowTarget(
  context: NoteComposerContext,
  description: string,
): NoteComposerTarget {
  const selectedFlow = context.selection.flowId
    ? context.flows.find((flow) => flow.id === context.selection.flowId)
    : context.selection.flowStepId
      ? context.flows.find((flow) =>
          flow.steps.some((step) => step.id === context.selection.flowStepId),
        )
      : undefined;
  if (!selectedFlow) {
    return {
      label: "No flow selected",
      evidence: `${description} This note will remain unbound.`,
    };
  }
  const selectedStep = context.selection.flowStepId
    ? selectedFlow.steps.find(
        (step) => step.id === context.selection.flowStepId,
      )
    : undefined;
  if (selectedStep) {
    return {
      targetKind: "flow-step",
      targetId: selectedStep.id,
      targetRoute: selectedStep.routePath,
      label: `${selectedFlow.title} · ${selectedStep.title}`,
      evidence: `${selectedStep.routePath ?? "No route recorded"}. ${description}`,
    };
  }
  return {
    targetKind: "flow",
    targetId: selectedFlow.id,
    label: selectedFlow.title,
    evidence: description,
  };
}

export function getNoteComposerPreset(
  presetId: NoteComposerPresetId,
): NoteComposerPreset {
  const preset = NOTE_COMPOSER_PRESETS.find(
    (candidate) => candidate.id === presetId,
  );
  if (!preset) throw new Error(`Unknown note composer preset "${presetId}"`);
  return preset;
}

export function resolveNoteComposerTarget(
  presetId: NoteComposerPresetId,
  context: NoteComposerContext,
): NoteComposerTarget {
  const preset = getNoteComposerPreset(presetId);
  if (preset.targetMode === "screen") {
    return screenTarget(context, preset.description);
  }
  if (preset.targetMode === "flow") {
    return flowTarget(context, preset.description);
  }
  return {
    label: "Free-standing",
    evidence: preset.description,
  };
}

export function createNoteComposerDraft(
  presetId: NoteComposerPresetId,
  context: NoteComposerContext,
): NoteComposerDraft {
  const preset = getNoteComposerPreset(presetId);
  const target = resolveNoteComposerTarget(presetId, context);
  const suffix = target.targetId ? ` · ${target.label}` : "";
  return {
    presetId,
    title: `${preset.label}${suffix}`,
    body: "",
    target,
  };
}

export function buildNoteComposerInput(
  draft: NoteComposerDraft,
): WriteNoteInput {
  const preset = getNoteComposerPreset(draft.presetId);
  const title = draft.title.trim();
  if (!title) throw new Error("A note title is required.");
  return {
    type: preset.noteType,
    title,
    body: draft.body.trim(),
    ...(draft.target.targetKind ? { targetKind: draft.target.targetKind } : {}),
    ...(draft.target.targetId ? { targetId: draft.target.targetId } : {}),
    ...(draft.target.targetRoute
      ? { targetRoute: draft.target.targetRoute }
      : {}),
  };
}
