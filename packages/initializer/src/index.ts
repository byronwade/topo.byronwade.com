import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const TOPO_INSTALL_MANIFEST_VERSION = 3 as const;
export const TOPO_INITIALIZATION_PLAN_VERSION = 1 as const;

export type TopoPackageManager = "pnpm" | "npm" | "yarn" | "bun";
export type TopoDetectedFramework =
  | "next"
  | "tanstack"
  | "react"
  | "vue"
  | "nuxt"
  | "svelte"
  | "mixed"
  | "unknown";

export interface TopoApplicationCandidate {
  readonly path: string;
  readonly name?: string;
  readonly framework: TopoDetectedFramework;
  readonly storybook: boolean;
  readonly playwright: boolean;
  readonly fixtures: boolean;
  readonly mocks: boolean;
  readonly devScript?: string;
}

export interface TopoProjectDetection {
  readonly packageManager: TopoPackageManager;
  readonly monorepo: boolean;
  readonly applications: readonly TopoApplicationCandidate[];
  readonly selectedApplication?: TopoApplicationCandidate;
}

export interface TopoDirectoryOperation {
  readonly kind: "directory";
  readonly path: string;
  readonly action: "create" | "keep";
  readonly description: string;
}

export interface TopoFileOperation {
  readonly kind: "file";
  readonly path: string;
  readonly action: "create" | "update" | "keep";
  readonly description: string;
  readonly beforeHash?: string;
  readonly afterHash: string;
  readonly beforeContent?: string;
  readonly afterContent: string;
}

export type TopoInitializationOperation =
  TopoDirectoryOperation | TopoFileOperation;

export type TopoInitializationStatus =
  "ready" | "selection-required" | "already-installed" | "conflict";

export interface PlanInitializationOptions {
  projectRoot: string;
  application?: string;
  packageName?: string;
  packageVersion?: string;
  packageSpec?: string;
  installPackage?: boolean;
  now?: string;
}

export interface TopoInitializationPlan {
  readonly schemaVersion: typeof TOPO_INITIALIZATION_PLAN_VERSION;
  readonly status: TopoInitializationStatus;
  readonly projectRoot: string;
  readonly sourceRoot?: string;
  readonly generatedAt: string;
  readonly detection: TopoProjectDetection;
  readonly operations: readonly TopoInitializationOperation[];
  readonly conflicts: readonly string[];
  readonly installCommand: readonly string[];
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageSpec: string;
}

export interface TopoInstalledFile {
  readonly path: string;
  readonly action: "created" | "modified";
  readonly beforeContent?: string;
  readonly afterHash: string;
}

export interface TopoInstallManifest {
  readonly schemaVersion: typeof TOPO_INSTALL_MANIFEST_VERSION;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly topoVersion: string;
  readonly packageName: string;
  readonly packageSpec: string;
  readonly packageManager: TopoPackageManager;
  readonly sourceRoot: string;
  readonly detection: TopoProjectDetection;
  readonly files: readonly TopoInstalledFile[];
  readonly createdDirectories: readonly string[];
}

export interface TopoInitializationResult {
  readonly status: "installed";
  readonly projectRoot: string;
  readonly sourceRoot: string;
  readonly manifestPath: string;
  readonly changedPaths: readonly string[];
  readonly installCommand: readonly string[];
  readonly detection: TopoProjectDetection;
}

export interface TopoUninstallPlan {
  readonly status: "ready" | "not-installed" | "conflict";
  readonly projectRoot: string;
  readonly manifestPath: string;
  readonly manifest?: TopoInstallManifest;
  readonly changes: readonly {
    path: string;
    action: "remove" | "restore";
  }[];
  readonly conflicts: readonly string[];
}

export interface TopoUninstallResult {
  readonly status: "uninstalled" | "not-installed";
  readonly projectRoot: string;
  readonly changedPaths: readonly string[];
}

export class TopoInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopoInitializationError";
  }
}

interface PackageManifest {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
}

const DERIVED_GITIGNORE_BLOCK = `# topo:start - derived local artifacts
.topo/state.json
.topo/snapshots/
.topo/previews/
.topo/llm/
.topo/cache/
# topo:end
`;

const TOPO_DIRECTORIES = [
  ".topo",
  ".topo/notes",
  ".topo/fixtures",
  ".topo/flows",
  ".topo/metadata",
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRelative(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized === "" ? "." : normalized;
}

function resolveInside(projectRoot: string, relativePath: string): string {
  const absoluteRoot = path.resolve(projectRoot);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TopoInitializationError(
      `Path escapes the Topo project root: ${relativePath}`,
    );
  }
  return absolutePath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function readManifest(
  directory: string,
): Promise<PackageManifest | undefined> {
  const content = await readText(path.join(directory, "package.json"));
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content) as PackageManifest;
  } catch {
    throw new TopoInitializationError(
      `package.json is not valid JSON: ${path.join(directory, "package.json")}`,
    );
  }
}

function dependencyNames(manifest: PackageManifest | undefined): Set<string> {
  return new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
}

function hasDependency(
  dependencies: ReadonlySet<string>,
  value: string,
): boolean {
  return dependencies.has(value);
}

async function hasAnyPath(
  directory: string,
  relativePaths: readonly string[],
): Promise<boolean> {
  for (const relativePath of relativePaths) {
    if (await exists(path.join(directory, relativePath))) return true;
  }
  return false;
}

async function inspectApplication(
  projectRoot: string,
  directory: string,
): Promise<TopoApplicationCandidate> {
  const manifest = await readManifest(directory);
  const dependencies = dependencyNames(manifest);
  const next = hasDependency(dependencies, "next");
  const tanstack =
    hasDependency(dependencies, "@tanstack/react-router") ||
    hasDependency(dependencies, "@tanstack/react-start") ||
    hasDependency(dependencies, "@tanstack/start");
  const nuxt = hasDependency(dependencies, "nuxt");
  const svelte =
    hasDependency(dependencies, "@sveltejs/kit") ||
    hasDependency(dependencies, "svelte");
  const vue = hasDependency(dependencies, "vue") && !nuxt;
  const react = hasDependency(dependencies, "react") && !next && !tanstack;
  const framework: TopoDetectedFramework =
    next && tanstack
      ? "mixed"
      : next
        ? "next"
        : tanstack
          ? "tanstack"
          : nuxt
            ? "nuxt"
            : svelte
              ? "svelte"
              : vue
                ? "vue"
                : react
                  ? "react"
                  : "unknown";
  const storybook =
    [...dependencies].some(
      (name) => name === "storybook" || name.startsWith("@storybook/"),
    ) || (await isDirectory(path.join(directory, ".storybook")));
  const playwright =
    hasDependency(dependencies, "playwright") ||
    hasDependency(dependencies, "@playwright/test") ||
    (await hasAnyPath(directory, [
      "playwright.config.ts",
      "playwright.config.js",
      "playwright.config.mjs",
    ]));
  const fixtures = await hasAnyPath(directory, [
    "fixtures",
    "__fixtures__",
    ".topo/fixtures",
  ]);
  const mocks =
    hasDependency(dependencies, "msw") ||
    (await hasAnyPath(directory, ["mocks", "__mocks__"]));
  return Object.freeze({
    path: normalizeRelative(path.relative(projectRoot, directory)),
    name: manifest?.name,
    framework,
    storybook,
    playwright,
    fixtures,
    mocks,
    devScript: manifest?.scripts?.dev,
  });
}

async function detectPackageManager(
  projectRoot: string,
  manifest: PackageManifest | undefined,
): Promise<TopoPackageManager> {
  const declared = manifest?.packageManager?.split("@")[0];
  if (
    declared === "pnpm" ||
    declared === "npm" ||
    declared === "yarn" ||
    declared === "bun"
  ) {
    return declared;
  }
  const locks: readonly [TopoPackageManager, readonly string[]][] = [
    ["pnpm", ["pnpm-lock.yaml"]],
    ["npm", ["package-lock.json", "npm-shrinkwrap.json"]],
    ["yarn", ["yarn.lock"]],
    ["bun", ["bun.lock", "bun.lockb"]],
  ];
  for (const [manager, files] of locks) {
    if (await hasAnyPath(projectRoot, files)) return manager;
  }
  return "npm";
}

async function discoverApplications(
  projectRoot: string,
): Promise<TopoApplicationCandidate[]> {
  const directories = new Set<string>([projectRoot]);
  for (const collection of ["apps", "packages"]) {
    const collectionRoot = path.join(projectRoot, collection);
    try {
      for (const entry of await readdir(collectionRoot, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(collectionRoot, entry.name);
        if (await exists(path.join(directory, "package.json"))) {
          directories.add(directory);
        }
      }
    } catch {
      // Common workspace folders are optional.
    }
  }
  const inspected = await Promise.all(
    [...directories].map((directory) =>
      inspectApplication(projectRoot, directory),
    ),
  );
  const applications = inspected.filter(
    (candidate) => candidate.framework !== "unknown",
  );
  return (applications.length > 0 ? applications : [inspected[0]!]).sort(
    (left, right) => left.path.localeCompare(right.path),
  );
}

async function detectProject(
  projectRoot: string,
  application?: string,
): Promise<TopoProjectDetection> {
  const manifest = await readManifest(projectRoot);
  const packageManager = await detectPackageManager(projectRoot, manifest);
  const applications = await discoverApplications(projectRoot);
  let selectedApplication: TopoApplicationCandidate | undefined;
  if (application !== undefined) {
    const sourceRoot = resolveInside(projectRoot, application);
    if (!(await isDirectory(sourceRoot))) {
      throw new TopoInitializationError(
        `Selected application directory does not exist: ${application}`,
      );
    }
    const inspected = await inspectApplication(projectRoot, sourceRoot);
    selectedApplication = inspected;
    if (!applications.some((candidate) => candidate.path === inspected.path)) {
      applications.push(inspected);
      applications.sort((left, right) => left.path.localeCompare(right.path));
    }
  } else if (applications.length === 1) {
    selectedApplication = applications[0];
  }
  const monorepo =
    manifest?.workspaces !== undefined ||
    (await hasAnyPath(projectRoot, [
      "pnpm-workspace.yaml",
      "lerna.json",
      "turbo.json",
      "nx.json",
    ])) ||
    applications.some((candidate) => candidate.path !== ".");
  return Object.freeze({
    packageManager,
    monorepo,
    applications: Object.freeze(applications),
    selectedApplication,
  });
}

function inferPort(candidate: TopoApplicationCandidate): number {
  const match = /(?:--port|-p)\s+(\d{2,5})(?:\s|$)/.exec(
    candidate.devScript ?? "",
  );
  if (match?.[1]) {
    const port = Number(match[1]);
    if (port > 0 && port <= 65_535) return port;
  }
  return candidate.framework === "tanstack" ||
    candidate.framework === "react" ||
    candidate.framework === "vue" ||
    candidate.framework === "svelte"
    ? 5173
    : 3000;
}

function configTemplate(candidate: TopoApplicationCandidate): string {
  const rootDir = candidate.path === "." ? "." : candidate.path;
  const port = inferPort(candidate);
  return `export default {
  rootDir: ${JSON.stringify(rootDir)},
  daemon: { host: "127.0.0.1", port: 4599 },
  preview: {
    baseUrl: "http://localhost:${port}",
    server: { mode: "auto" },
    componentBaseUrls: { storybook: "http://127.0.0.1:6006" },
  },
  profiles: [{ name: "Anonymous" }],
  extensions: {
    frameworkAdapters: [],
    apiEndpointAdapters: [],
    flowAdapters: [],
    componentPreviewAdapters: [],
    applicationRuntimeAdapters: [],
  },
};
`;
}

function detectIndent(content: string): string {
  const match = /^([ \t]+)"/m.exec(content);
  return match?.[1] ?? "  ";
}

function packageContent(
  beforeContent: string,
  packageName: string,
  packageSpec: string,
): { content: string; conflicts: string[] } {
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(beforeContent) as PackageManifest;
  } catch {
    return {
      content: beforeContent,
      conflicts: ["package.json is not valid JSON"],
    };
  }
  const conflicts: string[] = [];
  const scripts = { ...(manifest.scripts ?? {}) };
  if (scripts.topo !== undefined && scripts.topo !== "topo dev") {
    conflicts.push(
      `package.json script "topo" already means ${JSON.stringify(scripts.topo)}`,
    );
  } else {
    scripts.topo = "topo dev";
  }
  const dependencies = manifest.dependencies ?? {};
  const devDependencies = { ...(manifest.devDependencies ?? {}) };
  if (
    dependencies[packageName] === undefined &&
    devDependencies[packageName] === undefined
  ) {
    devDependencies[packageName] = packageSpec;
  }
  const next = {
    ...manifest,
    scripts,
    devDependencies,
  };
  const newline = beforeContent.endsWith("\r\n") ? "\r\n" : "\n";
  const serialized =
    `${JSON.stringify(next, null, detectIndent(beforeContent))}\n`.replace(
      /\n/g,
      newline,
    );
  return { content: serialized, conflicts };
}

async function fileOperation(
  projectRoot: string,
  relativePath: string,
  afterContent: string,
  description: string,
): Promise<TopoFileOperation> {
  const beforeContent = await readText(
    resolveInside(projectRoot, relativePath),
  );
  if (beforeContent === undefined) {
    return {
      kind: "file",
      path: relativePath,
      action: "create",
      description,
      afterHash: sha256(afterContent),
      afterContent,
    };
  }
  return {
    kind: "file",
    path: relativePath,
    action: beforeContent === afterContent ? "keep" : "update",
    description,
    beforeHash: sha256(beforeContent),
    afterHash: sha256(afterContent),
    beforeContent,
    afterContent,
  };
}

function installCommand(packageManager: TopoPackageManager): readonly string[] {
  return packageManager === "yarn"
    ? ["yarn", "install"]
    : packageManager === "bun"
      ? ["bun", "install"]
      : packageManager === "pnpm"
        ? ["pnpm", "install"]
        : ["npm", "install"];
}

export async function planInitialization(
  options: PlanInitializationOptions,
): Promise<TopoInitializationPlan> {
  const projectRoot = path.resolve(options.projectRoot);
  if (!(await isDirectory(projectRoot))) {
    throw new TopoInitializationError(
      `Topo project root does not exist: ${projectRoot}`,
    );
  }
  const packageName = options.packageName ?? "@topo/cli";
  const packageVersion = options.packageVersion ?? "0.1.0";
  const packageSpec = options.packageSpec ?? `^${packageVersion}`;
  const generatedAt = options.now ?? new Date().toISOString();
  const detection = await detectProject(projectRoot, options.application);
  const existingInstall = await readText(
    path.join(projectRoot, ".topo", "install.json"),
  );
  if (existingInstall !== undefined) {
    try {
      const value = JSON.parse(existingInstall) as { schemaVersion?: unknown };
      if (value.schemaVersion === TOPO_INSTALL_MANIFEST_VERSION) {
        return Object.freeze({
          schemaVersion: TOPO_INITIALIZATION_PLAN_VERSION,
          status: "already-installed",
          projectRoot,
          sourceRoot: detection.selectedApplication
            ? resolveInside(projectRoot, detection.selectedApplication.path)
            : undefined,
          generatedAt,
          detection,
          operations: [],
          conflicts: [],
          installCommand: installCommand(detection.packageManager),
          packageName,
          packageVersion,
          packageSpec,
        });
      }
    } catch {
      // The conflict below retains malformed installation evidence.
    }
    return Object.freeze({
      schemaVersion: TOPO_INITIALIZATION_PLAN_VERSION,
      status: "conflict",
      projectRoot,
      generatedAt,
      detection,
      operations: [],
      conflicts: [
        `.topo/install.json is not a Topo installation manifest version ${TOPO_INSTALL_MANIFEST_VERSION}; preserve it and run topo migrate explicitly.`,
      ],
      installCommand: installCommand(detection.packageManager),
      packageName,
      packageVersion,
      packageSpec,
    });
  }
  if (!detection.selectedApplication) {
    return Object.freeze({
      schemaVersion: TOPO_INITIALIZATION_PLAN_VERSION,
      status: "selection-required",
      projectRoot,
      generatedAt,
      detection,
      operations: [],
      conflicts: [],
      installCommand: installCommand(detection.packageManager),
      packageName,
      packageVersion,
      packageSpec,
    });
  }

  const operations: TopoInitializationOperation[] = [];
  for (const relativePath of TOPO_DIRECTORIES) {
    operations.push({
      kind: "directory",
      path: relativePath,
      action: (await isDirectory(resolveInside(projectRoot, relativePath)))
        ? "keep"
        : "create",
      description: "Topo project data directory",
    });
  }
  const configPath = "topo.config.ts";
  const existingConfig = await readText(resolveInside(projectRoot, configPath));
  operations.push(
    await fileOperation(
      projectRoot,
      configPath,
      existingConfig ?? configTemplate(detection.selectedApplication),
      existingConfig === undefined
        ? "Create the project configuration"
        : "Keep the existing project configuration",
    ),
  );

  const gitignorePath = ".gitignore";
  const beforeGitignore =
    (await readText(resolveInside(projectRoot, gitignorePath))) ?? "";
  const nextGitignore = beforeGitignore.includes("# topo:start")
    ? beforeGitignore
    : `${beforeGitignore}${beforeGitignore && !beforeGitignore.endsWith("\n") ? "\n" : ""}${beforeGitignore ? "\n" : ""}${DERIVED_GITIGNORE_BLOCK}`;
  operations.push(
    await fileOperation(
      projectRoot,
      gitignorePath,
      nextGitignore,
      "Ignore only derived local Topo artifacts",
    ),
  );

  const conflicts: string[] = [];
  const packagePath = "package.json";
  const beforePackage = await readText(resolveInside(projectRoot, packagePath));
  if (beforePackage !== undefined && options.installPackage !== false) {
    const next = packageContent(beforePackage, packageName, packageSpec);
    conflicts.push(...next.conflicts);
    operations.push(
      await fileOperation(
        projectRoot,
        packagePath,
        next.content,
        `Add the topo command and ${packageName} development dependency`,
      ),
    );
  }

  return Object.freeze({
    schemaVersion: TOPO_INITIALIZATION_PLAN_VERSION,
    status: conflicts.length > 0 ? "conflict" : "ready",
    projectRoot,
    sourceRoot: resolveInside(projectRoot, detection.selectedApplication.path),
    generatedAt,
    detection,
    operations: Object.freeze(operations),
    conflicts: Object.freeze(conflicts),
    installCommand: installCommand(detection.packageManager),
    packageName,
    packageVersion,
    packageSpec,
  });
}

function changedFileOperations(
  plan: TopoInitializationPlan,
): TopoFileOperation[] {
  return plan.operations.filter(
    (operation): operation is TopoFileOperation =>
      operation.kind === "file" && operation.action !== "keep",
  );
}

async function assertPlanStillApplies(
  plan: TopoInitializationPlan,
): Promise<void> {
  for (const operation of changedFileOperations(plan)) {
    const absolutePath = resolveInside(plan.projectRoot, operation.path);
    const current = await readText(absolutePath);
    if (operation.action === "create" && current !== undefined) {
      throw new TopoInitializationError(
        `Initialization plan is stale; ${operation.path} now exists.`,
      );
    }
    if (
      operation.action === "update" &&
      (current === undefined || sha256(current) !== operation.beforeHash)
    ) {
      throw new TopoInitializationError(
        `Initialization plan is stale; ${operation.path} changed after planning.`,
      );
    }
  }
}

export async function applyInitialization(
  plan: TopoInitializationPlan,
): Promise<TopoInitializationResult> {
  if (plan.status !== "ready" || !plan.sourceRoot) {
    throw new TopoInitializationError(
      `Cannot apply a Topo initialization plan with status ${plan.status}.`,
    );
  }
  await assertPlanStillApplies(plan);
  const manifestPath = ".topo/install.json";
  if (await exists(resolveInside(plan.projectRoot, manifestPath))) {
    throw new TopoInitializationError(
      "Initialization plan is stale; .topo/install.json now exists.",
    );
  }
  const createdDirectories = plan.operations
    .filter(
      (operation): operation is TopoDirectoryOperation =>
        operation.kind === "directory" && operation.action === "create",
    )
    .map((operation) => operation.path);
  const files = changedFileOperations(plan);
  const appliedFiles: TopoFileOperation[] = [];
  const appliedDirectories: string[] = [];
  try {
    for (const relativePath of createdDirectories) {
      await mkdir(resolveInside(plan.projectRoot, relativePath));
      appliedDirectories.push(relativePath);
    }
    for (const operation of files) {
      const absolutePath = resolveInside(plan.projectRoot, operation.path);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, operation.afterContent, "utf8");
      appliedFiles.push(operation);
    }
    const manifest: TopoInstallManifest = {
      schemaVersion: TOPO_INSTALL_MANIFEST_VERSION,
      installedAt: plan.generatedAt,
      updatedAt: plan.generatedAt,
      topoVersion: plan.packageVersion,
      packageName: plan.packageName,
      packageSpec: plan.packageSpec,
      packageManager: plan.detection.packageManager,
      sourceRoot: normalizeRelative(
        path.relative(plan.projectRoot, plan.sourceRoot),
      ),
      detection: plan.detection,
      files: files.map((operation) => ({
        path: operation.path,
        action: operation.action === "create" ? "created" : "modified",
        beforeContent: operation.beforeContent,
        afterHash: operation.afterHash,
      })),
      createdDirectories,
    };
    await writeFile(
      resolveInside(plan.projectRoot, manifestPath),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    for (const operation of appliedFiles.reverse()) {
      const absolutePath = resolveInside(plan.projectRoot, operation.path);
      if (operation.action === "create") {
        await rm(absolutePath, { force: true }).catch(() => undefined);
      } else if (operation.beforeContent !== undefined) {
        await writeFile(absolutePath, operation.beforeContent, "utf8").catch(
          () => undefined,
        );
      }
    }
    for (const relativePath of appliedDirectories.reverse()) {
      await rmdir(resolveInside(plan.projectRoot, relativePath)).catch(
        () => undefined,
      );
    }
    throw error;
  }
  return Object.freeze({
    status: "installed",
    projectRoot: plan.projectRoot,
    sourceRoot: plan.sourceRoot,
    manifestPath: resolveInside(plan.projectRoot, manifestPath),
    changedPaths: Object.freeze([
      ...createdDirectories,
      ...files.map((operation) => operation.path),
      manifestPath,
    ]),
    installCommand: plan.installCommand,
    detection: plan.detection,
  });
}

function parseInstallManifest(value: string): TopoInstallManifest {
  let parsed: TopoInstallManifest;
  try {
    parsed = JSON.parse(value) as TopoInstallManifest;
  } catch {
    throw new TopoInitializationError(
      ".topo/install.json is not valid JSON; uninstall will not guess.",
    );
  }
  if (
    parsed.schemaVersion !== TOPO_INSTALL_MANIFEST_VERSION ||
    !Array.isArray(parsed.files) ||
    !Array.isArray(parsed.createdDirectories)
  ) {
    throw new TopoInitializationError(
      `.topo/install.json is not a supported version ${TOPO_INSTALL_MANIFEST_VERSION} manifest. Run topo migrate first.`,
    );
  }
  return parsed;
}

export async function planUninstall(
  projectRootInput: string,
): Promise<TopoUninstallPlan> {
  const projectRoot = path.resolve(projectRootInput);
  const manifestPath = path.join(projectRoot, ".topo", "install.json");
  const content = await readText(manifestPath);
  if (content === undefined) {
    return Object.freeze({
      status: "not-installed",
      projectRoot,
      manifestPath,
      changes: [],
      conflicts: [],
    });
  }
  const manifest = parseInstallManifest(content);
  const conflicts: string[] = [];
  for (const file of manifest.files) {
    const current = await readText(resolveInside(projectRoot, file.path));
    if (file.action === "created" && current === undefined) continue;
    if (current === undefined || sha256(current) !== file.afterHash) {
      conflicts.push(
        `${file.path} changed after Topo initialization; uninstall preserved it.`,
      );
    }
  }
  return Object.freeze({
    status: conflicts.length > 0 ? "conflict" : "ready",
    projectRoot,
    manifestPath,
    manifest,
    changes: Object.freeze(
      manifest.files.map((file) => ({
        path: file.path,
        action: (file.action === "created" ? "remove" : "restore") as
          "remove" | "restore",
      })),
    ),
    conflicts: Object.freeze(conflicts),
  });
}

export async function applyUninstall(
  plan: TopoUninstallPlan,
): Promise<TopoUninstallResult> {
  if (plan.status === "not-installed") {
    return Object.freeze({
      status: "not-installed",
      projectRoot: plan.projectRoot,
      changedPaths: [],
    });
  }
  if (plan.status !== "ready" || !plan.manifest) {
    throw new TopoInitializationError(
      "Topo uninstall has conflicts; no files were changed.",
    );
  }
  const rechecked = await planUninstall(plan.projectRoot);
  if (rechecked.status !== "ready") {
    throw new TopoInitializationError(
      "Topo installation files changed after uninstall planning; no files were changed.",
    );
  }
  const changedPaths: string[] = [];
  for (const file of [...plan.manifest.files].reverse()) {
    const absolutePath = resolveInside(plan.projectRoot, file.path);
    if (file.action === "created") {
      await rm(absolutePath, { force: true });
    } else {
      await writeFile(absolutePath, file.beforeContent ?? "", "utf8");
    }
    changedPaths.push(file.path);
  }
  await rm(plan.manifestPath, { force: true });
  changedPaths.push(".topo/install.json");
  for (const relativePath of [...plan.manifest.createdDirectories].reverse()) {
    await rmdir(resolveInside(plan.projectRoot, relativePath)).catch(
      () => undefined,
    );
  }
  return Object.freeze({
    status: "uninstalled",
    projectRoot: plan.projectRoot,
    changedPaths: Object.freeze(changedPaths),
  });
}
