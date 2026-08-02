#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  comparePerformanceReports,
  parseComparablePerformanceReport,
} from "./comparison.js";
import { runCapturePerformance } from "./capture-performance.js";

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function integerAfter(args: string[], name: string): number | undefined {
  const value = valueAfter(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputPath = path.resolve(
    valueAfter(args, "--output") ??
      "artifacts/benchmarks/performance-capture.json",
  );
  const report = await runCapturePerformance({
    iterations: integerAfter(args, "--iterations"),
    orchestrationScreens: integerAfter(args, "--orchestration-screens"),
    browserScreens: integerAfter(args, "--browser-screens"),
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const baselinePath = valueAfter(args, "--baseline");
  let comparisonStatus: "pass" | "fail" | undefined;
  let comparisonPath: string | undefined;
  if (baselinePath) {
    const baseline = parseComparablePerformanceReport(
      JSON.parse(await readFile(path.resolve(baselinePath), "utf8")),
    );
    const comparison = comparePerformanceReports(baseline, report, {
      requireImprovement: !args.includes("--allow-stable"),
    });
    comparisonPath = path.resolve(
      valueAfter(args, "--comparison-output") ??
        outputPath.replace(/\.json$/u, ".comparison.json"),
    );
    await mkdir(path.dirname(comparisonPath), { recursive: true });
    await writeFile(
      comparisonPath,
      `${JSON.stringify(comparison, null, 2)}\n`,
      "utf8",
    );
    comparisonStatus = comparison.status;
  }

  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      orchestrationP95Ms: report.results[0]?.p95Ms,
      browserBatchP95Ms: report.results[1]?.p95Ms,
      comparisonStatus,
      comparison: comparisonPath,
      report: outputPath,
    })}\n`,
  );
  if (report.status === "fail" || comparisonStatus === "fail") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Topo capture benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
