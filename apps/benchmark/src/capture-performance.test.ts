import { describe, expect, it } from "vitest";

import { summarizeCapturePerformanceResult } from "./capture-performance.js";

describe("summarizeCapturePerformanceResult", () => {
  it("enforces the p95 capture budget", () => {
    const result = summarizeCapturePerformanceResult({
      id: "capture-orchestration",
      title: "Capture orchestration",
      description: "test",
      samplesMs: [10, 12, 14, 16, 51],
      budgetMs: 50,
      workload: { latencyClass: "hot" },
    });

    expect(result.medianMs).toBe(14);
    expect(result.p95Ms).toBe(51);
    expect(result.status).toBe("fail");
  });
});
