import { describe, expect, it } from "vitest";

import {
  createExclusiveActionGate,
  createLatestCommitGate,
} from "./async-coordination";

describe("Studio asynchronous coordination", () => {
  it("allows only the newest hydration lease to commit", () => {
    const gate = createLatestCommitGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);

    gate.invalidate();

    expect(second.isCurrent()).toBe(false);
  });

  it("rejects a second action until the active lease releases", () => {
    const gate = createExclusiveActionGate();
    const first = gate.tryStart();

    expect(first).toBeDefined();
    expect(gate.isActive()).toBe(true);
    expect(gate.tryStart()).toBeUndefined();
    expect(first?.release()).toBe(true);
    expect(first?.release()).toBe(false);
    expect(gate.isActive()).toBe(false);

    const next = gate.tryStart();
    expect(next).toBeDefined();
    expect(gate.isActive()).toBe(true);
  });
});
