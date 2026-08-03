import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { validateCliReleaseContract } from "./release-contract.mjs";
import {
  assertPackedStudioBuildReport,
  summarizePackedStudioBuildReport,
} from "./studio-build-contract.mjs";

const executeFile = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "topo-pack-check-"));

try {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error("pnpm did not expose npm_execpath");
  const pack = await executeFile(
    process.execPath,
    [pnpmCli, "pack", "--pack-destination", temporaryRoot],
    { cwd: packageRoot },
  );
  const tarballLine = pack.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(".tgz"));
  if (!tarballLine) throw new Error("pnpm pack did not report a tarball path");
  const tarballPath = path.isAbsolute(tarballLine)
    ? tarballLine
    : path.join(packageRoot, tarballLine);
  const manifestOutput = await executeFile(
    "tar",
    ["-xOf", tarballPath, "package/package.json"],
    { cwd: packageRoot },
  );
  const manifest = JSON.parse(manifestOutput.stdout);
  const packedFiles = await executeFile("tar", ["-tf", tarballPath], {
    cwd: packageRoot,
  });
  const files = new Set(
    packedFiles.stdout.split(/\r?\n/).map((line) => line.trim()),
  );
  const internalDependencies = Object.keys(manifest.dependencies ?? {}).filter(
    (name) => name.startsWith("@topo/"),
  );
  const required = [
    "package/dist/index.js",
    "package/dist/cli.js",
    "package/dist/index.d.ts",
    "package/dist/studio/index.html",
    "package/dist/studio/studio-build-report.json",
    "package/dist/LICENSE",
    "package/dist/build.json",
    "package/README.md",
  ];
  const missing = required.filter((file) => !files.has(file));
  const forbidden = [...files]
    .filter((file) => /\.(?:test|spec)\.d\.ts(?:\.map)?$/.test(file))
    .sort();
  if (
    internalDependencies.length > 0 ||
    missing.length > 0 ||
    forbidden.length > 0 ||
    manifest.private
  ) {
    throw new Error(
      `Packed CLI contract failed: ${JSON.stringify({ internalDependencies, missing, forbidden, private: manifest.private })}`,
    );
  }
  const buildManifest = JSON.parse(
    await readFile(path.join(packageRoot, "dist", "build.json"), "utf8"),
  );
  const studioBuildReport = JSON.parse(
    await readFile(
      path.join(packageRoot, "dist", "studio", "studio-build-report.json"),
      "utf8",
    ),
  );
  const releaseContract = validateCliReleaseContract({
    manifest,
    buildManifest,
    releaseTag: process.env.TOPO_RELEASE_TAG,
  });
  assertPackedStudioBuildReport(studioBuildReport);
  const fixtureRoot = path.join(temporaryRoot, "fixture");
  await mkdir(fixtureRoot);
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify({ name: "topo-packed-cli-proof", private: true }, null, 2)}\n`,
    "utf8",
  );
  await executeFile(
    process.execPath,
    [
      pnpmCli,
      "add",
      "--ignore-workspace",
      "--save-dev",
      tarballPath,
    ],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const installedEntry = path.join(
    fixtureRoot,
    "node_modules",
    "@topo",
    "cli",
    "dist",
    "index.js",
  );
  const help = await executeFile(process.execPath, [installedEntry, "--help"], {
    cwd: fixtureRoot,
  });
  if (
    !help.stdout.includes("init [path]") ||
    !help.stdout.includes("dev [path]") ||
    !help.stdout.includes("adapters create [path]") ||
    !help.stdout.includes("adapters check [path]") ||
    !help.stdout.includes("migrate [path]") ||
    !help.stdout.includes("update [path]") ||
    !help.stdout.includes("notes show [path]") ||
    !help.stdout.includes("notes update [path]") ||
    !help.stdout.includes("notes remove [path]")
  ) {
    throw new Error("Installed CLI help is missing the expected commands");
  }
  const adapterDryRunOutput = await executeFile(
    process.execPath,
    [
      installedEntry,
      "adapters",
      "create",
      fixtureRoot,
      "--kind",
      "framework",
      "--id",
      "acme.routes",
      "--name",
      "Acme routes",
      "--dry-run",
      "--json",
    ],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const adapterDryRun = JSON.parse(adapterDryRunOutput.stdout);
  if (
    adapterDryRun.status !== "ready" ||
    adapterDryRun.dryRun !== true ||
    adapterDryRun.operations?.length !== 4
  ) {
    throw new Error(
      `Installed CLI adapter dry-run proof failed: ${JSON.stringify(adapterDryRun)}`,
    );
  }
  const init = await executeFile(
    process.execPath,
    [
      installedEntry,
      "init",
      fixtureRoot,
      "--dry-run",
      "--no-package",
      "--json",
    ],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const initializationPlan = JSON.parse(init.stdout);
  if (
    initializationPlan.status !== "ready" ||
    initializationPlan.operations.length === 0
  ) {
    throw new Error(
      `Installed CLI initializer proof failed: ${JSON.stringify(initializationPlan)}`,
    );
  }
  const dryRunArtifacts = ["topo.config.ts", ".topo/install.json"];
  for (const artifact of dryRunArtifacts) {
    try {
      await readFile(path.join(fixtureRoot, artifact), "utf8");
      throw new Error(`Dry-run unexpectedly wrote ${artifact}`);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
  const fixtureManifest = JSON.parse(
    await readFile(path.join(fixtureRoot, "package.json"), "utf8"),
  );
  fixtureManifest.dependencies = { next: "16.2.12" };
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify(fixtureManifest, null, 2)}\n`,
    "utf8",
  );
  await mkdir(path.join(fixtureRoot, "app"));
  await writeFile(
    path.join(fixtureRoot, "app", "page.tsx"),
    "export default function Page() { return <main>Topo proof</main>; }\n",
    "utf8",
  );
  await executeFile(
    process.execPath,
    [installedEntry, "init", fixtureRoot, "--no-package"],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const installedManifest = JSON.parse(
    await readFile(path.join(fixtureRoot, ".topo", "install.json"), "utf8"),
  );
  if (
    installedManifest.schemaVersion !== 3 ||
    installedManifest.packageSpec !== "^0.1.0" ||
    installedManifest.detection.selectedApplication.framework !== "next"
  ) {
    throw new Error(
      `Installed CLI apply proof failed: ${JSON.stringify(installedManifest)}`,
    );
  }
  const passingCheckOutput = await executeFile(
    process.execPath,
    [installedEntry, "check", fixtureRoot, "--json"],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const passingCheck = JSON.parse(passingCheckOutput.stdout);
  if (
    passingCheck.schemaVersion !== 1 ||
    passingCheck.mode !== "static" ||
    passingCheck.policy?.failOn !== "low" ||
    passingCheck.ok !== true ||
    "graph" in passingCheck
  ) {
    throw new Error(
      `Installed CLI passing check proof failed: ${JSON.stringify(passingCheck)}`,
    );
  }
  const fixturePagePath = path.join(fixtureRoot, "app", "page.tsx");
  const fixturePage = await readFile(fixturePagePath, "utf8");
  await writeFile(
    fixturePagePath,
    "export default function Page() { return <button>Possibly inert</button>; }\n",
    "utf8",
  );
  let failedCheckError;
  try {
    await executeFile(
      process.execPath,
      [installedEntry, "check", fixtureRoot, "--json"],
      { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (error) {
    failedCheckError = error;
  }
  if (!failedCheckError || typeof failedCheckError.stdout !== "string") {
    throw new Error(
      "Installed CLI did not fail on a low-severity open finding",
    );
  }
  const failedCheck = JSON.parse(failedCheckError.stdout);
  if (
    failedCheckError.code !== 1 ||
    failedCheck.ok !== false ||
    failedCheck.summary?.findings?.blocking !== 1
  ) {
    throw new Error(
      `Installed CLI failing check proof failed: ${JSON.stringify(failedCheck)}`,
    );
  }
  await writeFile(fixturePagePath, fixturePage, "utf8");
  const migrationProof = JSON.parse(
    (
      await executeFile(
        process.execPath,
        [installedEntry, "migrate", fixtureRoot, "--json"],
        { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout,
  );
  if (
    migrationProof.status !== "current" ||
    migrationProof.fromVersion !== 3 ||
    migrationProof.toVersion !== 3
  ) {
    throw new Error(
      `Installed CLI migration proof failed: ${JSON.stringify(migrationProof)}`,
    );
  }
  const addedNote = JSON.parse(
    (
      await executeFile(
        process.execPath,
        [
          installedEntry,
          "notes",
          "add",
          fixtureRoot,
          "--id",
          "note:packed-cli",
          "--title",
          "Review the packed CLI",
          "--body",
          "Keep note operations available to local agents.",
          "--type",
          "decision",
          "--route",
          "/",
          "--author",
          "Packed consumer",
          "--json",
        ],
        { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout,
  );
  if (
    addedNote.id !== "note:packed-cli" ||
    addedNote.targetRoute !== "/" ||
    addedNote.author !== "Packed consumer"
  ) {
    throw new Error(
      `Installed CLI note add proof failed: ${JSON.stringify(addedNote)}`,
    );
  }
  const projectedNotes = JSON.parse(
    (
      await executeFile(
        process.execPath,
        [
          installedEntry,
          "context",
          "query",
          fixtureRoot,
          "--kind",
          "note",
          "--query",
          "packed CLI",
          "--json",
        ],
        { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout,
  );
  if (
    projectedNotes.total !== 1 ||
    projectedNotes.items?.[0]?.id !== "note:packed-cli"
  ) {
    throw new Error(
      `Installed CLI note context proof failed: ${JSON.stringify(projectedNotes)}`,
    );
  }
  const updatedNote = JSON.parse(
    (
      await executeFile(
        process.execPath,
        [
          installedEntry,
          "notes",
          "update",
          fixtureRoot,
          "--id",
          "note:packed-cli",
          "--title",
          "Packed CLI verified",
          "--status",
          "resolved",
          "--clear-route",
          "--clear-author",
          "--json",
        ],
        { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout,
  );
  const shownNote = JSON.parse(
    (
      await executeFile(
        process.execPath,
        [
          installedEntry,
          "notes",
          "show",
          fixtureRoot,
          "--id",
          "note:packed-cli",
          "--json",
        ],
        { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout,
  );
  if (
    updatedNote.status !== "resolved" ||
    updatedNote.targetRoute !== undefined ||
    updatedNote.author !== undefined ||
    shownNote.title !== "Packed CLI verified"
  ) {
    throw new Error(
      `Installed CLI note update/show proof failed: ${JSON.stringify({ updatedNote, shownNote })}`,
    );
  }
  const removedNote = JSON.parse(
    (
      await executeFile(
        process.execPath,
        [
          installedEntry,
          "notes",
          "remove",
          fixtureRoot,
          "--id",
          "note:packed-cli",
          "--json",
        ],
        { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout,
  );
  const remainingNotes = JSON.parse(
    (
      await executeFile(
        process.execPath,
        [
          installedEntry,
          "context",
          "query",
          fixtureRoot,
          "--kind",
          "note",
          "--json",
        ],
        { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout,
  );
  if (removedNote.removed !== true || remainingNotes.total !== 0) {
    throw new Error(
      `Installed CLI note remove/context proof failed: ${JSON.stringify({ removedNote, remainingNotes })}`,
    );
  }
  const installedConfigPath = path.join(fixtureRoot, "topo.config.ts");
  await executeFile(
    process.execPath,
    [
      installedEntry,
      "adapters",
      "create",
      fixtureRoot,
      "--kind",
      "framework",
      "--id",
      "acme.routes",
      "--name",
      "Acme routes",
    ],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  await executeFile(
    process.execPath,
    [
      "--test",
      path.join(
        fixtureRoot,
        "topo",
        "adapters",
        "acme-routes",
        "index.test.mjs",
      ),
    ],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const adapterConformance = JSON.parse(
    (
      await executeFile(
        process.execPath,
        [
          installedEntry,
          "adapters",
          "check",
          fixtureRoot,
          "--id",
          "acme.routes",
          "--json",
        ],
        { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout,
  );
  if (
    adapterConformance.schemaVersion !== 1 ||
    adapterConformance.status !== "pass" ||
    adapterConformance.summary?.checked !== 1 ||
    adapterConformance.adapters?.[0]?.checks?.length !== 4
  ) {
    throw new Error(
      `Installed CLI adapter conformance proof failed: ${JSON.stringify(adapterConformance)}`,
    );
  }
  const installedConfig = await readFile(installedConfigPath, "utf8");
  const customizedConfig = installedConfig
    .replace(
      "    frameworkAdapters: [],",
      '    frameworkAdapters: ["./topo/adapters/acme-routes/index.mjs"],',
    )
    .replace(
      "  profiles:",
      `  studio: {
    defaultDestination: "reviews",
    remove: { destinations: ["editor"], commands: ["capture"] },
    destinations: {
      atlas: { label: "Map" },
      reviews: { url: "http://127.0.0.1:4400/reviews" },
    },
    commands: {
      doctor: { label: "Run checks" },
      openReviews: { to: "reviews", view: "assigned" },
    },
  },
  profiles:`,
    );
  if (customizedConfig === installedConfig) {
    throw new Error("Installed CLI fixture could not add Studio customization");
  }
  await writeFile(installedConfigPath, customizedConfig, "utf8");
  const contextOutput = await executeFile(
    process.execPath,
    [
      installedEntry,
      "context",
      "query",
      fixtureRoot,
      "--kind",
      "project",
      "--json",
    ],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const projectContext = JSON.parse(contextOutput.stdout).items?.[0];
  if (
    projectContext?.data?.studio?.defaultDestination !== "reviews" ||
    projectContext.data.studio.destinations?.atlas?.label !== "Map" ||
    projectContext.data.studio.destinations?.reviews?.url !==
      "http://127.0.0.1:4400/reviews" ||
    projectContext.data.studio.commands?.doctor?.label !== "Run checks" ||
    projectContext.data.studio.commands?.openReviews?.to !== "reviews"
  ) {
    throw new Error(
      `Installed CLI Studio context proof failed: ${JSON.stringify(projectContext)}`,
    );
  }
  const adapterContextOutput = await executeFile(
    process.execPath,
    [
      installedEntry,
      "context",
      "query",
      fixtureRoot,
      "--kind",
      "adapter",
      "--json",
    ],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const adapterContext = JSON.parse(adapterContextOutput.stdout);
  const localAdapter = adapterContext.items?.find(
    (item) => item.id === "adapter:acme.routes",
  );
  if (
    adapterContext.total < 1 ||
    localAdapter?.source?.filePath !== "topo/adapters/acme-routes/adapter.json"
  ) {
    throw new Error(
      `Installed CLI adapter context proof failed: ${JSON.stringify(adapterContext)}`,
    );
  }
  await writeFile(installedConfigPath, installedConfig, "utf8");
  const doctorOutput = await executeFile(
    process.execPath,
    [installedEntry, "doctor", fixtureRoot, "--json"],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const doctorReport = JSON.parse(doctorOutput.stdout);
  if (
    doctorReport.schemaVersion !== 1 ||
    doctorReport.checks?.length !== 10 ||
    !doctorReport.checks.some(
      (check) => check.id === "application.source-selection",
    ) ||
    !doctorReport.checks.some(
      (check) => check.id === "application.preview-routes",
    ) ||
    !doctorReport.checks.every(
      (check) => check.id && check.status && check.evidence,
    )
  ) {
    throw new Error(
      `Installed CLI Doctor proof failed: ${JSON.stringify(doctorReport)}`,
    );
  }
  const reviewPath = path.join(fixtureRoot, "artifacts", "review.html");
  await executeFile(
    process.execPath,
    [
      installedEntry,
      "export",
      fixtureRoot,
      "--format",
      "html",
      "--include",
      "all",
      "--snapshots",
      "--output",
      reviewPath,
    ],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const review = await readFile(reviewPath, "utf8");
  if (
    !review.startsWith("<!doctype html>") ||
    !review.includes("Topo review")
  ) {
    throw new Error("Installed CLI review export proof failed");
  }
  await executeFile(
    process.execPath,
    [installedEntry, "uninstall", fixtureRoot],
    { cwd: fixtureRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  for (const artifact of [
    "topo.config.ts",
    ".topo/install.json",
    ".gitignore",
  ]) {
    try {
      await access(path.join(fixtureRoot, artifact));
      throw new Error(`Packed CLI uninstall left ${artifact}`);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
  const requestedTarballPath = process.env.TOPO_PACK_OUTPUT?.trim();
  const verifiedTarballPath = requestedTarballPath
    ? path.resolve(packageRoot, requestedTarballPath)
    : tarballPath;
  if (requestedTarballPath) {
    await mkdir(path.dirname(verifiedTarballPath), { recursive: true });
    await copyFile(tarballPath, verifiedTarballPath, constants.COPYFILE_EXCL);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        tarballPath: verifiedTarballPath,
        packedFiles: files.size,
        releaseContract,
        runtimeDependencies: Object.keys(manifest.dependencies ?? {}).sort(),
        build: buildManifest,
        studioBuild: summarizePackedStudioBuildReport(studioBuildReport),
        installedCli: {
          help: true,
          initializerDryRun: initializationPlan.status,
          plannedOperations: initializationPlan.operations.length,
          wroteProjectFiles: false,
          appliedManifestSchema: installedManifest.schemaVersion,
          migrationStatus: migrationProof.status,
          detectedFramework:
            installedManifest.detection.selectedApplication.framework,
          diagnosticCheck: {
            schemaVersion: passingCheck.schemaVersion,
            defaultThreshold: passingCheck.policy.failOn,
            passingExit: 0,
            failingExit: failedCheckError.code,
            blockingFindings: failedCheck.summary.findings.blocking,
            graphOmitted: !("graph" in passingCheck),
          },
          noteCrud: {
            add: addedNote.id,
            projected: projectedNotes.total,
            update: updatedNote.status,
            show: shownNote.id,
            remove: removedNote.removed,
            remainingContextRecords: remainingNotes.total,
          },
          studioCustomizationContext: true,
          adapterScaffold: {
            dryRunOperations: adapterDryRun.operations.length,
            generatedTest: true,
            registryLoad: true,
            conformanceChecks: adapterConformance.adapters[0].checks.length,
            contextRecords: adapterContext.total,
          },
          doctorChecks: doctorReport.checks.length,
          htmlReviewExport: true,
          uninstallRestoredProject: true,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
