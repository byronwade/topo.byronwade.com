import path from "node:path";

import {
  ADAPTER_SCAFFOLD_KINDS,
  applyAdapterScaffold,
  planAdapterScaffold,
  verifyAdapterScaffolds,
  type AdapterScaffoldKind,
  type AdapterScaffoldConformanceReport,
  type AdapterScaffoldPlan,
  type AdapterScaffoldResult,
} from "@topo/adapter-scaffold";

type PrintLine = (line: string) => void;

const VALUE_FLAGS = ["--kind", "--id", "--name", "--output"] as const;
const BOOLEAN_FLAGS = ["--dry-run", "--json"] as const;

function parseAdapterArgs(args: readonly string[]) {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if ((VALUE_FLAGS as readonly string[]).includes(argument)) {
      if (values.has(argument)) throw new Error(`Duplicate option ${argument}`);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      values.set(argument, value);
      index += 1;
      continue;
    }
    if ((BOOLEAN_FLAGS as readonly string[]).includes(argument)) {
      if (booleans.has(argument))
        throw new Error(`Duplicate option ${argument}`);
      booleans.add(argument);
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`Unknown option ${argument}`);
    }
    positionals.push(argument);
    if (positionals.length > 1) {
      throw new Error(`Unexpected positional argument ${argument}`);
    }
  }
  return {
    kind: values.get("--kind"),
    id: values.get("--id"),
    displayName: values.get("--name"),
    outputDirectory: values.get("--output"),
    dryRun: booleans.has("--dry-run"),
    json: booleans.has("--json"),
  };
}

function reportFor(plan: AdapterScaffoldPlan, dryRun: boolean) {
  return {
    schemaVersion: plan.schemaVersion,
    status: plan.status,
    dryRun,
    projectRoot: plan.projectRoot,
    outputDirectory: plan.outputDirectory,
    kind: plan.kind,
    id: plan.id,
    displayName: plan.displayName,
    registration: plan.registration,
    operations: plan.files.map((file) => ({
      path: path.posix.join(plan.outputDirectory, file.path),
      action: "create" as const,
      bytes: Buffer.byteLength(file.content),
    })),
    conflicts: plan.conflicts,
  };
}

function createdReportFor(
  plan: AdapterScaffoldPlan,
  result: AdapterScaffoldResult,
) {
  return {
    ...reportFor(plan, false),
    status: result.status,
    createdPaths: result.createdPaths,
  };
}

export async function runAdapterCommand(
  command: string,
  target: string,
  args: string[],
  print: PrintLine = console.log,
): Promise<void> {
  if (command !== "create" && command !== "check") {
    throw new Error(`Unknown adapters command: ${command}`);
  }
  const parsed = parseAdapterArgs(args);
  if (command === "check") {
    if (
      parsed.kind ||
      parsed.displayName ||
      parsed.outputDirectory ||
      parsed.dryRun
    ) {
      throw new Error("adapters check accepts only --id and --json");
    }
    const report = await verifyAdapterScaffolds(target, { id: parsed.id });
    if (parsed.json) print(JSON.stringify(report, null, 2));
    else printAdapterCheckReport(report, print);
    if (report.status === "fail") {
      throw new Error(
        `Adapter conformance failed: ${report.summary.failed} invalid adapter(s) and ${report.summary.issues} source issue(s).`,
      );
    }
    return;
  }
  const { kind, id, displayName } = parsed;
  if (!kind || !id || !displayName) {
    throw new Error("adapters create requires --kind, --id, and --name");
  }
  if (!ADAPTER_SCAFFOLD_KINDS.includes(kind as AdapterScaffoldKind)) {
    throw new Error(
      `--kind must be one of: ${ADAPTER_SCAFFOLD_KINDS.join(", ")}`,
    );
  }
  const { dryRun, json } = parsed;
  const plan = await planAdapterScaffold({
    projectRoot: target,
    kind: kind as AdapterScaffoldKind,
    id,
    displayName,
    outputDirectory: parsed.outputDirectory,
  });

  if (json && (dryRun || plan.status === "conflict")) {
    print(JSON.stringify(reportFor(plan, dryRun), null, 2));
  } else if (!json) {
    print(
      `Topo adapter scaffold · ${plan.kind} · ${plan.id} · ${plan.outputDirectory}`,
    );
    for (const file of plan.files) {
      print(
        `${dryRun ? "WOULD CREATE" : "CREATE"}  ${path.posix.join(plan.outputDirectory, file.path)}`,
      );
    }
    for (const conflict of plan.conflicts) print(`CONFLICT  ${conflict}`);
  }
  if (plan.status === "conflict") {
    throw new Error("Adapter scaffold has conflicts; no files were changed.");
  }
  if (dryRun) return;

  const result = await applyAdapterScaffold(plan);
  if (json) {
    print(JSON.stringify(createdReportFor(plan, result), null, 2));
    return;
  }
  print(
    `Created ${plan.kind} adapter ${plan.id} in ${result.outputDirectory}.`,
  );
  print(`Register in topo.config.ts: ${result.registration.snippet}`);
  print(
    `Test: node --test ${path.posix.join(result.outputDirectory, "index.test.mjs")}`,
  );
  print(
    `Verify: topo adapters check ${JSON.stringify(target)} --id ${plan.id}`,
  );
}

function printAdapterCheckReport(
  report: AdapterScaffoldConformanceReport,
  print: PrintLine,
): void {
  print(
    `Topo adapter conformance · ${report.status.toUpperCase()} · ${report.summary.passed}/${report.summary.checked} passed`,
  );
  for (const adapter of report.adapters) {
    print(`${adapter.status.toUpperCase()}  ${adapter.kind}  ${adapter.id}`);
    for (const item of adapter.checks) {
      print(`  ${item.status.toUpperCase()}  ${item.id}  ${item.detail}`);
    }
  }
  for (const issue of report.issues) {
    print(`ISSUE  ${issue.filePath}  ${issue.message}`);
  }
}
