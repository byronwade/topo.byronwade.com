import { describe, expect, it } from "vitest";

import {
  applyFlowPatch,
  createLocalFlow,
  nextFlowStepId,
  removeFlowStep,
} from "./flow-authoring";

const createdAt = "2026-08-01T01:00:00.000Z";

describe("Studio flow authoring", () => {
  it("creates the same versioned record shape used by the daemon", () => {
    const flow = createLocalFlow({ id: "review", title: "Review" }, createdAt);
    expect(flow).toMatchObject({
      version: 1,
      id: "review",
      status: "draft",
      steps: [],
      createdAt,
      updatedAt: createdAt,
    });
  });

  it("patches metadata without losing branching steps", () => {
    const flow = createLocalFlow(
      {
        id: "review",
        title: "Review",
        entryStepId: "start",
        steps: [
          {
            id: "start",
            title: "Start",
            noteIds: [],
            nextStepIds: ["done"],
          },
          {
            id: "done",
            title: "Done",
            noteIds: [],
            nextStepIds: [],
          },
        ],
      },
      createdAt,
    );
    const updated = applyFlowPatch(
      flow,
      { title: "Verified review", status: "verified" },
      "2026-08-01T02:00:00.000Z",
    );
    expect(updated.steps).toEqual(flow.steps);
    expect(updated).toMatchObject({
      title: "Verified review",
      status: "verified",
      createdAt,
      updatedAt: "2026-08-01T02:00:00.000Z",
    });
  });

  it("removes a step, incoming edges, and a matching entry identity", () => {
    const flow = createLocalFlow(
      {
        id: "review",
        title: "Review",
        entryStepId: "done",
        steps: [
          {
            id: "start",
            title: "Start",
            noteIds: [],
            nextStepIds: ["done"],
          },
          {
            id: "done",
            title: "Done",
            noteIds: [],
            nextStepIds: [],
          },
        ],
      },
      createdAt,
    );
    const updated = removeFlowStep(flow, "done", "2026-08-01T02:00:00.000Z");
    expect(updated.entryStepId).toBeUndefined();
    expect(updated.steps).toEqual([
      expect.objectContaining({ id: "start", nextStepIds: [] }),
    ]);
    expect(nextFlowStepId(updated)).toBe("step-2");
  });
});
