#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runLocalRuntimeCheck } from "./local-runtime-check.js";

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repositoryRoot = path.resolve(
    valueAfter(args, "--root") ?? path.resolve(import.meta.dirname, "../../.."),
  );
  const outputPath = path.resolve(
    valueAfter(args, "--output") ??
      path.join(repositoryRoot, "artifacts", "local-runtime", "report.json"),
  );
  const screenshotPath = args.includes("--no-screenshot")
    ? undefined
    : path.resolve(
        valueAfter(args, "--screenshot") ??
          path.join(
            repositoryRoot,
            "artifacts",
            "local-runtime",
            "studio-atlas.png",
          ),
      );
  const report = await runLocalRuntimeCheck(repositoryRoot, {
    headless: !args.includes("--headed"),
    screenshotPath,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      passed: report.summary.passed,
      failed: report.summary.failed,
      total: report.summary.total,
      report: outputPath,
      screenshot: screenshotPath ?? "disabled",
    })}\n`,
  );
  if (report.status === "fail") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Topo local runtime check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
