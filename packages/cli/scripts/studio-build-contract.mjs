const requiredChecks = [
  "initial-js-bytes",
  "initial-js-gzip-bytes",
  "lazy-destinations",
  "lazy-pixi-runtime",
  "lazy-review-export",
  "lazy-studio-validation",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertPackedStudioBuildReport(report) {
  if (!isRecord(report)) {
    throw new Error("packed Studio build evidence must be an object");
  }
  if (report.schemaVersion !== 3) {
    throw new Error("packed Studio build evidence must use schema version 3");
  }
  if (report.status !== "pass") {
    throw new Error("packed Studio build evidence must have pass status");
  }
  if (!Array.isArray(report.destinations) || report.destinations.length !== 5) {
    throw new Error(
      "packed Studio build evidence must include five destinations",
    );
  }
  if (!isRecord(report.pixi) || report.pixi.deferred !== true) {
    throw new Error("packed Studio Pixi runtime must be deferred");
  }
  if (!isRecord(report.reviewExport) || report.reviewExport.deferred !== true) {
    throw new Error("packed Studio review export renderer must be deferred");
  }
  if (!isRecord(report.validation) || report.validation.deferred !== true) {
    throw new Error("packed Studio validation runtime must be deferred");
  }
  if (
    !isRecord(report.summary) ||
    report.summary.passed !== 6 ||
    report.summary.failed !== 0 ||
    report.summary.total !== 6
  ) {
    throw new Error("packed Studio build evidence must pass all six checks");
  }
  if (!Array.isArray(report.checks)) {
    throw new Error("packed Studio build evidence must include named checks");
  }
  const statuses = new Map(
    report.checks.filter(isRecord).map((check) => [check.id, check.status]),
  );
  const failed = requiredChecks.filter((id) => statuses.get(id) !== "pass");
  if (failed.length > 0) {
    throw new Error(
      `packed Studio build evidence has missing or failed checks: ${failed.join(", ")}`,
    );
  }
}

export function summarizePackedStudioBuildReport(report) {
  assertPackedStudioBuildReport(report);
  return {
    schemaVersion: report.schemaVersion,
    status: report.status,
    initialJsBytes: report.initial?.bytes,
    initialJsGzipBytes: report.initial?.gzipBytes,
    lazyDestinations: report.destinations.length,
    pixiDeferred: report.pixi.deferred,
    reviewExportDeferred: report.reviewExport.deferred,
    validationDeferred: report.validation.deferred,
  };
}
