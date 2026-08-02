import {
  type Flow,
  type UpdateFlowInput,
  type WriteFlowInput,
} from "@topo/schema";

export function createLocalFlow(
  input: WriteFlowInput,
  now: string,
  id = input.id ?? `flow-${crypto.randomUUID()}`,
): Flow {
  return {
    version: 1,
    id,
    title: input.title,
    description: input.description ?? "",
    status: input.status ?? "draft",
    entryStepId: input.entryStepId,
    tags: input.tags ?? [],
    steps: (input.steps ?? []).map((step) => ({
      ...step,
      noteIds: step.noteIds ?? [],
      nextStepIds: step.nextStepIds ?? [],
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function applyFlowPatch(
  flow: Flow,
  input: UpdateFlowInput,
  now: string,
): Flow {
  return {
    ...flow,
    title: input.title ?? flow.title,
    description: input.description ?? flow.description,
    status: input.status ?? flow.status,
    entryStepId:
      input.entryStepId === null
        ? undefined
        : (input.entryStepId ?? flow.entryStepId),
    tags: input.tags ?? flow.tags,
    steps: input.steps ?? flow.steps,
    updatedAt: now,
  };
}

export function nextFlowStepId(flow: Flow): string {
  const ids = new Set(flow.steps.map((step) => step.id));
  for (let index = flow.steps.length + 1; ; index += 1) {
    const candidate = `step-${index}`;
    if (!ids.has(candidate)) return candidate;
  }
}

export function removeFlowStep(flow: Flow, stepId: string, now: string): Flow {
  const steps = flow.steps
    .filter((step) => step.id !== stepId)
    .map((step) => ({
      ...step,
      nextStepIds: step.nextStepIds.filter((id) => id !== stepId),
    }));
  return applyFlowPatch(
    flow,
    {
      entryStepId: flow.entryStepId === stepId ? null : flow.entryStepId,
      steps,
    },
    now,
  );
}
