import { describe, expect, it } from "vitest";

import { runTopoBenchmarks } from "./index.js";

const testProfile = {
  id: "test",
  routeCount: 24,
  componentCount: 8,
  flowCount: 4,
  cameraOperations: 1_000,
} as const;

describe("runTopoBenchmarks", () => {
  it("measures every critical local pipeline stage as one machine-readable report", async () => {
    const report = await runTopoBenchmarks({
      profile: testProfile,
      iterations: 2,
      warmupIterations: 0,
      budgets: {
        scanWorkspace: Number.MAX_SAFE_INTEGER,
        refreshWorkspace: Number.MAX_SAFE_INTEGER,
        reconcileGraph: Number.MAX_SAFE_INTEGER,
        buildLlmContext: Number.MAX_SAFE_INTEGER,
        createAtlasScene: Number.MAX_SAFE_INTEGER,
        cameraInteractions: Number.MAX_SAFE_INTEGER,
      },
    });

    expect(report.version).toBe(2);
    expect(report.status).toBe("pass");
    expect(report.profile).toEqual(testProfile);
    expect(report.summary).toEqual({ passed: 6, failed: 0, total: 6 });
    expect(report.results.map((result) => result.id)).toEqual([
      "scan-workspace",
      "refresh-workspace",
      "reconcile-graph",
      "build-llm-context",
      "create-atlas-scene",
      "camera-interactions",
    ]);
    expect(report.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "pass",
          sampleCount: 2,
          samplesMs: [expect.any(Number), expect.any(Number)],
          medianMs: expect.any(Number),
          p95Ms: expect.any(Number),
          budgetMs: Number.MAX_SAFE_INTEGER,
        }),
      ]),
    );
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      version: 2,
      profile: { id: "test", routeCount: 24 },
      summary: { total: 6 },
    });
  });

  it("fails the report when a measured p95 exceeds its workload budget", async () => {
    const report = await runTopoBenchmarks({
      profile: testProfile,
      iterations: 1,
      warmupIterations: 0,
      budgets: {
        scanWorkspace: 0,
        refreshWorkspace: 0,
        reconcileGraph: 0,
        buildLlmContext: 0,
        createAtlasScene: 0,
        cameraInteractions: 0,
      },
    });

    expect(report.status).toBe("fail");
    expect(report.summary.failed).toBeGreaterThan(0);
    expect(report.results.some((result) => result.status === "fail")).toBe(
      true,
    );
  });

  it("uses explicit scaled p95 budgets when no override is supplied", async () => {
    const report = await runTopoBenchmarks({
      profile: testProfile,
      iterations: 1,
      warmupIterations: 0,
    });

    expect(
      Object.fromEntries(
        report.results.map((result) => [result.id, result.budgetMs]),
      ),
    ).toEqual({
      "scan-workspace": 125,
      "refresh-workspace": 12.5,
      "reconcile-graph": 25,
      "build-llm-context": 125,
      "create-atlas-scene": 25,
      "camera-interactions": 12.5,
    });
  });
});
