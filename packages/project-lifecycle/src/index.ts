import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  TOPO_INSTALL_MANIFEST_VERSION,
  type TopoInstallManifest,
  type TopoInstalledFile,
  type TopoPackageManager,
} from "@topo/initializer";

export const TOPO_LIFECYCLE_PLAN_VERSION = 1 as const;

const INSTALL_MANIFEST_PATH = ".topo/install.json";
const PACKAGE_MANIFEST_PATH = "package.json";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type LifecycleStatus = "ready" | "current" | "conflict";

interface InstallManifestV2 {
  readonly schemaVersion: 2;
  readonly installedAt: string;
  readonly topoVersion: string;
  readonly packageName: string;
  readonly packageManager: TopoPackageManager;
  readonly sourceRoot: string;
  readonly detection: TopoInstallManifest["detection"];
  readonly files: readonly TopoInstalledFile[];
  readonly createdDirectories: readonly string[];
}

interface PackageManifest {
  readonly name?: string;
  readonly packageManager?: string;
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly [key: string]: unknown;
}

export interface ProjectMigrationStep {
  readonly id: string;
  readonly sourceVersion: number;
  readonly targetVersion: number;
  readonly summary: string;
}

export interface ProjectMigrationPlan {
  readonly schemaVersion: typeof TOPO_LIFECYCLE_PLAN_VERSION;
  readonly kind: "project-migration";
  readonly status: LifecycleStatus;
  readonly projectRoot: string;
  readonly manifestPath: string;
  readonly generatedAt: string;
  readonly fromVersion?: number;
  readonly toVersion: typeof TOPO_INSTALL_MANIFEST_VERSION;
  readonly steps: readonly ProjectMigrationStep[];
  readonly changedPaths: readonly string[];
  readonly conflicts: readonly string[];
  readonly beforeManifestHash?: string;
  readonly beforePackageHash?: string;
  readonly afterManifestContent?: string;
}

export interface ProjectMigrationResult {
  readonly schemaVersion: typeof TOPO_LIFECYCLE_PLAN_VERSION;
  readonly kind: "project-migration";
  readonly status: "migrated" | "current";
  readonly projectRoot: string;
  readonly fromVersion: number;
  readonly toVersion: typeof TOPO_INSTALL_MANIFEST_VERSION;
  readonly changedPaths: readonly string[];
}

export interface PlanProjectMigrationOptions {
  readonly projectRoot: string;
  readonly now?: string;
}

export interface ProjectUpdatePlan {
  readonly schemaVersion: typeof TOPO_LIFECYCLE_PLAN_VERSION;
  readonly kind: "project-update";
  readonly status: LifecycleStatus;
  readonly projectRoot: string;
  readonly generatedAt: string;
  readonly currentVersion?: string;
  readonly targetVersion: string;
  readonly packageName?: string;
  readonly packageSpec: string;
  readonly installCommand: readonly string[];
  readonly changedPaths: readonly string[];
  readonly conflicts: readonly string[];
  readonly beforePackageHash?: string;
  readonly beforeManifestHash?: string;
  readonly beforePackageContent?: string;
  readonly afterPackageContent?: string;
  readonly afterManifestContent?: string;
}

export interface ProjectUpdateResult {
  readonly schemaVersion: typeof TOPO_LIFECYCLE_PLAN_VERSION;
  readonly kind: "project-update";
  readonly status: "updated" | "current";
  readonly projectRoot: string;
  readonly previousVersion: string;
  readonly version: string;
  readonly packageSpec: string;
  readonly changedPaths: readonly string[];
  readonly installCommand: readonly string[];
}

export interface PlanProjectUpdateOptions {
  readonly projectRoot: string;
  readonly targetVersion: string;
  readonly packageSpec?: string;
  readonly now?: string;
}

export class TopoProjectLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopoProjectLifecycleError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseJsonRecord(
  content: string,
  label: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new TopoProjectLifecycleError(`${label} is not valid JSON.`);
  }
  if (!isRecord(parsed)) {
    throw new TopoProjectLifecycleError(`${label} must contain a JSON object.`);
  }
  return parsed;
}

function installCommand(
  packageManager: TopoPackageManager | undefined,
): readonly string[] {
  return packageManager === "yarn"
    ? ["yarn", "install"]
    : packageManager === "bun"
      ? ["bun", "install"]
      : packageManager === "pnpm"
        ? ["pnpm", "install"]
        : ["npm", "install"];
}

function normalizeProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

async function readRequired(
  absolutePath: string,
  label: string,
): Promise<string> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TopoProjectLifecycleError(`${label} does not exist.`);
    }
    throw error;
  }
}

function manifestVersion(value: Record<string, unknown>): number | undefined {
  return typeof value.schemaVersion === "number" &&
    Number.isInteger(value.schemaVersion)
    ? value.schemaVersion
    : undefined;
}

function validPackageManager(value: unknown): value is TopoPackageManager {
  return (
    value === "pnpm" || value === "npm" || value === "yarn" || value === "bun"
  );
}

function validateInstallManifestBase(
  value: Record<string, unknown>,
  expectedVersion: 2 | typeof TOPO_INSTALL_MANIFEST_VERSION,
): string[] {
  const conflicts: string[] = [];
  if (value.schemaVersion !== expectedVersion) {
    conflicts.push(`Expected install manifest version ${expectedVersion}.`);
  }
  for (const field of [
    "installedAt",
    "topoVersion",
    "packageName",
    "sourceRoot",
  ] as const) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      conflicts.push(
        `Install manifest field ${field} must be a non-empty string.`,
      );
    }
  }
  if (!validPackageManager(value.packageManager)) {
    conflicts.push("Install manifest packageManager is unsupported.");
  }
  if (!isRecord(value.detection)) {
    conflicts.push("Install manifest detection evidence is missing.");
  }
  if (!Array.isArray(value.files)) {
    conflicts.push("Install manifest files must be an array.");
  }
  if (!Array.isArray(value.createdDirectories)) {
    conflicts.push("Install manifest createdDirectories must be an array.");
  }
  if (expectedVersion === TOPO_INSTALL_MANIFEST_VERSION) {
    if (typeof value.updatedAt !== "string" || value.updatedAt.length === 0) {
      conflicts.push(
        "Install manifest field updatedAt must be a non-empty string.",
      );
    }
    if (
      typeof value.packageSpec !== "string" ||
      value.packageSpec.length === 0
    ) {
      conflicts.push(
        "Install manifest field packageSpec must be a non-empty string.",
      );
    }
  }
  return conflicts;
}

function parsePackageManifest(content: string): PackageManifest {
  return parseJsonRecord(content, "package.json") as PackageManifest;
}

function packageSpecFromManifest(
  manifest: PackageManifest,
  packageName: string,
): string | undefined {
  const dependency = manifest.dependencies?.[packageName];
  const devDependency = manifest.devDependencies?.[packageName];
  if (dependency !== undefined && devDependency !== undefined) {
    throw new TopoProjectLifecycleError(
      `${packageName} appears in both dependencies and devDependencies.`,
    );
  }
  return dependency ?? devDependency;
}

function stringifyLike(value: unknown, reference: string): string {
  const newline = reference.includes("\r\n") ? "\r\n" : "\n";
  const indentMatch = /^([ \t]+)"/m.exec(reference);
  const indent = indentMatch?.[1] ?? "  ";
  return `${JSON.stringify(value, null, indent)}\n`.replace(/\n/g, newline);
}

function immutable<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function migrationConflictPlan(
  projectRoot: string,
  generatedAt: string,
  fromVersion: number | undefined,
  conflicts: readonly string[],
): ProjectMigrationPlan {
  return immutable({
    schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
    kind: "project-migration",
    status: "conflict",
    projectRoot,
    manifestPath: path.join(projectRoot, INSTALL_MANIFEST_PATH),
    generatedAt,
    fromVersion,
    toVersion: TOPO_INSTALL_MANIFEST_VERSION,
    steps: Object.freeze([]),
    changedPaths: Object.freeze([]),
    conflicts: Object.freeze([...conflicts]),
  });
}

export async function planProjectMigration(
  options: PlanProjectMigrationOptions,
): Promise<ProjectMigrationPlan> {
  const projectRoot = normalizeProjectRoot(options.projectRoot);
  const generatedAt = options.now ?? new Date().toISOString();
  const manifestPath = path.join(projectRoot, INSTALL_MANIFEST_PATH);
  let beforeManifestContent: string;
  try {
    beforeManifestContent = await readRequired(
      manifestPath,
      ".topo/install.json",
    );
  } catch (error: unknown) {
    return migrationConflictPlan(projectRoot, generatedAt, undefined, [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  let raw: Record<string, unknown>;
  try {
    raw = parseJsonRecord(beforeManifestContent, ".topo/install.json");
  } catch (error: unknown) {
    return migrationConflictPlan(projectRoot, generatedAt, undefined, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const fromVersion = manifestVersion(raw);
  if (fromVersion === TOPO_INSTALL_MANIFEST_VERSION) {
    const conflicts = validateInstallManifestBase(
      raw,
      TOPO_INSTALL_MANIFEST_VERSION,
    );
    if (conflicts.length > 0) {
      return migrationConflictPlan(
        projectRoot,
        generatedAt,
        fromVersion,
        conflicts,
      );
    }
    return immutable({
      schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
      kind: "project-migration",
      status: "current",
      projectRoot,
      manifestPath,
      generatedAt,
      fromVersion,
      toVersion: TOPO_INSTALL_MANIFEST_VERSION,
      steps: Object.freeze([]),
      changedPaths: Object.freeze([]),
      conflicts: Object.freeze([]),
      beforeManifestHash: sha256(beforeManifestContent),
    });
  }
  if (fromVersion !== 2) {
    return migrationConflictPlan(projectRoot, generatedAt, fromVersion, [
      `Install manifest version ${String(fromVersion ?? "unknown")} has no registered migration to version ${TOPO_INSTALL_MANIFEST_VERSION}; Topo will not guess.`,
    ]);
  }

  const conflicts = validateInstallManifestBase(raw, 2);
  if (conflicts.length > 0) {
    return migrationConflictPlan(
      projectRoot,
      generatedAt,
      fromVersion,
      conflicts,
    );
  }
  const packagePath = path.join(projectRoot, PACKAGE_MANIFEST_PATH);
  let beforePackageContent: string;
  try {
    beforePackageContent = await readRequired(packagePath, "package.json");
  } catch (error: unknown) {
    return migrationConflictPlan(projectRoot, generatedAt, fromVersion, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  let packageSpec: string;
  try {
    const packageName = raw.packageName as string;
    packageSpec =
      packageSpecFromManifest(
        parsePackageManifest(beforePackageContent),
        packageName,
      ) ?? `^${String(raw.topoVersion)}`;
  } catch (error: unknown) {
    return migrationConflictPlan(projectRoot, generatedAt, fromVersion, [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  const migrated = {
    ...(raw as unknown as InstallManifestV2),
    schemaVersion: TOPO_INSTALL_MANIFEST_VERSION,
    updatedAt: generatedAt,
    packageSpec,
  } satisfies TopoInstallManifest;
  const afterManifestContent = stringifyLike(migrated, beforeManifestContent);
  return immutable({
    schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
    kind: "project-migration",
    status: "ready",
    projectRoot,
    manifestPath,
    generatedAt,
    fromVersion,
    toVersion: TOPO_INSTALL_MANIFEST_VERSION,
    steps: Object.freeze([
      immutable({
        id: "install-manifest-v2-to-v3",
        sourceVersion: 2,
        targetVersion: TOPO_INSTALL_MANIFEST_VERSION,
        summary:
          "Add explicit package-spec and lifecycle-update evidence without changing managed project files.",
      }),
    ]),
    changedPaths: Object.freeze([INSTALL_MANIFEST_PATH]),
    conflicts: Object.freeze([]),
    beforeManifestHash: sha256(beforeManifestContent),
    beforePackageHash: sha256(beforePackageContent),
    afterManifestContent,
  });
}

export async function applyProjectMigration(
  plan: ProjectMigrationPlan,
): Promise<ProjectMigrationResult> {
  if (plan.status === "conflict") {
    throw new TopoProjectLifecycleError(
      "Topo migration plan has conflicts; no files were changed.",
    );
  }
  if (plan.fromVersion === undefined) {
    throw new TopoProjectLifecycleError(
      "Topo migration plan has no source version.",
    );
  }
  if (plan.status === "current") {
    return immutable({
      schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
      kind: "project-migration",
      status: "current",
      projectRoot: plan.projectRoot,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      changedPaths: Object.freeze([]),
    });
  }
  if (!plan.beforeManifestHash || !plan.afterManifestContent) {
    throw new TopoProjectLifecycleError("Topo migration plan is incomplete.");
  }
  const currentManifest = await readRequired(
    plan.manifestPath,
    ".topo/install.json",
  );
  if (sha256(currentManifest) !== plan.beforeManifestHash) {
    throw new TopoProjectLifecycleError(
      "Topo migration plan is stale; .topo/install.json changed after planning.",
    );
  }
  if (plan.beforePackageHash) {
    const currentPackage = await readRequired(
      path.join(plan.projectRoot, PACKAGE_MANIFEST_PATH),
      "package.json",
    );
    if (sha256(currentPackage) !== plan.beforePackageHash) {
      throw new TopoProjectLifecycleError(
        "Topo migration plan is stale; package.json changed after planning.",
      );
    }
  }
  await writeFile(plan.manifestPath, plan.afterManifestContent, "utf8");
  return immutable({
    schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
    kind: "project-migration",
    status: "migrated",
    projectRoot: plan.projectRoot,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    changedPaths: plan.changedPaths,
  });
}

function updateConflictPlan(
  projectRoot: string,
  generatedAt: string,
  targetVersion: string,
  packageSpec: string,
  conflicts: readonly string[],
  currentVersion?: string,
  packageManager?: TopoPackageManager,
): ProjectUpdatePlan {
  return immutable({
    schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
    kind: "project-update",
    status: "conflict",
    projectRoot,
    generatedAt,
    currentVersion,
    targetVersion,
    packageSpec,
    installCommand: Object.freeze([...installCommand(packageManager)]),
    changedPaths: Object.freeze([]),
    conflicts: Object.freeze([...conflicts]),
  });
}

function cloneManifest(value: PackageManifest): PackageManifest {
  return JSON.parse(JSON.stringify(value)) as PackageManifest;
}

function mutableMap(
  manifest: PackageManifest,
  key: "scripts" | "dependencies" | "devDependencies",
): Record<string, string> {
  const current = manifest[key];
  if (current !== undefined && !isRecord(current)) {
    throw new TopoProjectLifecycleError(
      `package.json ${key} must be an object.`,
    );
  }
  const next = { ...(current ?? {}) } as Record<string, string>;
  (manifest as Record<string, unknown>)[key] = next;
  return next;
}

function restoreManagedPackageFields(
  current: PackageManifest,
  original: PackageManifest,
  packageName: string,
): PackageManifest {
  const baseline = cloneManifest(current);
  const scripts = mutableMap(baseline, "scripts");
  if (original.scripts && hasOwn(original.scripts, "topo")) {
    scripts.topo = original.scripts.topo!;
  } else {
    delete scripts.topo;
  }
  const dependencies = mutableMap(baseline, "dependencies");
  const devDependencies = mutableMap(baseline, "devDependencies");
  delete dependencies[packageName];
  delete devDependencies[packageName];
  if (original.dependencies && hasOwn(original.dependencies, packageName)) {
    dependencies[packageName] = original.dependencies[packageName]!;
  }
  if (
    original.devDependencies &&
    hasOwn(original.devDependencies, packageName)
  ) {
    devDependencies[packageName] = original.devDependencies[packageName]!;
  }
  return baseline;
}

function updatedPackageManifest(
  current: PackageManifest,
  packageName: string,
  packageSpec: string,
): PackageManifest {
  const next = cloneManifest(current);
  const scripts = mutableMap(next, "scripts");
  if (scripts.topo !== "topo dev") {
    throw new TopoProjectLifecycleError(
      `package.json script "topo" is ${JSON.stringify(scripts.topo)}; update will not overwrite project-owned behavior.`,
    );
  }
  const dependencies = mutableMap(next, "dependencies");
  const devDependencies = mutableMap(next, "devDependencies");
  const inDependencies = hasOwn(dependencies, packageName);
  const inDevDependencies = hasOwn(devDependencies, packageName);
  if (inDependencies && inDevDependencies) {
    throw new TopoProjectLifecycleError(
      `${packageName} appears in both dependencies and devDependencies.`,
    );
  }
  if (!inDependencies && !inDevDependencies) {
    throw new TopoProjectLifecycleError(
      `${packageName} is not installed in package.json; update will not add untracked ownership.`,
    );
  }
  if (inDependencies) dependencies[packageName] = packageSpec;
  else devDependencies[packageName] = packageSpec;
  return next;
}

function parseManagedPackageRecord(
  manifest: TopoInstallManifest,
): TopoInstalledFile {
  const record = manifest.files.find(
    (file) => file.path === PACKAGE_MANIFEST_PATH,
  );
  if (
    !record ||
    record.action !== "modified" ||
    record.beforeContent === undefined
  ) {
    throw new TopoProjectLifecycleError(
      "Install manifest does not contain reversible package.json ownership.",
    );
  }
  return record;
}

export async function planProjectUpdate(
  options: PlanProjectUpdateOptions,
): Promise<ProjectUpdatePlan> {
  const projectRoot = normalizeProjectRoot(options.projectRoot);
  const generatedAt = options.now ?? new Date().toISOString();
  const packageSpec = options.packageSpec ?? `^${options.targetVersion}`;
  const optionConflicts: string[] = [];
  if (!VERSION_PATTERN.test(options.targetVersion)) {
    optionConflicts.push(
      `Target version ${JSON.stringify(options.targetVersion)} is not a supported semantic version.`,
    );
  }
  if (packageSpec.trim().length === 0 || /[\r\n]/.test(packageSpec)) {
    optionConflicts.push("Package spec must be a non-empty single-line value.");
  }
  if (optionConflicts.length > 0) {
    return updateConflictPlan(
      projectRoot,
      generatedAt,
      options.targetVersion,
      packageSpec,
      optionConflicts,
    );
  }

  const manifestPath = path.join(projectRoot, INSTALL_MANIFEST_PATH);
  const packagePath = path.join(projectRoot, PACKAGE_MANIFEST_PATH);
  let beforeManifestContent: string;
  let beforePackageContent: string;
  try {
    [beforeManifestContent, beforePackageContent] = await Promise.all([
      readRequired(manifestPath, ".topo/install.json"),
      readRequired(packagePath, "package.json"),
    ]);
  } catch (error: unknown) {
    return updateConflictPlan(
      projectRoot,
      generatedAt,
      options.targetVersion,
      packageSpec,
      [error instanceof Error ? error.message : String(error)],
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = parseJsonRecord(beforeManifestContent, ".topo/install.json");
  } catch (error: unknown) {
    return updateConflictPlan(
      projectRoot,
      generatedAt,
      options.targetVersion,
      packageSpec,
      [error instanceof Error ? error.message : String(error)],
    );
  }
  const version = manifestVersion(raw);
  if (version !== TOPO_INSTALL_MANIFEST_VERSION) {
    return updateConflictPlan(
      projectRoot,
      generatedAt,
      options.targetVersion,
      packageSpec,
      [
        `Install manifest version ${String(version ?? "unknown")} must be migrated to version ${TOPO_INSTALL_MANIFEST_VERSION} before update.`,
      ],
      typeof raw.topoVersion === "string" ? raw.topoVersion : undefined,
      validPackageManager(raw.packageManager) ? raw.packageManager : undefined,
    );
  }
  const manifestConflicts = validateInstallManifestBase(
    raw,
    TOPO_INSTALL_MANIFEST_VERSION,
  );
  if (manifestConflicts.length > 0) {
    return updateConflictPlan(
      projectRoot,
      generatedAt,
      options.targetVersion,
      packageSpec,
      manifestConflicts,
      typeof raw.topoVersion === "string" ? raw.topoVersion : undefined,
      validPackageManager(raw.packageManager) ? raw.packageManager : undefined,
    );
  }
  const manifest = raw as unknown as TopoInstallManifest;
  let currentPackage: PackageManifest;
  let nextPackage: PackageManifest;
  let baselinePackage: PackageManifest;
  let packageRecord: TopoInstalledFile;
  try {
    currentPackage = parsePackageManifest(beforePackageContent);
    packageRecord = parseManagedPackageRecord(manifest);
    const originalPackage = parsePackageManifest(packageRecord.beforeContent!);
    nextPackage = updatedPackageManifest(
      currentPackage,
      manifest.packageName,
      packageSpec,
    );
    baselinePackage = restoreManagedPackageFields(
      currentPackage,
      originalPackage,
      manifest.packageName,
    );
  } catch (error: unknown) {
    return updateConflictPlan(
      projectRoot,
      generatedAt,
      options.targetVersion,
      packageSpec,
      [error instanceof Error ? error.message : String(error)],
      manifest.topoVersion,
      manifest.packageManager,
    );
  }
  const afterPackageContent = stringifyLike(nextPackage, beforePackageContent);
  const baselineContent = stringifyLike(baselinePackage, beforePackageContent);
  const files = manifest.files.map((file) =>
    file.path === PACKAGE_MANIFEST_PATH
      ? {
          ...file,
          beforeContent: baselineContent,
          afterHash: sha256(afterPackageContent),
        }
      : file,
  );
  const nextManifest: TopoInstallManifest = {
    ...manifest,
    updatedAt: generatedAt,
    topoVersion: options.targetVersion,
    packageSpec,
    files,
  };
  const afterManifestContent = stringifyLike(
    nextManifest,
    beforeManifestContent,
  );
  const changed =
    afterPackageContent !== beforePackageContent ||
    afterManifestContent !== beforeManifestContent;
  return immutable({
    schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
    kind: "project-update",
    status: changed ? "ready" : "current",
    projectRoot,
    generatedAt,
    currentVersion: manifest.topoVersion,
    targetVersion: options.targetVersion,
    packageName: manifest.packageName,
    packageSpec,
    installCommand: Object.freeze([...installCommand(manifest.packageManager)]),
    changedPaths: Object.freeze(
      changed ? [PACKAGE_MANIFEST_PATH, INSTALL_MANIFEST_PATH] : [],
    ),
    conflicts: Object.freeze([]),
    beforePackageHash: sha256(beforePackageContent),
    beforeManifestHash: sha256(beforeManifestContent),
    beforePackageContent,
    afterPackageContent,
    afterManifestContent,
  });
}

export async function applyProjectUpdate(
  plan: ProjectUpdatePlan,
): Promise<ProjectUpdateResult> {
  if (plan.status === "conflict") {
    throw new TopoProjectLifecycleError(
      "Topo update plan has conflicts; no files were changed.",
    );
  }
  if (!plan.currentVersion) {
    throw new TopoProjectLifecycleError(
      "Topo update plan has no current version.",
    );
  }
  if (plan.status === "current") {
    return immutable({
      schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
      kind: "project-update",
      status: "current",
      projectRoot: plan.projectRoot,
      previousVersion: plan.currentVersion,
      version: plan.targetVersion,
      packageSpec: plan.packageSpec,
      changedPaths: Object.freeze([]),
      installCommand: plan.installCommand,
    });
  }
  if (
    !plan.beforePackageHash ||
    !plan.beforeManifestHash ||
    plan.beforePackageContent === undefined ||
    plan.afterPackageContent === undefined ||
    plan.afterManifestContent === undefined
  ) {
    throw new TopoProjectLifecycleError("Topo update plan is incomplete.");
  }
  const packagePath = path.join(plan.projectRoot, PACKAGE_MANIFEST_PATH);
  const manifestPath = path.join(plan.projectRoot, INSTALL_MANIFEST_PATH);
  const [currentPackage, currentManifest] = await Promise.all([
    readRequired(packagePath, "package.json"),
    readRequired(manifestPath, ".topo/install.json"),
  ]);
  if (sha256(currentPackage) !== plan.beforePackageHash) {
    throw new TopoProjectLifecycleError(
      "Topo update plan is stale; package.json changed after planning.",
    );
  }
  if (sha256(currentManifest) !== plan.beforeManifestHash) {
    throw new TopoProjectLifecycleError(
      "Topo update plan is stale; .topo/install.json changed after planning.",
    );
  }
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(packagePath, plan.afterPackageContent, "utf8");
  try {
    await writeFile(manifestPath, plan.afterManifestContent, "utf8");
  } catch (error) {
    await writeFile(packagePath, plan.beforePackageContent, "utf8").catch(
      () => undefined,
    );
    throw error;
  }
  return immutable({
    schemaVersion: TOPO_LIFECYCLE_PLAN_VERSION,
    kind: "project-update",
    status: "updated",
    projectRoot: plan.projectRoot,
    previousVersion: plan.currentVersion,
    version: plan.targetVersion,
    packageSpec: plan.packageSpec,
    changedPaths: plan.changedPaths,
    installCommand: plan.installCommand,
  });
}
