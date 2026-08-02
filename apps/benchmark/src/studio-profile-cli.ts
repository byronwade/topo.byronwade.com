#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runStudioProfileCheck } from "./studio-profile-check.js";

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
      path.join(assetsDir, "studio-profile-report.json"),
  );
  const report = await runStudioProfileCheck(assetsDir, {
    headless: !args.includes("--headed"),
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      profiles: report.profiles.map((profile) => ({
        name: profile.profileName,
        origin: profile.iframeOrigin,
        role: profile.localStorageRole,
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
    `Topo Studio profile check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
