import { describe, expect, it } from "vitest";

import { summarizeWebSamples } from "./web-performance.js";

describe("summarizeWebSamples", () => {
  it("retains every sample and applies the p95 budget", () => {
    expect(
      summarizeWebSamples(
        { id: "lcp", title: "LCP", latencyClass: "cold" },
        [100, 80, 90, 110, 95],
        105,
      ),
    ).toMatchObject({
      samplesMs: [100, 80, 90, 110, 95],
      sampleCount: 5,
      medianMs: 95,
      p95Ms: 110,
      maxMs: 110,
      status: "fail",
    });
  });
});
