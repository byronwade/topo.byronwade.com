#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runTopoBenchmarks } from "./index.js";
import { runTopoBrowserBenchmarks } from "./browser-benchmark.js";
import { parseBenchmarkCliArgs } from "./cli-options.js";
import { renderBenchmarkMarkdown } from "./report.js";
import {
  comparePerformanceReports,
  parseComparablePerformanceReport,
} from "./comparison.js";

const HELP = `Topo benchmark

Usage:
  pnpm benchmark [options]

Options:
  --profile <smoke|standard|stress>  Workload size (default: standard)
  --browser                          Run real Chromium, Pixi, texture, and iframe workloads
  --iterations <count>               Measured iterations (default: 21)
  --warmup <count>                   Warmup iterations (default: 2)
  --format <markdown|json>           Report format (default: markdown)
  --output <path>                    Write the report to a file
  --baseline <path>                  Compare against a retained same-runtime report
  --comparison-output <path>         Write versioned comparison JSON (derived by default)
  --allow-stable                     Permit a no-regression candidate without an improvement
  --check                            Exit non-zero when a p95 budget fails
  --help                             Show this help
`;

async function main(): Promise<void> {
  const options = parseBenchmarkCliArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const report = options.browser
    ? await runTopoBrowserBenchmarks({ profile: options.profile })
    : await runTopoBenchmarks({
        profile: options.profile,
        iterations: options.iterations,
        warmupIterations: options.warmupIterations,
      });
  const output =
    options.format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderBenchmarkMarkdown(report);
  let comparison:
    | ReturnType<typeof comparePerformanceReports>
    | undefined;

  if (options.baselinePath) {
    const baselinePath = path.resolve(options.baselinePath);
    const baseline = parseComparablePerformanceReport(
      JSON.parse(await readFile(baselinePath, "utf8")) as unknown,
    );
    comparison = comparePerformanceReports(baseline, report, {
      requireImprovement: options.requireImprovement,
    });
  }

  if (options.outputPath) {
    const absolutePath = path.resolve(options.outputPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, output, "utf8");
    process.stdout.write(
      `Topo benchmark ${report.status.toUpperCase()} · ${absolutePath}\n`,
    );
    if (comparison) {
      const parsed = path.parse(absolutePath);
      const comparisonPath = path.resolve(
        options.comparisonOutputPath ??
          path.join(parsed.dir, `${parsed.name}.comparison.json`),
      );
      await mkdir(path.dirname(comparisonPath), { recursive: true });
      await writeFile(
        comparisonPath,
        `${JSON.stringify(comparison, null, 2)}\n`,
        "utf8",
      );
      process.stdout.write(
        `Topo comparison ${comparison.status.toUpperCase()} · ${comparisonPath}\n`,
      );
    }
  } else {
    process.stdout.write(output);
  }

  if (
    options.check &&
    (report.status === "fail" || comparison?.status === "fail")
  ) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Topo benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
