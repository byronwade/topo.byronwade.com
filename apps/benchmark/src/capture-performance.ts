import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { chromium } from "playwright";

import { captureGraph } from "@topo/snapshots";
import type { ApplicationGraph } from "@topo/schema";

export const CAPTURE_PERFORMANCE_REPORT_VERSION = 1 as const;

export type CapturePerformanceResultId =
  "capture-orchestration" | "capture-browser-batch";

export interface CapturePerformanceResult {
  id: CapturePerformanceResultId;
  title: string;
  description: string;
  samplesMs: number[];
  budgetMs: number;
  workload: Record<string, number | string>;
  unit: "ms";
  status: "pass" | "fail";
  sampleCount: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface CapturePerformanceReport {
  version: typeof CAPTURE_PERFORMANCE_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  profile: {
    id: "capture-standard";
    orchestrationScreens: number;
    browserScreens: number;
  };
  runtime: {
    surface: "capture";
    nodeVersion: string;
    platform: NodeJS.Platform;
    architecture: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryBytes: number;
    browserName: "chromium";
    browserVersion: string;
  };
  settings: {
    iterations: number;
    viewportWidth: number;
    viewportHeight: number;
  };
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  results: CapturePerformanceResult[];
}

export interface RunCapturePerformanceOptions {
  iterations?: number;
  orchestrationScreens?: number;
  browserScreens?: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error("Capture benchmark counts must be positive integers");
  }
  return resolved;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

export function summarizeCapturePerformanceResult(input: {
  id: CapturePerformanceResultId;
  title: string;
  description: string;
  samplesMs: readonly number[];
  budgetMs: number;
  workload: Record<string, number | string>;
}): CapturePerformanceResult {
  if (input.samplesMs.length === 0) {
    throw new Error(`Capture benchmark "${input.id}" has no samples`);
  }
  const sorted = [...input.samplesMs].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    samplesMs: input.samplesMs.map(rounded),
    budgetMs: input.budgetMs,
    workload: input.workload,
    unit: "ms",
    status: p95 <= input.budgetMs ? "pass" : "fail",
    sampleCount: input.samplesMs.length,
    medianMs: rounded(median),
    p95Ms: rounded(p95),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

function captureGraphFixture(
  rootDir: string,
  baseUrl: string,
  screenCount: number,
): ApplicationGraph {
  return {
    version: 1,
    generatedAt: "2026-08-02T00:00:00.000Z",
    rootDir,
    previewBaseUrl: baseUrl,
    framework: "capture-benchmark",
    projectRecognition: {
      version: 1,
      status: "recognized",
      frameworks: [],
      capabilities: [],
      sourceFileCount: screenCount,
    },
    flowTransitions: [],
    inferredFlows: [],
    screens: Array.from({ length: screenCount }, (_, index) => ({
      id: `capture:screen:${index}`,
      kind: "screen" as const,
      title: `Capture screen ${index}`,
      routePath: `/screen-${index}`,
      framework: "capture-benchmark",
      state: "default" as const,
      group: "/benchmark",
      source: { filePath: `src/screen-${index}.tsx`, line: 1 },
      renderStatus: "unseen" as const,
      tags: [],
    })),
    components: [],
    apiEndpoints: [],
    edges: [],
    findings: [],
    sourceIssues: [],
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Capture benchmark server did not receive a port");
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function measure(
  iterations: number,
  operation: (index: number) => Promise<void>,
): Promise<number[]> {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await operation(index);
    samples.push(performance.now() - startedAt);
  }
  return samples;
}

export async function runCapturePerformance(
  options: RunCapturePerformanceOptions = {},
): Promise<CapturePerformanceReport> {
  const iterations = positiveInteger(options.iterations, 5);
  const orchestrationScreens = positiveInteger(
    options.orchestrationScreens,
    20,
  );
  const browserScreens = positiveInteger(options.browserScreens, 3);
  const roots: string[] = [];
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(
      "<!doctype html><html><head><title>Topo capture benchmark</title></head><body><main data-capture-ready>Ready</main></body></html>",
    );
  });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const metadataBrowser = await chromium.launch({ headless: true });
  const browserVersion = metadataBrowser.version();
  await metadataBrowser.close();

  try {
    const orchestrationSamples = await measure(iterations, async (index) => {
      const rootDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `topo-capture-orchestration-${index}-`),
      );
      roots.push(rootDir);
      const graph = captureGraphFixture(rootDir, baseUrl, orchestrationScreens);
      const result = await captureGraph({
        rootDir,
        graph,
        viewport: { width: 640, height: 400 },
        capture: async ({ routePath, viewport }) => ({
          url: new URL(routePath, baseUrl).toString(),
          title: "Fixture capture",
          screenshot: Buffer.from(`fixture:${routePath}`),
          width: viewport?.width ?? 640,
          height: viewport?.height ?? 400,
          capturedAt: "2026-08-02T00:00:00.000Z",
        }),
      });
      if (
        result.failures.length > 0 ||
        result.snapshots.length !== orchestrationScreens
      ) {
        throw new Error("Capture orchestration benchmark lost screen evidence");
      }
    });

    const browserSamples = await measure(iterations, async (index) => {
      const rootDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `topo-capture-browser-${index}-`),
      );
      roots.push(rootDir);
      const graph = captureGraphFixture(rootDir, baseUrl, browserScreens);
      const result = await captureGraph({
        rootDir,
        graph,
        viewport: { width: 640, height: 400 },
        headless: true,
      });
      if (
        result.failures.length > 0 ||
        result.snapshots.length !== browserScreens
      ) {
        throw new Error("Browser capture benchmark lost screen evidence");
      }
    });

    const results = [
      summarizeCapturePerformanceResult({
        id: "capture-orchestration",
        title: "Capture orchestration",
        description:
          "Persist deterministic snapshots and update graph state with browser and network work replaced by an in-memory capture boundary.",
        samplesMs: orchestrationSamples,
        budgetMs: 50,
        workload: {
          latencyClass: "hot",
          screens: orchestrationScreens,
          browser: "stubbed",
          persistence: "real",
        },
      }),
      summarizeCapturePerformanceResult({
        id: "capture-browser-batch",
        title: "Browser capture batch",
        description:
          "Capture multiple real local pages through Chromium, encode PNG evidence, persist snapshots, and update graph state.",
        samplesMs: browserSamples,
        budgetMs: 5_000,
        workload: {
          latencyClass: "external",
          screens: browserScreens,
          browser: "chromium",
          browserVersion,
          viewport: "640x400",
        },
      }),
    ];
    const failed = results.filter((result) => result.status === "fail").length;
    const cpus = os.cpus();
    return {
      version: CAPTURE_PERFORMANCE_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      status: failed === 0 ? "pass" : "fail",
      profile: {
        id: "capture-standard",
        orchestrationScreens,
        browserScreens,
      },
      runtime: {
        surface: "capture",
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpuModel: cpus[0]?.model ?? "unknown",
        cpuCount: cpus.length,
        totalMemoryBytes: os.totalmem(),
        browserName: "chromium",
        browserVersion,
      },
      settings: { iterations, viewportWidth: 640, viewportHeight: 400 },
      summary: {
        passed: results.length - failed,
        failed,
        total: results.length,
      },
      results,
    };
  } finally {
    await closeServer(server);
    await Promise.all(
      roots.map((rootDir) => fs.rm(rootDir, { recursive: true, force: true })),
    );
  }
}
