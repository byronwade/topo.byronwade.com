import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

export interface AutomationWorkflowIssue {
  code: "workflow-contract";
  message: string;
  filePath: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function steps(job: unknown): Record<string, unknown>[] {
  const value = record(job).steps;
  return Array.isArray(value) ? value.map(record) : [];
}

function commands(job: unknown): string[] {
  return steps(job)
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string");
}

function hasCommand(values: readonly string[], expected: string) {
  return values.some((value) => value.trim() === expected);
}

function hasPlaywrightChromiumInstall(values: readonly string[]) {
  return values.some((value) =>
    /\bplaywright\s+install(?:\s+--with-deps)?\s+chromium\b/.test(value),
  );
}

function addIssue(
  issues: AutomationWorkflowIssue[],
  filePath: string,
  message: string,
) {
  issues.push({ code: "workflow-contract", message, filePath });
}

async function readWorkflow(
  rootDir: string,
  filePath: string,
  issues: AutomationWorkflowIssue[],
): Promise<Record<string, unknown>> {
  try {
    return record(parse(await readFile(path.join(rootDir, filePath), "utf8")));
  } catch (error) {
    addIssue(
      issues,
      filePath,
      error instanceof Error ? error.message : "Workflow is not valid YAML.",
    );
    return {};
  }
}

/**
 * Validate the automation that backs Topo's verification and distribution
 * claims. The interface ignores YAML formatting and checks executable intent.
 */
export async function validateAutomationWorkflows(
  rootDir: string,
): Promise<AutomationWorkflowIssue[]> {
  const issues: AutomationWorkflowIssue[] = [];
  const ciPath = ".github/workflows/ci.yml";
  const publishPath = ".github/workflows/publish.yml";
  const [ci, publish] = await Promise.all([
    readWorkflow(rootDir, ciPath, issues),
    readWorkflow(rootDir, publishPath, issues),
  ]);

  const ciJobs = record(ci.jobs);
  const verifyJob = record(ciJobs.verify);
  const browserJob = record(ciJobs.browser);
  const verifyCommands = commands(verifyJob);
  for (const required of [
    "pnpm docs:check",
    "pnpm exec turbo run typecheck --concurrency=4",
    "pnpm exec turbo run test --filter=!@topo/browser --concurrency=4",
    "pnpm --filter @topo/browser test",
    "pnpm exec turbo run build --concurrency=4",
    "pnpm --filter @topo/cli pack:check",
    "pnpm benchmark --profile smoke --check",
  ]) {
    if (!hasCommand(verifyCommands, required))
      addIssue(issues, ciPath, `CI verify job must run: ${required}`);
  }
  if (!hasPlaywrightChromiumInstall(verifyCommands))
    addIssue(issues, ciPath, "CI verify job must install Chromium before tests.");

  if (browserJob.needs !== "verify")
    addIssue(issues, ciPath, "CI browser matrix must depend on verify.");
  const matrixValue = record(record(browserJob.strategy).matrix).check;
  const matrixEntries = Array.isArray(matrixValue)
    ? matrixValue.map(record)
    : [];
  const matrixNames = new Set(
    matrixEntries
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string"),
  );
  for (const required of [
    "studio-runtime",
    "studio-boards",
    "studio-profiles",
    "local-runtime",
    "framework-fixtures",
    "storybook",
    "browser-benchmark",
  ]) {
    if (!matrixNames.has(required))
      addIssue(issues, ciPath, `CI browser matrix is missing ${required}.`);
  }
  if (
    matrixEntries.some(
      (entry) =>
        typeof entry.command !== "string" || !entry.command.startsWith("pnpm "),
    )
  )
    addIssue(
      issues,
      ciPath,
      "Every CI browser matrix entry must declare a pnpm command.",
    );
  const browserSteps = steps(browserJob);
  if (!hasPlaywrightChromiumInstall(commands(browserJob)))
    addIssue(issues, ciPath, "CI browser matrix must install Chromium.");
  if (!hasCommand(commands(browserJob), "${{ matrix.check.command }}"))
    addIssue(
      issues,
      ciPath,
      "CI browser matrix must execute its declared command.",
    );
  if (
    !browserSteps.some(
      (step) =>
        step.uses === "actions/upload-artifact@v4" && step.if === "always()",
    )
  )
    addIssue(
      issues,
      ciPath,
      "CI browser evidence must be retained on every run.",
    );

  const releaseTrigger = record(record(publish.on).release);
  if (!strings(releaseTrigger.types).includes("published"))
    addIssue(
      issues,
      publishPath,
      "Publishing must require a published release.",
    );
  const permissions = record(publish.permissions);
  if (permissions.contents !== "read" || permissions["id-token"] !== "write")
    addIssue(
      issues,
      publishPath,
      "Publishing must use read-only contents and OIDC id-token permissions.",
    );
  const publishJob = record(record(publish.jobs).publish);
  if (publishJob["runs-on"] !== "ubuntu-latest")
    addIssue(
      issues,
      publishPath,
      "npm publishing must use a hosted Linux runner.",
    );
  if (publishJob.environment !== "npm")
    addIssue(
      issues,
      publishPath,
      "npm publishing must use the npm environment.",
    );
  const publishCommands = commands(publishJob);
  for (const required of [
    "pnpm install --frozen-lockfile",
    "pnpm docs:check",
    "pnpm exec turbo run typecheck test build --filter=@topo/cli...",
    "pnpm --filter @topo/cli pack:check",
    "npm install --global npm@11",
    'npm publish "$TOPO_PACK_OUTPUT" --access public --provenance',
  ]) {
    if (!hasCommand(publishCommands, required))
      addIssue(issues, publishPath, `Publish workflow must run: ${required}`);
  }
  const serializedPublish = JSON.stringify(publish);
  if (
    !serializedPublish.includes("TOPO_RELEASE_TAG") ||
    !serializedPublish.includes("TOPO_PACK_OUTPUT")
  )
    addIssue(
      issues,
      publishPath,
      "Publish workflow must bind the release tag and verified tarball path.",
    );
  if (
    serializedPublish.includes("NODE_AUTH_TOKEN") ||
    serializedPublish.includes("NPM_TOKEN")
  )
    addIssue(
      issues,
      publishPath,
      "Trusted publishing must not depend on a long-lived npm token.",
    );

  return issues;
}
