import { describe, expect, it } from "vitest";

import {
  assertPackedStudioBuildReport,
  summarizePackedStudioBuildReport,
} from "./studio-build-contract.mjs";

function fixture() {
  return {
    schemaVersion: 3,
    status: "pass",
    initial: { bytes: 339_687, gzipBytes: 101_531 },
    summary: { passed: 6, failed: 0, total: 6 },
    destinations: Array.from({ length: 5 }, (_, index) => ({
      source: `destination:${index}`,
    })),
    pixi: { deferred: true },
    reviewExport: { deferred: true },
    validation: { deferred: true },
    checks: [
      { id: "initial-js-bytes", status: "pass" },
      { id: "initial-js-gzip-bytes", status: "pass" },
      { id: "lazy-destinations", status: "pass" },
      { id: "lazy-pixi-runtime", status: "pass" },
      { id: "lazy-review-export", status: "pass" },
      { id: "lazy-studio-validation", status: "pass" },
    ],
  };
}

describe("packed Studio build contract", () => {
  it("accepts the complete version-three lazy-loading evidence", () => {
    const report = fixture();
    expect(() => assertPackedStudioBuildReport(report)).not.toThrow();
    expect(summarizePackedStudioBuildReport(report)).toEqual({
      schemaVersion: 3,
      status: "pass",
      initialJsBytes: 339_687,
      initialJsGzipBytes: 101_531,
      lazyDestinations: 5,
      pixiDeferred: true,
      reviewExportDeferred: true,
      validationDeferred: true,
    });
  });

  it("rejects stale report versions and eager review rendering", () => {
    expect(() =>
      assertPackedStudioBuildReport({ ...fixture(), schemaVersion: 1 }),
    ).toThrow("schema version 3");
    expect(() =>
      assertPackedStudioBuildReport({
        ...fixture(),
        reviewExport: { deferred: false },
      }),
    ).toThrow("review export renderer must be deferred");
    expect(() =>
      assertPackedStudioBuildReport({
        ...fixture(),
        validation: { deferred: false },
      }),
    ).toThrow("validation runtime must be deferred");
  });
});
