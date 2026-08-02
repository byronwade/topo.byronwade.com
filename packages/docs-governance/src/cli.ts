#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { recordProductChange, validateDocumentation } from "./index.js";
import type { ChangeType } from "./policy.js";

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const rootDir = path.resolve(packageDirectory, "..", "..");
const args = process.argv.slice(2);
const command = args[0] ?? "check";

function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (command === "check") {
  const report = await validateDocumentation(rootDir);
  if (!report.ok) {
    for (const issue of report.issues) {
      console.error(
        `${issue.code}${issue.filePath ? ` · ${issue.filePath}` : ""}: ${issue.message}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log(
      `Documentation is synchronized · ${report.featureCount} features · ${report.checkedFiles} files checked`,
    );
  }
} else if (command === "record") {
  const id = flag("--id");
  const summary = flag("--summary");
  const date = flag("--date") ?? new Date().toISOString().slice(0, 10);
  const type = (flag("--type") ?? "changed") as ChangeType;
  const featureIds = flag("--feature")?.split(",").filter(Boolean);
  if (!id || !summary || !["added", "changed", "removed"].includes(type)) {
    throw new Error(
      "record requires --id, --summary, and optional --type added|changed|removed",
    );
  }
  const change = await recordProductChange(rootDir, {
    id,
    date,
    summary,
    type,
    featureIds,
  });
  console.log(
    `Recorded ${change.features.length} feature changes in ${change.id}`,
  );
} else {
  throw new Error(`Unknown docs-governance command: ${command}`);
}
