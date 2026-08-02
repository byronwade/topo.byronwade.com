export const BROWSER_BENCHMARK_REPORT_VERSION = 3 as const;

export type BrowserHeapCollection = "cdp-heap-profiler" | "unavailable";

export interface RawBrowserBenchmarkMemory {
  /** Heap before Pixi initialization and benchmark workload allocation. */
  beforeBytes: number;
  /** Heap while the completed Pixi scene and workload resources are live. */
  workingBytes: number;
  /** Heap after teardown and an explicit browser collection, when available. */
  retainedBytes?: number;
  collection: BrowserHeapCollection;
}

export type BrowserBenchmarkResultId =
  | "pixi-initialize"
  | "snapshot-texture-upload"
  | "snapshot-cache-pressure"
  | "atlas-sprite-render"
  | "camera-frame-work"
  | "camera-frame-pacing"
  | "live-frame-promotion";

export interface BrowserBenchmarkProfile {
  id: string;
  spriteCount: number;
  textureCount: number;
  cameraFrames: number;
  liveFrameCount: number;
}

export interface RawBrowserBenchmarkResult {
  id: BrowserBenchmarkResultId;
  title: string;
  description: string;
  samplesMs: number[];
  budgetMs: number;
  /** Whether this result contributes to process exit status on this runtime. */
  enforced: boolean;
  workload: Record<string, number | string>;
}

export interface RawBrowserBenchmarkReport {
  version: typeof BROWSER_BENCHMARK_REPORT_VERSION;
  profile: BrowserBenchmarkProfile;
  renderer: {
    name: string;
    resolution: number;
    webglVersion: string;
    maxTextureSize: number;
    adapter: string;
  };
  memory?: RawBrowserBenchmarkMemory;
  results: RawBrowserBenchmarkResult[];
}

export interface BrowserBenchmarkResult extends RawBrowserBenchmarkResult {
  unit: "ms";
  status: "pass" | "fail";
  sampleCount: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface BrowserBenchmarkRuntimeMetadata {
  browserName: string;
  browserVersion: string;
  generatedAt: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  architecture: string;
}

export interface BrowserBenchmarkReport {
  version: typeof BROWSER_BENCHMARK_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  profile: BrowserBenchmarkProfile;
  runtime: BrowserBenchmarkRuntimeMetadata & {
    renderer: string;
    resolution: number;
    webglVersion: string;
    maxTextureSize: number;
    gpuAdapter: string;
    jsHeapBeforeBytes?: number;
    jsHeapWorkingBytes?: number;
    jsHeapWorkingDeltaBytes?: number;
    jsHeapRetainedBytes?: number;
    jsHeapRetainedDeltaBytes?: number;
    jsHeapCollection?: BrowserHeapCollection;
  };
  summary: {
    passed: number;
    failed: number;
    informationalFailures: number;
    total: number;
  };
  results: BrowserBenchmarkResult[];
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function summarize(raw: RawBrowserBenchmarkResult): BrowserBenchmarkResult {
  if (raw.samplesMs.length === 0) {
    throw new Error(`Browser benchmark "${raw.id}" has no samples`);
  }
  const sorted = [...raw.samplesMs].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p95 = sorted[p95Index] ?? 0;
  return {
    ...raw,
    samplesMs: raw.samplesMs.map(rounded),
    budgetMs: rounded(raw.budgetMs),
    unit: "ms",
    status: p95 <= raw.budgetMs ? "pass" : "fail",
    sampleCount: raw.samplesMs.length,
    medianMs: rounded(median),
    p95Ms: rounded(p95),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

export function finalizeBrowserBenchmarkReport(
  raw: RawBrowserBenchmarkReport,
  metadata: BrowserBenchmarkRuntimeMetadata,
): BrowserBenchmarkReport {
  const results = raw.results.map(summarize);
  const failed = results.filter(
    (result) => result.status === "fail" && result.enforced,
  ).length;
  const informationalFailures = results.filter(
    (result) => result.status === "fail" && !result.enforced,
  ).length;
  const passed = results.filter((result) => result.status === "pass").length;
  const memory = raw.memory;
  return {
    version: BROWSER_BENCHMARK_REPORT_VERSION,
    generatedAt: metadata.generatedAt,
    status: failed === 0 ? "pass" : "fail",
    profile: raw.profile,
    runtime: {
      ...metadata,
      renderer: raw.renderer.name,
      resolution: raw.renderer.resolution,
      webglVersion: raw.renderer.webglVersion,
      maxTextureSize: raw.renderer.maxTextureSize,
      gpuAdapter: raw.renderer.adapter,
      ...(memory
        ? {
            jsHeapBeforeBytes: memory.beforeBytes,
            jsHeapWorkingBytes: memory.workingBytes,
            jsHeapWorkingDeltaBytes: memory.workingBytes - memory.beforeBytes,
            ...(memory.retainedBytes === undefined
              ? {}
              : {
                  jsHeapRetainedBytes: memory.retainedBytes,
                  jsHeapRetainedDeltaBytes:
                    memory.retainedBytes - memory.beforeBytes,
                }),
            jsHeapCollection: memory.collection,
          }
        : {}),
    },
    summary: {
      passed,
      failed,
      informationalFailures,
      total: results.length,
    },
    results,
  };
}
