import {
  applyProjectMigration,
  applyProjectUpdate,
  planProjectMigration,
  planProjectUpdate,
  type ProjectMigrationPlan,
  type ProjectMigrationResult,
  type ProjectUpdatePlan,
  type ProjectUpdateResult,
} from "@topo/project-lifecycle";
import path from "node:path";

type LifecycleCommand = "migrate" | "update";
type WriteLine = (line: string) => void;

interface ParsedLifecycleArgs {
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly packageSpec?: string;
  readonly version?: string;
}

function parseLifecycleArgs(
  command: LifecycleCommand,
  args: readonly string[],
  projectRoot: string,
): ParsedLifecycleArgs {
  let dryRun = false;
  let json = false;
  let packageSpec: string | undefined;
  let version: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (seen.has(arg)) throw new Error(`Duplicate option ${arg}`);
    if (arg === "--dry-run" || arg === "--json") {
      seen.add(arg);
      if (arg === "--dry-run") dryRun = true;
      else json = true;
      continue;
    }
    if (arg === "--package-spec" || arg === "--version") {
      if (command === "migrate") {
        throw new Error(`Unknown option ${arg}`);
      }
      seen.add(arg);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      if (arg === "--package-spec") packageSpec = value;
      else version = value;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    if (
      path.resolve(arg) === path.resolve(projectRoot) &&
      !seen.has("<path>")
    ) {
      seen.add("<path>");
      continue;
    }
    throw new Error(`Unexpected positional argument ${arg}`);
  }
  return { dryRun, json, packageSpec, version };
}

function migrationSummary(
  plan: ProjectMigrationPlan,
  result: ProjectMigrationResult | undefined,
  dryRun: boolean,
) {
  return {
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    status: result?.status ?? plan.status,
    dryRun,
    projectRoot: plan.projectRoot,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    steps: plan.steps,
    changedPaths: result?.changedPaths ?? plan.changedPaths,
    conflicts: plan.conflicts,
  };
}

function updateSummary(
  plan: ProjectUpdatePlan,
  result: ProjectUpdateResult | undefined,
  dryRun: boolean,
) {
  return {
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    status: result?.status ?? plan.status,
    dryRun,
    projectRoot: plan.projectRoot,
    previousVersion: result?.previousVersion ?? plan.currentVersion,
    version: result?.version ?? plan.targetVersion,
    packageName: plan.packageName,
    packageSpec: plan.packageSpec,
    changedPaths: result?.changedPaths ?? plan.changedPaths,
    installCommand: plan.installCommand,
    conflicts: plan.conflicts,
  };
}

function writeMigrationHuman(
  summary: ReturnType<typeof migrationSummary>,
  write: WriteLine,
): void {
  write(`Topo migrate · ${summary.projectRoot}`);
  write(
    summary.status === "current"
      ? `Current · install manifest v${summary.toVersion}`
      : `${summary.status === "ready" ? "Plan" : "Result"} · v${String(summary.fromVersion ?? "unknown")} → v${summary.toVersion}`,
  );
  for (const step of summary.steps) write(`  ${step.id} · ${step.summary}`);
  for (const conflict of summary.conflicts) write(`  conflict · ${conflict}`);
  if (summary.dryRun && summary.status === "ready") {
    write("Dry run · no files changed");
  }
}

function writeUpdateHuman(
  summary: ReturnType<typeof updateSummary>,
  write: WriteLine,
): void {
  write(`Topo update · ${summary.projectRoot}`);
  write(
    `${summary.status} · ${String(summary.previousVersion ?? "unknown")} → ${summary.version} (${summary.packageSpec})`,
  );
  for (const changedPath of summary.changedPaths)
    write(`  update · ${changedPath}`);
  for (const conflict of summary.conflicts) write(`  conflict · ${conflict}`);
  if (summary.dryRun && summary.status === "ready") {
    write("Dry run · no files changed");
  } else if (summary.status === "updated") {
    write(`Next: ${summary.installCommand.join(" ")}`);
  }
}

export async function runLifecycleCommand(
  command: LifecycleCommand,
  projectRoot: string,
  args: readonly string[],
  write: WriteLine = console.log,
  currentVersion = "0.1.0",
): Promise<void> {
  const parsed = parseLifecycleArgs(command, args, projectRoot);
  if (command === "migrate") {
    const plan = await planProjectMigration({ projectRoot });
    const result =
      plan.status === "ready" && !parsed.dryRun
        ? await applyProjectMigration(plan)
        : plan.status === "current"
          ? await applyProjectMigration(plan)
          : undefined;
    const summary = migrationSummary(plan, result, parsed.dryRun);
    if (parsed.json) write(JSON.stringify(summary, null, 2));
    else writeMigrationHuman(summary, write);
    if (plan.status === "conflict") {
      throw new Error("Topo migrate has conflicts; no files were changed.");
    }
    return;
  }

  const plan = await planProjectUpdate({
    projectRoot,
    targetVersion: parsed.version ?? currentVersion,
    packageSpec: parsed.packageSpec,
  });
  const result =
    plan.status === "ready" && !parsed.dryRun
      ? await applyProjectUpdate(plan)
      : plan.status === "current"
        ? await applyProjectUpdate(plan)
        : undefined;
  const summary = updateSummary(plan, result, parsed.dryRun);
  if (parsed.json) write(JSON.stringify(summary, null, 2));
  else writeUpdateHuman(summary, write);
  if (plan.status === "conflict") {
    throw new Error("Topo update has conflicts; no files were changed.");
  }
}
