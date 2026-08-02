import { describe, expect, it } from "vitest";

import { parseBenchmarkCliArgs } from "./cli-options.js";
import { renderBenchmarkMarkdown } from "./report.js";
import type { BenchmarkReport } from "./index.js";
import type { BrowserBenchmarkReport } from "./browser-contract.js";

describe("parseBenchmarkCliArgs", () => {
  it("parses one explicit benchmark invocation without hidden configuration", () => {
    expect(
      parseBenchmarkCliArgs([
        "--profile",
        "stress",
        "--iterations",
        "7",
        "--warmup",
        "2",
        "--format",
        "json",
        "--output",
        "artifacts/benchmarks/stress.json",
        "--baseline",
        "artifacts/benchmarks/baseline.json",
        "--comparison-output",
        "artifacts/benchmarks/comparison.json",
        "--check",
      ]),
    ).toEqual({
      profile: "stress",
      iterations: 7,
      warmupIterations: 2,
      format: "json",
      outputPath: "artifacts/benchmarks/stress.json",
      baselinePath: "artifacts/benchmarks/baseline.json",
      comparisonOutputPath: "artifacts/benchmarks/comparison.json",
      browser: false,
      requireImprovement: true,
      check: true,
      help: false,
    });
  });

  it("selects the real Chromium and Pixi benchmark explicitly", () => {
    expect(parseBenchmarkCliArgs(["--browser"])).toMatchObject({
      browser: true,
      profile: "standard",
    });
  });

  it("requires retained candidate evidence for a baseline comparison", () => {
    expect(() =>
      parseBenchmarkCliArgs(["--baseline", "baseline.json"]),
    ).toThrow("--baseline requires --output");
    expect(() =>
      parseBenchmarkCliArgs(["--comparison-output", "comparison.json"]),
    ).toThrow("--comparison-output requires --baseline");
  });

  it("rejects unknown flags instead of silently changing a benchmark", () => {
    expect(() => parseBenchmarkCliArgs(["--fast"])).toThrow(
      'Unknown benchmark option "--fast"',
    );
  });

  it("renders the same result contract as an agent-readable Markdown report", () => {
    const report = {
      version: 2,
      generatedAt: "2026-08-01T00:00:00.000Z",
      status: "pass",
      profile: {
        id: "test",
        routeCount: 24,
        componentCount: 8,
        flowCount: 4,
        cameraOperations: 1_000,
      },
      runtime: {
        nodeVersion: "v24.0.0",
        platform: "win32",
        architecture: "x64",
        cpuModel: "Fixture CPU",
        cpuCount: 8,
        totalMemoryBytes: 16_000_000_000,
      },
      settings: { iterations: 2, warmupIterations: 0 },
      summary: {
        passed: 1,
        failed: 0,
        total: 1,
      },
      results: [
        {
          id: "scan-workspace",
          title: "Workspace scan",
          description: "Read source files and normalize routes.",
          unit: "ms",
          status: "pass",
          budgetMs: 50,
          sampleCount: 2,
          samplesMs: [10, 12],
          medianMs: 11,
          p95Ms: 12,
          maxMs: 12,
          workload: { routes: 24 },
        },
      ],
    } satisfies BenchmarkReport;

    expect(renderBenchmarkMarkdown(report)).toContain(
      "| Workspace scan | PASS | 11.000 ms | 12.000 ms | 50.000 ms |",
    );
    expect(renderBenchmarkMarkdown(report)).toContain(
      '```json\n{\n  "routes": 24\n}\n```',
    );
  });

  it("renders browser and renderer context without pretending it is a route profile", () => {
    const report = {
      version: 3,
      generatedAt: "2026-08-01T00:00:00.000Z",
      status: "pass",
      profile: {
        id: "test",
        spriteCount: 100,
        textureCount: 20,
        cameraFrames: 60,
        liveFrameCount: 4,
      },
      runtime: {
        browserName: "chromium",
        browserVersion: "140.0.0",
        generatedAt: "2026-08-01T00:00:00.000Z",
        nodeVersion: "v24.0.0",
        platform: "win32",
        architecture: "x64",
        renderer: "WebGL",
        resolution: 1,
        webglVersion: "WebGL 2.0",
        maxTextureSize: 16_384,
        gpuAdapter: "ANGLE test adapter",
        jsHeapBeforeBytes: 10_000_000,
        jsHeapWorkingBytes: 14_000_000,
        jsHeapWorkingDeltaBytes: 4_000_000,
        jsHeapRetainedBytes: 10_500_000,
        jsHeapRetainedDeltaBytes: 500_000,
        jsHeapCollection: "cdp-heap-profiler",
      },
      summary: {
        passed: 0,
        failed: 0,
        informationalFailures: 1,
        total: 1,
      },
      results: [
        {
          id: "atlas-sprite-render",
          title: "Atlas sprite render",
          description: "Render the atlas sprite batch.",
          unit: "ms",
          status: "fail",
          enforced: false,
          budgetMs: 10,
          sampleCount: 1,
          samplesMs: [12],
          medianMs: 12,
          p95Ms: 12,
          maxMs: 12,
          workload: { sprites: 100 },
        },
      ],
    } satisfies BrowserBenchmarkReport;

    expect(renderBenchmarkMarkdown(report)).toContain(
      "Profile: `test` (100 sprites, 20 textures, 60 camera frames, 4 live frames)",
    );
    expect(renderBenchmarkMarkdown(report)).toContain(
      "Runtime: chromium 140.0.0 · WebGL · WebGL 2.0",
    );
    expect(renderBenchmarkMarkdown(report)).toContain(
      "Heap: 9.54 MiB before · 13.35 MiB working (+3.81 MiB) · 10.01 MiB retained after cdp-heap-profiler (+0.48 MiB)",
    );
    expect(renderBenchmarkMarkdown(report)).toContain(
      "| Atlas sprite render | FAIL (INFO) | 12.000 ms | 12.000 ms | 10.000 ms |",
    );
  });
});
