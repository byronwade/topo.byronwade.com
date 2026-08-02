#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  builtInFrameworkFixtureDefinitions,
  runFrameworkFixtureCheck,
} from "./framework-fixture-check.js";

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
      path.join(
        repositoryRoot,
        "artifacts",
        "framework-fixtures",
        "report.json",
      ),
  );
  const report = await runFrameworkFixtureCheck(
    builtInFrameworkFixtureDefinitions(repositoryRoot),
    { headless: !args.includes("--headed") },
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      fixtures: report.fixtures.map((fixture) => ({
        id: fixture.id,
        status: fixture.status,
        routes: fixture.routes.filter((route) => route.matched).length,
        totalRoutes: fixture.routes.length,
      })),
      report: outputPath,
    })}\n`,
  );
  if (report.status === "fail") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Topo framework fixture check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
