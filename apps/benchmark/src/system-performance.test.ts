import { describe, expect, it } from "vitest";

import { summarizeSystemPerformanceResult } from "./system-performance.js";

describe("summarizeSystemPerformanceResult", () => {
  it("enforces hot p95 results", () => {
    const result = summarizeSystemPerformanceResult({
      id: "daemon-graph-http",
      title: "Daemon graph HTTP",
      description: "test",
      samplesMs: [3, 4, 5, 6, 7],
      budgetMs: 50,
      workload: { latencyClass: "hot" },
    });

    expect(result.medianMs).toBe(5);
    expect(result.p95Ms).toBe(7);
    expect(result.status).toBe("pass");
  });
});
