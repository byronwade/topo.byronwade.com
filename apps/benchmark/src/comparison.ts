import type { BrowserBenchmarkReport } from "./browser-contract.js";
import type { CapturePerformanceReport } from "./capture-performance.js";
import type { BenchmarkReport } from "./index.js";
import type { StudioLoadingReport } from "./studio-loading-performance.js";
import type { SystemPerformanceReport } from "./system-performance.js";

export const PERFORMANCE_COMPARISON_VERSION = 1 as const;
export const PERFORMANCE_HOT_PATH_CEILING_MS = 50;
export const PERFORMANCE_REGRESSION_TOLERANCE_RATIO = 0.075;
export const PERFORMANCE_REGRESSION_TOLERANCE_FLOOR_MS = 1;

export type ComparablePerformanceReport =
  | BenchmarkReport
  | BrowserBenchmarkReport
  | CapturePerformanceReport
  | SystemPerformanceReport
  | StudioLoadingReport;

export type PerformanceTrend = "improved" | "stable" | "regressed";
export type PerformanceLatencyClass = "hot" | "cold" | "external";

export interface PerformanceComparisonResult {
  id: string;
  title: string;
  trend: PerformanceTrend;
  latencyClass: PerformanceLatencyClass;
  status: "pass" | "fail";
  baselineMedianMs: number;
  candidateMedianMs: number;
  medianDeltaMs: number;
  medianDeltaPercent: number;
  baselineP95Ms: number;
  candidateP95Ms: number;
  deltaMs: number;
  deltaPercent: number;
  toleranceMs: number;
  targetMs: number;
  targetStatus: "pass" | "fail";
}

export interface PerformanceComparisonReport {
  schemaVersion: typeof PERFORMANCE_COMPARISON_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  reportKind: "cpu" | "browser" | "capture" | "studio" | "system";
  profileId: string;
  runtimeFingerprint: string;
  policy: {
    hotPathCeilingMs: number;
    regressionToleranceRatio: number;
    regressionToleranceFloorMs: number;
    requireImprovement: boolean;
  };
  baseline: {
    generatedAt: string;
    status: "pass" | "fail";
  };
  candidate: {
    generatedAt: string;
    status: "pass" | "fail";
  };
  summary: {
    improved: number;
    stable: number;
    regressed: number;
    overTarget: number;
    total: number;
  };
  results: PerformanceComparisonResult[];
}

export interface ComparePerformanceReportsOptions {
  requireImprovement?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(
  value: unknown,
  field: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Performance report field ${field} must be a finite number`,
    );
  }
}

/** Parse only the report fields required for a safe same-runtime comparison. */
export function parseComparablePerformanceReport(
  value: unknown,
): ComparablePerformanceReport {
  if (!isRecord(value)) throw new Error("Performance report must be an object");
  if (typeof value.generatedAt !== "string") {
    throw new Error("Performance report generatedAt must be a string");
  }
  if (value.status !== "pass" && value.status !== "fail") {
    throw new Error("Performance report status must be pass or fail");
  }
  if (!isRecord(value.profile) || typeof value.profile.id !== "string") {
    throw new Error("Performance report profile must have an id");
  }
  if (!isRecord(value.runtime)) {
    throw new Error("Performance report runtime must be an object");
  }
  for (const field of ["nodeVersion", "platform", "architecture"] as const) {
    if (typeof value.runtime[field] !== "string") {
      throw new Error(`Performance report runtime.${field} must be a string`);
    }
  }
  if (!Array.isArray(value.results) || value.results.length === 0) {
    throw new Error("Performance report results must be a non-empty array");
  }
  const ids = new Set<string>();
  for (const [index, result] of value.results.entries()) {
    if (!isRecord(result) || typeof result.id !== "string") {
      throw new Error(`Performance report result ${index} must have an id`);
    }
    if (ids.has(result.id)) {
      throw new Error(
        `Performance report result id is duplicated: ${result.id}`,
      );
    }
    ids.add(result.id);
    if (typeof result.title !== "string") {
      throw new Error(`Performance report result ${result.id} needs a title`);
    }
    requireFiniteNumber(result.medianMs, `${result.id}.medianMs`);
    requireFiniteNumber(result.p95Ms, `${result.id}.p95Ms`);
    requireFiniteNumber(result.budgetMs, `${result.id}.budgetMs`);
    requireFiniteNumber(result.sampleCount, `${result.id}.sampleCount`);
    if (!isRecord(result.workload)) {
      throw new Error(
        `Performance report result ${result.id} needs a workload`,
      );
    }
    const latencyClass = result.workload.latencyClass;
    if (
      latencyClass !== undefined &&
      latencyClass !== "hot" &&
      latencyClass !== "cold" &&
      latencyClass !== "external"
    ) {
      throw new Error(
        `Performance report result ${result.id} has an invalid latencyClass`,
      );
    }
  }

  const browser =
    typeof value.runtime.browserName === "string" &&
    typeof value.runtime.renderer === "string";
  if (browser) {
    for (const field of [
      "browserVersion",
      "renderer",
      "webglVersion",
      "gpuAdapter",
    ] as const) {
      if (typeof value.runtime[field] !== "string") {
        throw new Error(
          `Browser performance runtime.${field} must be a string`,
        );
      }
    }
    requireFiniteNumber(value.runtime.resolution, "runtime.resolution");
  } else {
    if (typeof value.runtime.cpuModel !== "string") {
      throw new Error("CPU performance runtime.cpuModel must be a string");
    }
    requireFiniteNumber(value.runtime.cpuCount, "runtime.cpuCount");
  }
  return value as unknown as ComparablePerformanceReport;
}

function isBrowserReport(
  report: ComparablePerformanceReport,
): report is BrowserBenchmarkReport | StudioLoadingReport {
  return "browserName" in report.runtime && "renderer" in report.runtime;
}

function reportKind(
  report: ComparablePerformanceReport,
): PerformanceComparisonReport["reportKind"] {
  if ("surface" in report.runtime && report.runtime.surface === "capture") {
    return "capture";
  }
  if ("surface" in report.runtime && report.runtime.surface === "system") {
    return "system";
  }
  if ("surface" in report.runtime && report.runtime.surface === "studio") {
    return "studio";
  }
  return isBrowserReport(report) ? "browser" : "cpu";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function runtimeFingerprint(report: ComparablePerformanceReport): string {
  const workloads = isBrowserReport(report)
    ? report.results.map((result) => ({
        id: result.id,
        budgetMs: result.budgetMs,
        sampleCount: result.sampleCount,
        workload: result.workload,
        enforced: result.enforced,
      }))
    : report.results.map((result) => ({
        id: result.id,
        budgetMs: result.budgetMs,
        sampleCount: result.sampleCount,
        workload: result.workload,
      }));
  const common = {
    kind: reportKind(report),
    profile: report.profile,
    workloads,
    nodeVersion: report.runtime.nodeVersion,
    platform: report.runtime.platform,
    architecture: report.runtime.architecture,
  };
  if (isBrowserReport(report)) {
    return canonicalJson({
      ...common,
      browserName: report.runtime.browserName,
      browserVersion: report.runtime.browserVersion,
      renderer: report.runtime.renderer,
      resolution: report.runtime.resolution,
      webglVersion: report.runtime.webglVersion,
      gpuAdapter: report.runtime.gpuAdapter,
    });
  }
  return canonicalJson({
    ...common,
    cpuModel: report.runtime.cpuModel,
    cpuCount: report.runtime.cpuCount,
  });
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function latencyClass(
  result: ComparablePerformanceReport["results"][number],
): PerformanceLatencyClass {
  const value = result.workload.latencyClass;
  return value === "cold" || value === "external" ? value : "hot";
}

function requireComparableReports(
  baseline: ComparablePerformanceReport,
  candidate: ComparablePerformanceReport,
): string {
  const baselineKind = reportKind(baseline);
  const candidateKind = reportKind(candidate);
  if (baselineKind !== candidateKind) {
    throw new Error(
      `Performance reports use different runtimes: ${baselineKind} and ${candidateKind}`,
    );
  }
  if (baseline.profile.id !== candidate.profile.id) {
    throw new Error(
      `Performance reports use different profiles: ${baseline.profile.id} and ${candidate.profile.id}`,
    );
  }
  const baselineFingerprint = runtimeFingerprint(baseline);
  const candidateFingerprint = runtimeFingerprint(candidate);
  if (baselineFingerprint !== candidateFingerprint) {
    throw new Error(
      "Performance reports use different workload or runtime fingerprints; record a new baseline for this environment",
    );
  }
  const baselineIds = baseline.results.map((result) => result.id).sort();
  const candidateIds = candidate.results.map((result) => result.id).sort();
  if (JSON.stringify(baselineIds) !== JSON.stringify(candidateIds)) {
    throw new Error(
      "Performance reports do not contain the same workload identities",
    );
  }
  return baselineFingerprint;
}

export function comparePerformanceReports(
  baseline: ComparablePerformanceReport,
  candidate: ComparablePerformanceReport,
  options: ComparePerformanceReportsOptions = {},
): PerformanceComparisonReport {
  const fingerprint = requireComparableReports(baseline, candidate);
  const requireImprovement = options.requireImprovement ?? true;
  const baselineById = new Map(
    baseline.results.map((result) => [result.id, result]),
  );
  const results = candidate.results.map((candidateResult) => {
    const baselineResult = baselineById.get(candidateResult.id)!;
    const medianDeltaMs = candidateResult.medianMs - baselineResult.medianMs;
    const deltaMs = candidateResult.p95Ms - baselineResult.p95Ms;
    const medianToleranceMs = Math.max(
      PERFORMANCE_REGRESSION_TOLERANCE_FLOOR_MS,
      baselineResult.medianMs * PERFORMANCE_REGRESSION_TOLERANCE_RATIO,
    );
    const p95ToleranceMs = Math.max(
      PERFORMANCE_REGRESSION_TOLERANCE_FLOOR_MS,
      baselineResult.p95Ms * PERFORMANCE_REGRESSION_TOLERANCE_RATIO,
    );
    // A code trend must move both the center and tail of the distribution.
    // One-sided movement is retained as stable measurement variance, while
    // the independent p95 target still catches every over-budget tail.
    const trend: PerformanceTrend =
      medianDeltaMs < -medianToleranceMs && deltaMs < -p95ToleranceMs
        ? "improved"
        : medianDeltaMs > medianToleranceMs && deltaMs > p95ToleranceMs
          ? "regressed"
          : "stable";
    const resultLatencyClass = latencyClass(candidateResult);
    const targetMs =
      resultLatencyClass === "hot"
        ? Math.min(PERFORMANCE_HOT_PATH_CEILING_MS, candidateResult.budgetMs)
        : candidateResult.budgetMs;
    const targetStatus = candidateResult.p95Ms <= targetMs ? "pass" : "fail";
    return {
      id: candidateResult.id,
      title: candidateResult.title,
      trend,
      latencyClass: resultLatencyClass,
      status:
        trend !== "regressed" && targetStatus === "pass" ? "pass" : "fail",
      baselineMedianMs: rounded(baselineResult.medianMs),
      candidateMedianMs: rounded(candidateResult.medianMs),
      medianDeltaMs: rounded(medianDeltaMs),
      medianDeltaPercent:
        baselineResult.medianMs === 0
          ? medianDeltaMs === 0
            ? 0
            : Number.POSITIVE_INFINITY
          : rounded((medianDeltaMs / baselineResult.medianMs) * 100),
      baselineP95Ms: rounded(baselineResult.p95Ms),
      candidateP95Ms: rounded(candidateResult.p95Ms),
      deltaMs: rounded(deltaMs),
      deltaPercent:
        baselineResult.p95Ms === 0
          ? deltaMs === 0
            ? 0
            : Number.POSITIVE_INFINITY
          : rounded((deltaMs / baselineResult.p95Ms) * 100),
      toleranceMs: rounded(p95ToleranceMs),
      targetMs: rounded(targetMs),
      targetStatus,
    } satisfies PerformanceComparisonResult;
  });
  const improved = results.filter(
    (result) => result.trend === "improved",
  ).length;
  const stable = results.filter((result) => result.trend === "stable").length;
  const regressed = results.filter(
    (result) => result.trend === "regressed",
  ).length;
  const overTarget = results.filter(
    (result) => result.targetStatus === "fail",
  ).length;
  const status =
    regressed === 0 && overTarget === 0 && (!requireImprovement || improved > 0)
      ? "pass"
      : "fail";

  return {
    schemaVersion: PERFORMANCE_COMPARISON_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    reportKind: reportKind(candidate),
    profileId: candidate.profile.id,
    runtimeFingerprint: fingerprint,
    policy: {
      hotPathCeilingMs: PERFORMANCE_HOT_PATH_CEILING_MS,
      regressionToleranceRatio: PERFORMANCE_REGRESSION_TOLERANCE_RATIO,
      regressionToleranceFloorMs: PERFORMANCE_REGRESSION_TOLERANCE_FLOOR_MS,
      requireImprovement,
    },
    baseline: {
      generatedAt: baseline.generatedAt,
      status: baseline.status,
    },
    candidate: {
      generatedAt: candidate.generatedAt,
      status: candidate.status,
    },
    summary: {
      improved,
      stable,
      regressed,
      overTarget,
      total: results.length,
    },
    results,
  };
}
