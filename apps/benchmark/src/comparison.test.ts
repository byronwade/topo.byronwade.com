import { describe, expect, it } from "vitest";

import type { BenchmarkReport } from "./index.js";
import { comparePerformanceReports } from "./comparison.js";

function fixtureReport(
  generatedAt: string,
  values: Record<
    string,
    { p95Ms: number; medianMs?: number; budgetMs?: number }
  >,
): BenchmarkReport {
  return {
    version: 2,
    generatedAt,
    status: "pass",
    profile: {
      id: "standard",
      routeCount: 1_000,
      componentCount: 250,
      flowCount: 50,
      cameraOperations: 100_000,
    },
    runtime: {
      nodeVersion: "v24.14.0",
      platform: "win32",
      architecture: "x64",
      cpuModel: "Fixture CPU",
      cpuCount: 16,
      totalMemoryBytes: 64_000_000_000,
    },
    settings: { iterations: 7, warmupIterations: 2 },
    summary: {
      passed: Object.keys(values).length,
      failed: 0,
      total: Object.keys(values).length,
    },
    results: Object.entries(values).map(([id, value]) => ({
      id: id as BenchmarkReport["results"][number]["id"],
      title: id,
      description: id,
      unit: "ms",
      status: "pass",
      budgetMs: value.budgetMs ?? 500,
      sampleCount: 1,
      samplesMs: [value.p95Ms],
      medianMs: value.medianMs ?? value.p95Ms,
      p95Ms: value.p95Ms,
      maxMs: value.p95Ms,
      workload: {},
    })),
  };
}

describe("comparePerformanceReports", () => {
  it("accepts a meaningful improvement with stable peers under the hard target", () => {
    const baseline = fixtureReport("2026-08-02T00:00:00.000Z", {
      "scan-workspace": { p95Ms: 42 },
      "camera-interactions": { p95Ms: 20, budgetMs: 25 },
    });
    const candidate = fixtureReport("2026-08-02T00:01:00.000Z", {
      "scan-workspace": { p95Ms: 35 },
      "camera-interactions": { p95Ms: 20.9, budgetMs: 25 },
    });

    const comparison = comparePerformanceReports(baseline, candidate);

    expect(comparison.status).toBe("pass");
    expect(comparison.summary).toEqual({
      improved: 1,
      stable: 1,
      regressed: 0,
      overTarget: 0,
      total: 2,
    });
    expect(comparison.results[0]).toMatchObject({
      trend: "improved",
      targetMs: 50,
      targetStatus: "pass",
    });
    expect(comparison.results[1]).toMatchObject({
      trend: "stable",
      targetMs: 25,
      targetStatus: "pass",
    });
  });

  it("rejects a meaningful regression even when the fixed budget still passes", () => {
    const baseline = fixtureReport("2026-08-02T00:00:00.000Z", {
      "scan-workspace": { p95Ms: 20 },
    });
    const candidate = fixtureReport("2026-08-02T00:01:00.000Z", {
      "scan-workspace": { p95Ms: 23 },
    });

    const comparison = comparePerformanceReports(baseline, candidate);

    expect(comparison.status).toBe("fail");
    expect(comparison.results[0]).toMatchObject({
      trend: "regressed",
      status: "fail",
    });
  });

  it("keeps one-sided tail movement stable while enforcing the p95 target", () => {
    const baseline = fixtureReport("2026-08-02T00:00:00.000Z", {
      "reconcile-graph": { medianMs: 4, p95Ms: 5 },
    });
    const candidate = fixtureReport("2026-08-02T00:01:00.000Z", {
      "reconcile-graph": { medianMs: 4.5, p95Ms: 9 },
    });

    const comparison = comparePerformanceReports(baseline, candidate, {
      requireImprovement: false,
    });

    expect(comparison.status).toBe("pass");
    expect(comparison.results[0]).toMatchObject({
      trend: "stable",
      baselineMedianMs: 4,
      candidateMedianMs: 4.5,
      baselineP95Ms: 5,
      candidateP95Ms: 9,
    });
  });

  it("rejects a result above 50 ms even when it improves from the baseline", () => {
    const baseline = fixtureReport("2026-08-02T00:00:00.000Z", {
      "scan-workspace": { p95Ms: 80 },
    });
    const candidate = fixtureReport("2026-08-02T00:01:00.000Z", {
      "scan-workspace": { p95Ms: 60 },
    });

    const comparison = comparePerformanceReports(baseline, candidate);

    expect(comparison.status).toBe("fail");
    expect(comparison.results[0]).toMatchObject({
      trend: "improved",
      targetMs: 50,
      targetStatus: "fail",
    });
  });

  it("keeps cold initialization outside the hot-path ceiling", () => {
    const baseline = fixtureReport("2026-08-02T00:00:00.000Z", {
      "scan-workspace": { p95Ms: 90, budgetMs: 1_500 },
    });
    const candidate = fixtureReport("2026-08-02T00:01:00.000Z", {
      "scan-workspace": { p95Ms: 80, budgetMs: 1_500 },
    });
    baseline.results[0]!.workload = { latencyClass: "cold" };
    candidate.results[0]!.workload = { latencyClass: "cold" };

    const comparison = comparePerformanceReports(baseline, candidate);

    expect(comparison.status).toBe("pass");
    expect(comparison.results[0]).toMatchObject({
      latencyClass: "cold",
      targetMs: 1_500,
      targetStatus: "pass",
    });
  });

  it("rejects cross-environment comparisons", () => {
    const baseline = fixtureReport("2026-08-02T00:00:00.000Z", {
      "scan-workspace": { p95Ms: 20 },
    });
    const candidate = fixtureReport("2026-08-02T00:01:00.000Z", {
      "scan-workspace": { p95Ms: 18 },
    });
    candidate.runtime.cpuModel = "Different CPU";

    expect(() => comparePerformanceReports(baseline, candidate)).toThrow(
      "different workload or runtime fingerprints",
    );
  });

  it("rejects workload or sample-count drift", () => {
    const baseline = fixtureReport("2026-08-02T00:00:00.000Z", {
      "scan-workspace": { p95Ms: 20 },
    });
    const candidate = fixtureReport("2026-08-02T00:01:00.000Z", {
      "scan-workspace": { p95Ms: 18 },
    });
    candidate.results[0]!.sampleCount = 20;

    expect(() => comparePerformanceReports(baseline, candidate)).toThrow(
      "different workload or runtime fingerprints",
    );
  });
});
