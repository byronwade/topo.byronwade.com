import { describe, expect, it } from "vitest";

import { summarizeStudioLoadingResult } from "./studio-loading-performance.js";

describe("summarizeStudioLoadingResult", () => {
  it("uses the distribution p95 rather than a single best-case sample", () => {
    const result = summarizeStudioLoadingResult({
      id: "notes-hot-switch",
      title: "Notes cached destination switch",
      description: "test",
      samplesMs: [8, 10, 11, 12, 14, 16, 18, 21, 47, 53],
      budgetMs: 50,
      workload: { latencyClass: "hot" },
    });

    expect(result.medianMs).toBe(15);
    expect(result.p95Ms).toBe(53);
    expect(result.maxMs).toBe(53);
    expect(result.status).toBe("fail");
  });

  it("rounds retained samples and passes a p95 at the exact budget", () => {
    const result = summarizeStudioLoadingResult({
      id: "atlas-hot-switch",
      title: "Atlas cached destination switch",
      description: "test",
      samplesMs: [49.9996, 50.0001],
      budgetMs: 50.0001,
      workload: { latencyClass: "hot" },
    });

    expect(result.samplesMs).toEqual([50, 50]);
    expect(result.p95Ms).toBe(50);
    expect(result.status).toBe("pass");
  });

  it("retains cold timing misses as informational evidence when unenforced", () => {
    const result = summarizeStudioLoadingResult({
      id: "notes-cold-ready",
      title: "Notes cold readiness",
      description: "test",
      samplesMs: [251],
      budgetMs: 250,
      enforced: false,
      workload: { latencyClass: "cold" },
    });

    expect(result.enforced).toBe(false);
    expect(result.status).toBe("fail");
  });

  it("rejects empty measurements", () => {
    expect(() =>
      summarizeStudioLoadingResult({
        id: "notes-cold-ready",
        title: "Notes cold readiness",
        description: "test",
        samplesMs: [],
        budgetMs: 250,
        workload: { latencyClass: "cold" },
      }),
    ).toThrow("has no samples");
  });
});
