#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanProjectCache, inspectProjectCache } from "@topo/cache";
import { runDiagnosticCheck, runDiagnostics } from "@topo/diagnostics";
import {
  resolveProject,
  type TopoConfig,
  type TopoProject,
} from "@topo/config";
import { runDoctor } from "@topo/doctor";
import {
  exportReview,
  exportReviewMarkdown,
  REVIEW_EXPORT_FORMATS,
  REVIEW_EXPORT_INCLUDES,
  type ReviewExportFormat,
  type ReviewExportInclude,
} from "@topo/exporter";
import {
  createFlowStore,
  parseFlowJson,
  type UpdateFlowInput,
} from "@topo/flows";
import { createPreviewGateway } from "@topo/gateway";
import {
  applyInitialization,
  applyUninstall,
  planInitialization,
  planUninstall,
  type TopoInitializationPlan,
  type TopoUninstallPlan,
} from "@topo/initializer";
import {
  LLM_CONTEXT_KINDS,
  exportLlmContext,
  loadLlmContext,
  queryLlmContext,
  readComponentPreviewArtifact,
  readSnapshotArtifact,
  readVisualBaselineArtifact,
  readVisualComparisonArtifact,
  renderLlmQueryMarkdown,
  type LlmContextKind,
} from "@topo/llm-context";
import { startTopoLocalRuntime } from "@topo/local-runtime";
import { runMcpStdio } from "@topo/mcp";
import { createNoteStore } from "@topo/notes";
import { captureGraph } from "@topo/snapshots";
import { createProjectStateStore } from "@topo/storage";
import { findStudioAssets } from "@topo/studio-host";
import { scanWorkspace } from "@topo/workspace";
import { DiagnosticCheckFailOnSchema } from "@topo/protocol";

import { runAdapterCommand } from "./adapter-command.js";
import { runLifecycleCommand } from "./lifecycle-command.js";
import { runNoteCommand } from "./note-command.js";

const PACKAGE_VERSION = "0.1.0";

function workspaceScanOptions(config: TopoConfig, adapterRootDir?: string) {
  return {
    ignore: config.ignore,
    adapterRootDir,
    adapterModules: config.extensions.frameworkAdapters,
    apiEndpointAdapterModules: config.extensions.apiEndpointAdapters,
    flowAdapterModules: config.extensions.flowAdapters,
    componentPreviewAdapterModules: config.extensions.componentPreviewAdapters,
    componentPreviews: config.preview.components,
    previewRoutes: config.preview.routes,
  };
}

async function readProjectName(rootDir: string): Promise<string | undefined> {
  try {
    const value = JSON.parse(
      await readFile(path.join(rootDir, "package.json"), "utf8"),
    ) as { name?: string };
    return value.name;
  } catch {
    return undefined;
  }
}

async function readCurrentGraph(project: TopoProject) {
  const scanned = await scanWorkspace(
    project.sourceRoot,
    workspaceScanOptions(project.config, project.projectRoot),
  );
  scanned.previewBaseUrl = project.config.preview.baseUrl;
  return (await runDiagnostics({ rootDir: project.sourceRoot, graph: scanned }))
    .graph;
}

async function readCurrentContext(project: TopoProject) {
  const graph = await readCurrentGraph(project);
  const [name, doctorReport] = await Promise.all([
    readProjectName(project.projectRoot),
    runDoctor({ project, graph }),
  ]);
  return loadLlmContext(
    project.projectRoot,
    graph,
    {
      name,
      projectRoot: project.projectRoot,
      sourceRoot: project.sourceRoot,
      profileNames: project.config.profiles.map((profile) => profile.name),
      previewRoutes: project.config.preview.routes,
      capture: {
        version: 1,
        autoCapture: project.config.preview.autoCapture,
        headless: project.config.preview.headless,
        viewport: project.config.preview.viewport,
      },
      atlas: project.config.atlas,
      studio: project.config.studio,
      extensions: project.config.extensions,
    },
    { doctorReport },
  );
}

function usage(): void {
  console.log(
    `Topo — unfold your application

Commands:
  init [path]           Plan and apply a reversible local Topo installation
  uninstall [path]      Revert an unchanged Topo installation manifest
  migrate [path]        Apply registered project metadata migrations
  update [path]         Reconcile the project to this CLI package version
  scan [path]           Discover routes and components
  check [path]          Run static or isolated runtime diagnostics as a gate
  doctor [path]         Check local prerequisites and configuration
  dev [path]            Start the native app, loopback daemon, and Studio
  gateway [path]        Start the signed loopback preview gateway
  capture [path]        Capture discovered screens with Playwright
  export [path]         Export Markdown, SARIF, or standalone HTML review
  mcp [path]            Serve read-only LLM context over MCP stdio
  context export [path] Write manifest, schema, Markdown, and JSONL context
  context query [path]  Search bounded LLM context records
  cache inspect [path]  Inspect the derived local cache
  cache clean [path]    Clean only .topo/cache contents
  adapters create [path] Scaffold a local route, preview, or runtime adapter
  adapters check [path] Verify local adapter manifests, identity, and contracts
  flows list [path]     List JSON-backed user flows
  flows add [path]      Add a one-step draft flow
  flows show [path]     Read one complete flow by stable id
  flows apply [path]    Validate and apply a complete flow JSON file
  flows update [path]   Update flow metadata without rewriting its steps
  flows remove [path]   Remove one flow by stable id
  notes list [path]     List Markdown notes
  notes add [path]      Add a Markdown note
  notes show [path]     Read one complete note by stable id
  notes update [path]   Update note content, lifecycle, or target
  notes remove [path]   Remove one note by stable id
  notes export [path]   Export TOPO_REVIEW.md

Options:
  --json               Print structured JSON output
  --app <path>         Select one application inside a monorepo
  --dry-run            Preview init, uninstall, migrate, update, or cache cleanup
  --kind <kind>        Adapter kind: framework, component-preview, or application-runtime
  --id <id>            Select one local adapter for adapters check
  --name <text>        Adapter display name
  --output <path>      Adapter output directory or review export file path
  --no-package         Do not add @topo/cli or the topo package script
  --package-spec <spec> Override the installed @topo/cli package spec
  --version <version>   Override the target version for topo update
  --format <format>     Review export format: markdown, sarif, or html
  --include <records>   Review records: all, findings, or notes
  --snapshots           Include explicit snapshot references in review export
  --query <text>       Search LLM context text
  --kind <kind,...>    Filter LLM context record kinds
  --limit <number>     Limit context records (maximum 100)
  --offset <number>    Pagination offset
  --profile <name>     Preview profile to use for capture
  --runtime            Include isolated interaction probes in topo check
  --fail-on <severity> Fail check on info, low, medium, high, or none
  --title <text>       Note or flow title
  --description <text> Flow description
  --id <id>             Stable flow identity for show, update, or remove
  --file <path>         Complete JSON source for flows apply
  --status <status>     Flow or note lifecycle status
  --entry-step <id>     Set the flow entry step
  --clear-entry         Remove the current flow entry step
  --tags <tag,...>      Replace flow tags with a comma-delimited list
  --body <text>        Note body
  --type <type>        Note type (screen, element, decision, ...)
  --author <text>      Note author
  --route <path>       Attach a note or first flow step to a route
  --target-id <id>     Attach a note to a durable entity
  --target-kind <kind> Entity kind for --target-id
  --clear-target       Remove a note's target kind and id
  --clear-route        Remove a note's route attachment
  --clear-author       Remove a note's author
  --action <text>      First flow-step action
  --expected <text>    First flow-step expected result
  --port <number>      Override the daemon port
  --preview-port <n>   Override the native application preview port
  --studio-port <n>    Preferred Studio port (defaults to 4173)
  --studio-dir <path>  Override the production Studio asset directory
  --no-app             Do not discover, reuse, or start the native application
  --no-studio          Skip the compiled production Studio
  --no-watch           Disable filesystem refreshes
`,
  );
}

function getFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1_024;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function getPathArg(args: string[]): string {
  const valueFlags = new Set([
    "--title",
    "--body",
    "--author",
    "--type",
    "--route",
    "--target-id",
    "--target-kind",
    "--port",
    "--preview-port",
    "--studio-port",
    "--studio-dir",
    "--profile",
    "--query",
    "--kind",
    "--limit",
    "--offset",
    "--description",
    "--action",
    "--expected",
    "--app",
    "--package-spec",
    "--version",
    "--format",
    "--include",
    "--output",
    "--kind",
    "--name",
    "--id",
    "--file",
    "--status",
    "--entry-step",
    "--tags",
    "--fail-on",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) break;
    if (valueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--") && !/^\d+$/.test(arg)) return arg;
  }
  return ".";
}

function getPortFlag(args: string[], flag: string): number | undefined {
  const value = getFlag(args, flag);
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${flag} must be an integer from 0 through 65535.`);
  }
  return port;
}

async function resolveStudioAssets(args: string[]): Promise<string> {
  const cliDirectory = path.dirname(fileURLToPath(import.meta.url));
  return findStudioAssets([
    getFlag(args, "--studio-dir"),
    process.env.TOPO_STUDIO_DIR,
    path.resolve(cliDirectory, "studio"),
    path.resolve(cliDirectory, "..", "studio"),
    path.resolve(cliDirectory, "..", "..", "..", "apps", "studio", "dist"),
    path.resolve(process.cwd(), "apps", "studio", "dist"),
  ]);
}

function printDetection(plan: TopoInitializationPlan): void {
  const selected = plan.detection.selectedApplication;
  console.log(
    `Detected ${plan.detection.packageManager}${plan.detection.monorepo ? " monorepo" : " project"} · ${plan.detection.applications.length} application candidate(s)`,
  );
  for (const application of plan.detection.applications) {
    console.log(
      `${selected?.path === application.path ? "SELECT" : "      "}  ${application.path} · ${application.framework} · Storybook ${application.storybook ? "yes" : "no"} · Playwright ${application.playwright ? "yes" : "no"} · fixtures ${application.fixtures ? "yes" : "no"} · mocks ${application.mocks ? "yes" : "no"}`,
    );
  }
}

function printInitializationPlan(plan: TopoInitializationPlan): void {
  console.log(`Topo init · ${plan.projectRoot}`);
  printDetection(plan);
  for (const operation of plan.operations) {
    console.log(
      `${operation.action.toUpperCase().padEnd(6)}  ${operation.path} · ${operation.description}`,
    );
  }
  for (const conflict of plan.conflicts) console.log(`CONFLICT  ${conflict}`);
}

async function initProject(target: string, args: string[]): Promise<void> {
  const plan = await planInitialization({
    projectRoot: target,
    application: getFlag(args, "--app"),
    packageVersion: PACKAGE_VERSION,
    packageSpec: getFlag(args, "--package-spec"),
    installPackage: !hasFlag(args, "--no-package"),
  });
  if (hasFlag(args, "--json")) console.log(JSON.stringify(plan, null, 2));
  else printInitializationPlan(plan);

  if (plan.status === "selection-required") {
    throw new Error(
      "Multiple applications were detected. Re-run with --app <path>; no files were changed.",
    );
  }
  if (plan.status === "conflict") {
    throw new Error(
      "Topo initialization has conflicts; no files were changed.",
    );
  }
  if (plan.status === "already-installed") {
    if (!hasFlag(args, "--json")) console.log("Topo is already initialized.");
    return;
  }
  if (hasFlag(args, "--dry-run")) return;

  const result = await applyInitialization(plan);
  if (hasFlag(args, "--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Installed ${result.changedPaths.length} path(s).`);
    if (
      plan.operations.some(
        (operation) =>
          operation.kind === "file" &&
          operation.path === "package.json" &&
          operation.action !== "keep",
      )
    ) {
      console.log(`Next: ${result.installCommand.join(" ")}`);
    }
    console.log("Running topo doctor...");
  }
  await doctorProject(target, false);
}

function printUninstallPlan(plan: TopoUninstallPlan): void {
  console.log(`Topo uninstall · ${plan.projectRoot}`);
  for (const change of plan.changes) {
    console.log(`${change.action.toUpperCase().padEnd(7)}  ${change.path}`);
  }
  for (const conflict of plan.conflicts) console.log(`CONFLICT  ${conflict}`);
}

async function uninstallProject(target: string, args: string[]): Promise<void> {
  const plan = await planUninstall(target);
  if (hasFlag(args, "--json")) console.log(JSON.stringify(plan, null, 2));
  else printUninstallPlan(plan);
  if (plan.status === "not-installed") {
    if (!hasFlag(args, "--json")) console.log("Topo is not initialized here.");
    return;
  }
  if (plan.status === "conflict") {
    throw new Error("Topo uninstall has conflicts; no files were changed.");
  }
  if (hasFlag(args, "--dry-run")) return;
  const result = await applyUninstall(plan);
  if (hasFlag(args, "--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(`Uninstalled ${result.changedPaths.length} path(s).`);
}

async function scanProject(target: string, json: boolean): Promise<void> {
  const project = await resolveProject(target);
  const { config } = project;
  const scanned = await scanWorkspace(
    project.sourceRoot,
    workspaceScanOptions(config, project.projectRoot),
  );
  scanned.previewBaseUrl = config.preview.baseUrl;
  const graph = (
    await runDiagnostics({ rootDir: scanned.rootDir, graph: scanned })
  ).graph;

  if (json) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }

  console.log(`Topo scan · ${graph.rootDir}`);
  console.log(`Framework: ${graph.framework}`);
  console.log(`Screens: ${graph.screens.length}`);
  console.log(`Components: ${graph.components.length}`);
  console.log(`Hierarchy edges: ${graph.edges.length}`);
  for (const screen of graph.screens) {
    const previewDetail =
      screen.previewRoute?.status === "configured"
        ? ` -> ${screen.previewRoute.path}`
        : screen.previewRoute?.status === "unresolved"
          ? " [needs preview route]"
          : "";
    console.log(
      `  ${screen.routePath.padEnd(24)} ${screen.state.padEnd(10)} ${screen.source.filePath}${previewDetail}`,
    );
  }
}

async function checkProject(
  target: string,
  args: string[],
  json: boolean,
): Promise<void> {
  const project = await resolveProject(target);
  const { config } = project;
  const scanned = await scanWorkspace(
    project.sourceRoot,
    workspaceScanOptions(config, project.projectRoot),
  );
  scanned.previewBaseUrl = config.preview.baseUrl;
  const runtime = hasFlag(args, "--runtime");
  const profileName = getFlag(args, "--profile");
  const profile = profileName
    ? config.profiles.find((candidate) => candidate.name === profileName)
    : config.profiles[0];
  if (profileName && !profile) {
    throw new Error(`Unknown preview profile: ${profileName}`);
  }
  const failOnValue = getFlag(args, "--fail-on") ?? "low";
  const failOn = DiagnosticCheckFailOnSchema.safeParse(failOnValue);
  if (!failOn.success) {
    throw new Error(
      "--fail-on must be one of: none, info, low, medium, or high.",
    );
  }
  const route = getFlag(args, "--route");
  const report = await runDiagnosticCheck({
    projectRoot: project.projectRoot,
    rootDir: scanned.rootDir,
    graph: scanned,
    runtime,
    ...(runtime && route ? { routes: [route] } : {}),
    ...(runtime ? { baseUrl: config.preview.baseUrl, profile } : {}),
    failOn: failOn.data,
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  console.log(`Topo check · ${project.projectRoot}`);
  console.log(
    `${report.ok ? "PASS" : "FAIL"}  ${report.mode} diagnostics · fail on ${report.policy.failOn}`,
  );
  console.log(`Files scanned: ${report.summary.filesScanned}`);
  console.log(
    `Findings: ${report.summary.findings.total} · ${report.summary.findings.blocking} blocking`,
  );
  if (report.mode === "runtime") {
    console.log(
      `Probes: ${report.summary.probes.total} · ${report.summary.probes.activationErrors} activation error(s)`,
    );
  }
  for (const finding of report.findings) {
    const source = finding.source
      ? `${finding.source.filePath}:${finding.source.line}`
      : "workspace";
    console.log(
      `  ${finding.severity.toUpperCase().padEnd(6)} ${finding.title} · ${source}`,
    );
  }
  for (const probe of report.interactionProbes.filter(
    (candidate) => candidate.status === "activation-error",
  )) {
    console.log(
      `  ERROR  Runtime probe failed · ${probe.routePath} · ${probe.error ?? "Unknown error"}`,
    );
  }
  if (!report.ok) process.exitCode = 1;
}

async function doctorProject(target: string, json: boolean): Promise<void> {
  const project = await resolveProject(target);
  const graph = await readCurrentGraph(project);
  const report = await runDoctor({ project, graph });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  console.log(`Topo doctor · ${project.projectRoot}`);
  console.log(`INFO  Project root: ${project.projectRoot}`);
  console.log(`INFO  Source root: ${project.sourceRoot}`);
  console.log(
    `INFO  ${report.summary.passed} passed · ${report.summary.warnings} warning(s) · ${report.summary.errors} error(s)`,
  );
  for (const check of report.checks) {
    console.log(
      `${check.status.toUpperCase().padEnd(7)} ${check.title}: ${check.detail}`,
    );
    if (check.action) console.log(`        Action: ${check.action}`);
  }

  if (!report.ok) process.exitCode = 1;
}

async function captureProject(
  target: string,
  args: string[],
  json: boolean,
): Promise<void> {
  const project = await resolveProject(target);
  const { config } = project;
  const graph = await scanWorkspace(
    project.sourceRoot,
    workspaceScanOptions(config, project.projectRoot),
  );
  const profileName = getFlag(args, "--profile");
  const profile = profileName
    ? config.profiles.find((candidate) => candidate.name === profileName)
    : config.profiles[0];
  if (profileName && !profile)
    throw new Error(`Unknown preview profile: ${profileName}`);
  const result = await captureGraph({
    rootDir: project.projectRoot,
    graph: { ...graph, previewBaseUrl: config.preview.baseUrl },
    baseUrl: config.preview.baseUrl,
    headless: config.preview.headless,
    executablePath: config.preview.executablePath,
    viewport: config.preview.viewport,
    profile,
  });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Topo capture · ${project.projectRoot}`);
  console.log(
    `Captured: ${result.snapshots.filter((snapshot) => snapshot.status === "captured").length}`,
  );
  console.log(`Blocked: ${result.failures.length}`);
  for (const failure of result.failures)
    console.log(`  ${failure.routePath}: ${failure.error}`);
}

async function runDaemon(target: string, args: string[]): Promise<void> {
  const project = await resolveProject(target);
  const startsStudio = !hasFlag(args, "--no-studio");
  const runtime = await startTopoLocalRuntime({
    project,
    studioAssetsDir: startsStudio ? await resolveStudioAssets(args) : undefined,
    previewPort: getPortFlag(args, "--preview-port"),
    daemonPort: getPortFlag(args, "--port"),
    studioPort: getPortFlag(args, "--studio-port"),
    watch: !hasFlag(args, "--no-watch"),
    startApplication: !hasFlag(args, "--no-app"),
    startStudio: startsStudio,
    onApplicationLog: (entry) =>
      console.log(`[app:${entry.stream}] ${entry.text}`),
  });

  if (runtime.application) {
    console.log(
      `Topo app: ${runtime.application.baseUrl} (${runtime.application.ownership}${runtime.application.ownership === "managed" ? ` · ${runtime.application.adapterId}` : ""})`,
    );
  } else {
    console.log(`Topo app: unmanaged (${runtime.preview.targetBaseUrl})`);
  }
  console.log(`Topo daemon: ${runtime.daemon.url}`);
  if (runtime.preview.mode === "gateway") {
    console.log(
      `Topo preview: ${runtime.preview.profiles.length} isolated profile origin${runtime.preview.profiles.length === 1 ? "" : "s"} (${runtime.preview.profiles.join(", ")})`,
    );
  } else {
    console.log(`Topo preview: direct (${runtime.preview.targetBaseUrl})`);
  }
  if (runtime.studio) console.log(`Topo Studio: ${runtime.studio.url}`);
  console.log(
    runtime.watching
      ? "Watching source files. Press Ctrl+C to stop."
      : "Source watching disabled. Press Ctrl+C to stop.",
  );

  const onSignal = (): void => {
    void runtime.close().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  void runtime.applicationExit?.then((result) => {
    if (result.expected) return;
    const reason =
      result.code === null
        ? `signal ${String(result.signal)}`
        : `exit code ${result.code}`;
    console.error(`Topo app runtime stopped unexpectedly (${reason}).`);
    process.exitCode = result.code && result.code > 0 ? result.code : 1;
    void runtime.close().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  });
}

async function runMcp(target: string): Promise<void> {
  const project = await resolveProject(target);
  const notes = createNoteStore(project.projectRoot);
  await runMcpStdio({
    getContext: () => readCurrentContext(project),
    getSnapshotArtifact: (id) => readSnapshotArtifact(project.projectRoot, id),
    getComponentPreviewArtifact: (id) =>
      readComponentPreviewArtifact(project.projectRoot, id),
    getVisualBaselineArtifact: (id) =>
      readVisualBaselineArtifact(project.projectRoot, id),
    getVisualComparisonArtifact: (id) =>
      readVisualComparisonArtifact(project.projectRoot, id),
    exportReview: async () =>
      exportReviewMarkdown({
        graph: await readCurrentGraph(project),
        notes: await notes.list(),
      }),
  });
}

async function runContext(
  command: string,
  target: string,
  args: string[],
): Promise<void> {
  const project = await resolveProject(target);
  const context = await readCurrentContext(project);

  if (command === "export") {
    const result = await exportLlmContext(project.projectRoot, context);
    if (hasFlag(args, "--json")) {
      console.log(
        JSON.stringify({ ...result, manifest: context.manifest }, null, 2),
      );
      return;
    }
    console.log(
      `Exported ${context.manifest.totalRecords} LLM-readable records to ${result.directory}`,
    );
    console.log(`  Manifest: ${result.manifestPath}`);
    console.log(`  Markdown: ${result.markdownPath}`);
    console.log(`  JSONL: ${result.recordsPath}`);
    return;
  }

  if (command === "query") {
    const requestedKinds = (getFlag(args, "--kind") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const invalidKind = requestedKinds.find(
      (kind) => !LLM_CONTEXT_KINDS.includes(kind as LlmContextKind),
    );
    if (invalidKind) throw new Error(`Unknown context kind: ${invalidKind}`);
    const result = queryLlmContext(context, {
      query: getFlag(args, "--query"),
      kinds: requestedKinds as LlmContextKind[],
      routePath: getFlag(args, "--route"),
      limit: getFlag(args, "--limit")
        ? Number(getFlag(args, "--limit"))
        : undefined,
      offset: getFlag(args, "--offset")
        ? Number(getFlag(args, "--offset"))
        : undefined,
    });
    console.log(
      hasFlag(args, "--json")
        ? JSON.stringify(result, null, 2)
        : renderLlmQueryMarkdown(result),
    );
    return;
  }

  throw new Error(`Unknown context command: ${command}`);
}

async function runCache(
  command: string,
  target: string,
  args: string[],
): Promise<void> {
  const project = await resolveProject(target);
  const json = hasFlag(args, "--json");

  if (command === "inspect") {
    const report = await inspectProjectCache(project.projectRoot);
    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`Topo cache · ${report.projectRoot}`);
    console.log(`Root: ${report.cacheRoot}`);
    console.log(
      `Derived data: ${formatBytes(report.totals.bytes)} · ${report.totals.files} file(s) · ${report.totals.directories} director${report.totals.directories === 1 ? "y" : "ies"} · ${report.totals.symlinks} link(s)`,
    );
    for (const entry of report.entries) {
      console.log(
        `  ${entry.path}  ${entry.kind}  ${formatBytes(entry.totals.bytes)}`,
      );
    }
    return;
  }

  if (command === "clean") {
    const result = await cleanProjectCache(project.projectRoot, {
      dryRun: hasFlag(args, "--dry-run"),
    });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Topo cache · ${result.before.projectRoot}`);
    console.log(
      `${result.dryRun ? "Would remove" : "Removed"} ${formatBytes(result.removed.bytes)} · ${result.removed.files} file(s) · ${result.removed.directories} director${result.removed.directories === 1 ? "y" : "ies"} · ${result.removed.symlinks} link(s)`,
    );
    console.log(
      result.dryRun
        ? "Dry run only. No files were removed."
        : `Derived cache is now empty at ${result.after.cacheRoot}.`,
    );
    return;
  }

  throw new Error(`Unknown cache command: ${command}`);
}

async function runFlows(
  command: string,
  target: string,
  args: string[],
): Promise<void> {
  const project = await resolveProject(target);
  const store = createFlowStore(project.projectRoot);

  if (command === "list") {
    const inspection = await store.inspect();
    if (hasFlag(args, "--json")) {
      console.log(JSON.stringify(inspection, null, 2));
      return;
    }
    console.log(`Topo flows · ${project.projectRoot}`);
    if (inspection.flows.length === 0) console.log("No flows yet.");
    for (const flow of inspection.flows) {
      console.log(
        `  ${flow.id}  ${flow.title}  ${flow.status}  ${flow.steps.length} step(s)`,
      );
    }
    for (const issue of inspection.issues)
      console.log(`WARN  ${issue.filePath}: ${issue.message}`);
    return;
  }

  if (command === "add") {
    const title = getFlag(args, "--title");
    if (!title) throw new Error("flows add requires --title <text>");
    const routePath = getFlag(args, "--route");
    const action = getFlag(args, "--action");
    const expected = getFlag(args, "--expected");
    const hasStep = Boolean(routePath || action || expected);
    const flow = await store.write({
      title,
      description: getFlag(args, "--description") ?? "",
      entryStepId: hasStep ? "start" : undefined,
      steps: hasStep
        ? [
            {
              id: "start",
              title: action ?? `Open ${routePath ?? "the starting screen"}`,
              routePath,
              action,
              expected,
              noteIds: [],
              nextStepIds: [],
            },
          ]
        : [],
    });
    await exportLlmContext(
      project.projectRoot,
      await readCurrentContext(project),
    );
    if (hasFlag(args, "--json")) {
      console.log(JSON.stringify(flow, null, 2));
      return;
    }
    console.log(`Created flow ${flow.id}: ${flow.title}`);
    return;
  }

  if (command === "show") {
    const id = getFlag(args, "--id");
    if (!id) throw new Error("flows show requires --id <id>");
    const flow = await store.get(id);
    if (!flow) throw new Error(`Flow not found: ${id}`);
    console.log(JSON.stringify(flow, null, 2));
    return;
  }

  if (command === "apply") {
    const file = getFlag(args, "--file");
    if (!file) throw new Error("flows apply requires --file <path>");
    const sourcePath = path.resolve(process.cwd(), file);
    const source = parseFlowJson(await readFile(sourcePath, "utf8"));
    const flow = await store.write({
      id: source.id,
      title: source.title,
      description: source.description,
      status: source.status,
      entryStepId: source.entryStepId,
      tags: source.tags,
      steps: source.steps,
    });
    await exportLlmContext(
      project.projectRoot,
      await readCurrentContext(project),
    );
    if (hasFlag(args, "--json")) {
      console.log(JSON.stringify(flow, null, 2));
      return;
    }
    console.log(`Applied flow ${flow.id}: ${flow.steps.length} step(s)`);
    return;
  }

  if (command === "update") {
    const id = getFlag(args, "--id");
    if (!id) throw new Error("flows update requires --id <id>");
    const input: UpdateFlowInput = {};
    const title = getFlag(args, "--title");
    const description = getFlag(args, "--description");
    const status = getFlag(args, "--status");
    const entryStepId = getFlag(args, "--entry-step");
    const tags = getFlag(args, "--tags");
    if (title !== undefined) input.title = title;
    if (description !== undefined) input.description = description;
    if (status !== undefined) {
      if (!["draft", "verified", "deprecated"].includes(status)) {
        throw new Error("--status must be one of: draft, verified, deprecated");
      }
      input.status = status as UpdateFlowInput["status"];
    }
    if (entryStepId !== undefined) input.entryStepId = entryStepId;
    if (hasFlag(args, "--clear-entry")) input.entryStepId = null;
    if (tags !== undefined) {
      input.tags = tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    const flow = await store.update(id, input);
    if (!flow) throw new Error(`Flow not found: ${id}`);
    await exportLlmContext(
      project.projectRoot,
      await readCurrentContext(project),
    );
    if (hasFlag(args, "--json")) {
      console.log(JSON.stringify(flow, null, 2));
      return;
    }
    console.log(`Updated flow ${flow.id}: ${flow.title}`);
    return;
  }

  if (command === "remove") {
    const id = getFlag(args, "--id");
    if (!id) throw new Error("flows remove requires --id <id>");
    const removed = await store.remove(id);
    if (!removed) throw new Error(`Flow not found: ${id}`);
    await exportLlmContext(
      project.projectRoot,
      await readCurrentContext(project),
    );
    if (hasFlag(args, "--json")) {
      console.log(JSON.stringify({ id, removed: true }, null, 2));
      return;
    }
    console.log(`Removed flow ${id}`);
    return;
  }

  throw new Error(`Unknown flows command: ${command}`);
}

async function runGateway(target: string, args: string[]): Promise<void> {
  const project = await resolveProject(target);
  const { config } = project;
  const profileName = getFlag(args, "--profile");
  const profile = profileName
    ? config.profiles.find((candidate) => candidate.name === profileName)
    : config.profiles[0];
  if (!profile) throw new Error(`Unknown preview profile: ${profileName}`);
  const portValue = getPortFlag(args, "--port");
  const gateway = createPreviewGateway({
    targetBaseUrl: config.preview.baseUrl,
    host: config.daemon.host,
    port: portValue ?? 4600,
    profiles: [profile],
  });
  const [session] = await gateway.listen();
  if (!session) throw new Error("Preview gateway did not create a session");
  console.log(
    `Topo preview gateway listening at ${session.baseUrl} for ${session.profileName}`,
  );
  console.log(`Open with a signed session: ${session.launchUrl}`);
  const close = async (): Promise<void> => {
    await gateway.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

async function exportProject(
  target: string,
  args: string[],
  defaults: { format?: ReviewExportFormat } = {},
): Promise<void> {
  const requestedFormat =
    getFlag(args, "--format") ?? defaults.format ?? "markdown";
  const requestedInclude = getFlag(args, "--include") ?? "all";
  if (!REVIEW_EXPORT_FORMATS.includes(requestedFormat as ReviewExportFormat)) {
    throw new Error(
      `--format must be one of: ${REVIEW_EXPORT_FORMATS.join(", ")}`,
    );
  }
  if (
    !REVIEW_EXPORT_INCLUDES.includes(requestedInclude as ReviewExportInclude)
  ) {
    throw new Error(
      `--include must be one of: ${REVIEW_EXPORT_INCLUDES.join(", ")}`,
    );
  }

  const project = await resolveProject(target);
  const [graph, notes, state] = await Promise.all([
    readCurrentGraph(project),
    createNoteStore(project.projectRoot).list(),
    createProjectStateStore(project.projectRoot).read(),
  ]);
  const artifact = exportReview(
    { graph, notes, snapshots: state.snapshots },
    {
      format: requestedFormat as ReviewExportFormat,
      include: requestedInclude as ReviewExportInclude,
      attachSnapshots: hasFlag(args, "--snapshots"),
    },
  );
  const requestedOutput = getFlag(args, "--output");
  const outputPath = requestedOutput
    ? path.resolve(process.cwd(), requestedOutput)
    : path.join(project.projectRoot, artifact.fileName);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, artifact.body, "utf8");

  if (hasFlag(args, "--json")) {
    console.log(
      JSON.stringify(
        {
          format: artifact.format,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          outputPath,
          bytes: Buffer.byteLength(artifact.body),
          includes: requestedInclude,
          snapshotReferences: hasFlag(args, "--snapshots")
            ? state.snapshots.length
            : 0,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `Exported ${artifact.format} review to ${path.relative(process.cwd(), outputPath) || artifact.fileName}`,
  );
}

async function runNotes(
  command: string,
  target: string,
  args: string[],
): Promise<void> {
  if (command === "export") {
    await exportProject(target, args, { format: "markdown" });
    return;
  }

  const project = await resolveProject(target);
  const store = createNoteStore(project.projectRoot);
  await runNoteCommand(command, args, {
    projectRoot: project.projectRoot,
    store,
    syncContext: async () => {
      await exportLlmContext(
        project.projectRoot,
        await readCurrentContext(project),
      );
    },
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  const [command = "help", ...rawArgs] = argv;
  const hasNestedCommand =
    command === "notes" ||
    command === "flows" ||
    command === "context" ||
    command === "cache" ||
    command === "adapters" ||
    command === "adapter";
  const nestedCommand = hasNestedCommand ? (rawArgs[0] ?? "list") : undefined;
  const args = hasNestedCommand ? rawArgs.slice(1) : rawArgs;
  const target = getPathArg(args);

  switch (command) {
    case "init":
      await initProject(target, args);
      break;
    case "uninstall":
      await uninstallProject(target, args);
      break;
    case "migrate":
      await runLifecycleCommand(
        "migrate",
        target,
        args,
        console.log,
        PACKAGE_VERSION,
      );
      break;
    case "update":
      await runLifecycleCommand(
        "update",
        target,
        args,
        console.log,
        PACKAGE_VERSION,
      );
      break;
    case "scan":
      await scanProject(target, hasFlag(args, "--json"));
      break;
    case "check":
      await checkProject(target, args, hasFlag(args, "--json"));
      break;
    case "doctor":
      await doctorProject(target, hasFlag(args, "--json"));
      break;
    case "capture":
      await captureProject(target, args, hasFlag(args, "--json"));
      break;
    case "export":
      await exportProject(target, args);
      break;
    case "dev":
      await runDaemon(target, args);
      break;
    case "gateway":
      await runGateway(target, args);
      break;
    case "mcp":
      await runMcp(target);
      break;
    case "context":
      await runContext(nestedCommand ?? "query", target, args);
      break;
    case "cache":
      await runCache(nestedCommand ?? "inspect", target, args);
      break;
    case "adapters":
    case "adapter":
      await runAdapterCommand(nestedCommand ?? "create", target, args);
      break;
    case "flows":
      await runFlows(nestedCommand ?? "list", target, args);
      break;
    case "notes":
      await runNotes(nestedCommand ?? "list", target, args);
      break;
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
