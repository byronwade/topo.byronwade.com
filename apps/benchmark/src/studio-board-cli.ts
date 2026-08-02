#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runStudioBoardCheck } from "./studio-board-check.js";

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const assetsDir = path.resolve(
    valueAfter(args, "--assets") ??
      path.resolve(import.meta.dirname, "../../studio/dist"),
  );
  const outputPath = path.resolve(
    valueAfter(args, "--output") ??
      path.join(assetsDir, "studio-board-report.json"),
  );
  const screenshotDir = args.includes("--no-screenshots")
    ? undefined
    : path.resolve(
        valueAfter(args, "--screenshots") ??
          path.join(assetsDir, "studio-board-screenshots"),
      );
  const report = await runStudioBoardCheck(assetsDir, {
    headless: !args.includes("--headed"),
    screenshotDir,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      passed: report.summary.passed,
      failed: report.summary.failed,
      total: report.summary.total,
      screenshots: screenshotDir ?? "disabled",
      report: outputPath,
    })}\n`,
  );
  if (report.status === "fail") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Topo Studio board check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
