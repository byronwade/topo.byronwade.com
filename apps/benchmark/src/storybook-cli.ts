#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runStorybookCaptureCheck } from "./storybook-check.js";

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixtureRoot = path.resolve(
    valueAfter(args, "--fixture") ??
      path.resolve(import.meta.dirname, "../../playground-storybook"),
  );
  const outputPath = path.resolve(
    valueAfter(args, "--output") ??
      path.join(import.meta.dirname, "storybook-capture-report.json"),
  );
  const report = await runStorybookCaptureCheck(fixtureRoot, {
    headless: !args.includes("--headed"),
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      storybookVersion: report.storybookVersion,
      stories: report.stories.map((story) => ({
        exportName: story.exportName,
        storyId: story.storyId,
        status: story.status,
        bytes: story.bytes,
      })),
      passed: report.summary.passed,
      failed: report.summary.failed,
      report: outputPath,
    })}\n`,
  );
  if (report.status === "fail") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Topo Storybook capture check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
