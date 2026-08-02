import { writeFile } from "node:fs/promises";
import path from "node:path";

import { inspectStudioBuild } from "@topo/studio-host";

const assetsDir = path.resolve(process.argv[2] ?? "dist");
const report = await inspectStudioBuild(assetsDir);
const reportPath = path.join(assetsDir, "studio-build-report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `${JSON.stringify({
    status: report.status,
    initialJsBytes: report.initial.bytes,
    initialJsGzipBytes: report.initial.gzipBytes,
    lazyDestinations: report.destinations.length,
    pixiDeferred: report.pixi.deferred,
    reviewExportDeferred: report.reviewExport.deferred,
    validationDeferred: report.validation.deferred,
    report: reportPath,
  })}\n`,
);

if (report.status !== "pass") {
  const failures = report.checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.detail}`)
    .join("\n");
  throw new Error(`Topo Studio build contract failed:\n${failures}`);
}
