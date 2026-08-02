import { describe, expect, it } from "vitest";

import { finalizeBrowserBenchmarkReport } from "./browser-contract.js";

describe("finalizeBrowserBenchmarkReport", () => {
  it("turns raw browser samples into one versioned, budgeted evidence report", () => {
    const report = finalizeBrowserBenchmarkReport(
      {
        version: 3,
        profile: {
          id: "test",
          spriteCount: 100,
          textureCount: 20,
          cameraFrames: 5,
          liveFrameCount: 4,
        },
        renderer: {
          name: "WebGL",
          resolution: 1,
          webglVersion: "WebGL 2.0",
          maxTextureSize: 16_384,
          adapter: "ANGLE SwiftShader",
        },
        memory: {
          beforeBytes: 10_000,
          workingBytes: 12_000,
          retainedBytes: 10_500,
          collection: "cdp-heap-profiler",
        },
        results: [
          {
            id: "snapshot-texture-upload",
            title: "Snapshot texture upload",
            description: "Upload exact synthetic screen textures.",
            samplesMs: [8, 10, 12],
            budgetMs: 16,
            enforced: true,
            workload: { textures: 20 },
          },
          {
            id: "camera-frame-pacing",
            title: "Camera frame pacing",
            description: "Move the same Pixi world over animation frames.",
            samplesMs: [14, 16, 24],
            budgetMs: 20,
            enforced: false,
            workload: { frames: 3 },
          },
        ],
      },
      {
        browserName: "chromium",
        browserVersion: "140.0.0",
        generatedAt: "2026-08-01T00:00:00.000Z",
        nodeVersion: "v24.0.0",
        platform: "win32",
        architecture: "x64",
      },
    );

    expect(report).toMatchObject({
      version: 3,
      status: "pass",
      summary: {
        passed: 1,
        failed: 0,
        informationalFailures: 1,
        total: 2,
      },
      runtime: {
        browserName: "chromium",
        renderer: "WebGL",
        gpuAdapter: "ANGLE SwiftShader",
        jsHeapWorkingDeltaBytes: 2_000,
        jsHeapRetainedDeltaBytes: 500,
        jsHeapCollection: "cdp-heap-profiler",
      },
    });
    expect(report.results).toEqual([
      expect.objectContaining({
        id: "snapshot-texture-upload",
        enforced: true,
        status: "pass",
        medianMs: 10,
        p95Ms: 12,
      }),
      expect.objectContaining({
        id: "camera-frame-pacing",
        enforced: false,
        status: "fail",
        medianMs: 16,
        p95Ms: 24,
      }),
    ]);
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      profile: { spriteCount: 100 },
      results: [{ samplesMs: [8, 10, 12] }, { samplesMs: [14, 16, 24] }],
    });
  });
});
