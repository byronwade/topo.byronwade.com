import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  inspectStudioBuild,
  TOPO_DAEMON_URL_PLACEHOLDER,
  type StudioBuildReport,
} from "@topo/studio-host";

export const SHOWCASE_MANIFEST_VERSION = 1 as const;
export const SHOWCASE_GENERATOR = "@topo/showcase-builder" as const;

export interface BuildStudioShowcaseOptions {
  sourceDir: string;
  outputDir: string;
  basePath: string;
  routeBase: string;
  /** Used by deterministic tests and release tooling. */
  generatedAt?: string;
}

export interface ShowcaseFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export interface StudioShowcaseManifest {
  schemaVersion: typeof SHOWCASE_MANIFEST_VERSION;
  generator: typeof SHOWCASE_GENERATOR;
  generatedAt: string;
  status: "pass";
  basePath: string;
  routeBase: string;
  entry: string;
  sourceBuild: {
    schemaVersion: number;
    status: "pass";
    reportSha256: string;
    checks: Array<{ id: string; status: "pass" }>;
  };
  files: ShowcaseFileRecord[];
  summary: {
    fileCount: number;
    bytes: number;
  };
}

export interface StudioShowcaseBuildResult {
  outputDir: string;
  manifestPath: string;
  manifest: StudioShowcaseManifest;
}

interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

function normalizePathForComparison(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function validatePublicPath(value: string, label: string): string {
  const candidate = value.trim();
  if (
    !candidate.startsWith("/") ||
    candidate === "/" ||
    candidate.includes("\\") ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    candidate.startsWith("//")
  ) {
    throw new Error(`${label} must be a non-root absolute URL path.`);
  }
  const segments = candidate.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`${label} cannot contain dot segments.`);
  }
  return `/${segments.join("/")}`;
}

function assertDirectChild(parent: string, candidate: string): void {
  if (path.dirname(candidate) !== parent) {
    throw new Error(`Refusing to modify a directory outside ${parent}.`);
  }
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertOwnedOutput(outputDir: string): Promise<boolean> {
  if (!(await pathExists(outputDir))) return false;
  const outputStats = await lstat(outputDir);
  if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) {
    throw new Error(`Showcase output must be a real directory: ${outputDir}`);
  }
  const manifestPath = path.join(outputDir, "showcase-manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(
      `Refusing to replace unowned showcase output without a valid manifest: ${outputDir}`,
    );
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    (manifest as Record<string, unknown>).generator !== SHOWCASE_GENERATOR ||
    (manifest as Record<string, unknown>).schemaVersion !==
      SHOWCASE_MANIFEST_VERSION
  ) {
    throw new Error(
      `Refusing to replace unowned showcase output: ${outputDir}`,
    );
  }
  return true;
}

async function collectSourceFiles(
  sourceRoot: string,
  currentDirectory = sourceRoot,
): Promise<SourceFile[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const files: SourceFile[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Showcase source cannot contain symbolic links: ${absolutePath}`,
      );
    }
    const canonicalPath = await realpath(absolutePath);
    if (canonicalPath !== sourceRoot && !isInside(sourceRoot, canonicalPath)) {
      throw new Error(
        `Showcase source entry escapes its root: ${absolutePath}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(sourceRoot, absolutePath)));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: path
          .relative(sourceRoot, absolutePath)
          .replaceAll("\\", "/"),
      });
    } else {
      throw new Error(`Unsupported showcase source entry: ${absolutePath}`);
    }
  }
  return files;
}

function rebaseHtml(html: string, basePath: string): string {
  return html
    .replaceAll(TOPO_DAEMON_URL_PLACEHOLDER, "")
    .replace(
      /\b(src|href)=(['"])\/(?!\/)([^'"]*)\2/g,
      (_match, attribute: string, quote: string, target: string) =>
        `${attribute}=${quote}${basePath}/${target}${quote}`,
    );
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function stableBuildReportHash(report: StudioBuildReport): string {
  const { generatedAt: _generatedAt, ...stableReport } = report;
  return sha256(JSON.stringify(stableReport));
}

async function verifyHtmlAssets(
  outputRoot: string,
  html: string,
  basePath: string,
): Promise<void> {
  const references = [...html.matchAll(/\b(?:src|href)=(['"])([^'"]+)\1/g)].map(
    (match) => match[2]!,
  );
  for (const reference of references) {
    if (
      reference.startsWith("#") ||
      reference.startsWith("//") ||
      /^[a-z][a-z\d+.-]*:/i.test(reference)
    ) {
      continue;
    }
    if (reference.startsWith("/") && !reference.startsWith(`${basePath}/`)) {
      throw new Error(
        `Showcase HTML contains a local URL outside its asset base: ${reference}`,
      );
    }
    const localReference = reference.startsWith(`${basePath}/`)
      ? reference.slice(basePath.length + 1)
      : reference;
    const withoutBase = localReference.split(/[?#]/, 1)[0]!;
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(withoutBase);
    } catch {
      throw new Error(
        `Showcase HTML contains an invalid asset URL: ${reference}`,
      );
    }
    const assetPath = path.resolve(outputRoot, relativePath);
    if (!isInside(outputRoot, assetPath) || !(await pathExists(assetPath))) {
      throw new Error(`Showcase HTML references a missing asset: ${reference}`);
    }
  }
}

async function writeShowcaseFiles(
  sourceFiles: readonly SourceFile[],
  outputRoot: string,
  basePath: string,
): Promise<ShowcaseFileRecord[]> {
  const records: ShowcaseFileRecord[] = [];
  let rewrittenHtml: string | undefined;
  for (const sourceFile of sourceFiles) {
    const destination = path.join(
      outputRoot,
      ...sourceFile.relativePath.split("/"),
    );
    await mkdir(path.dirname(destination), { recursive: true });
    const sourceContent = await readFile(sourceFile.absolutePath);
    const content =
      sourceFile.relativePath === "index.html"
        ? Buffer.from(rebaseHtml(sourceContent.toString("utf8"), basePath))
        : sourceContent;
    if (sourceFile.relativePath === "index.html") {
      rewrittenHtml = content.toString("utf8");
    }
    await writeFile(destination, content);
    records.push({
      path: sourceFile.relativePath,
      bytes: content.byteLength,
      sha256: sha256(content),
    });
  }
  if (rewrittenHtml === undefined) {
    throw new Error("Topo Studio build is missing index.html.");
  }
  await verifyHtmlAssets(outputRoot, rewrittenHtml, basePath);
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

async function replaceOutput(
  temporaryDir: string,
  outputDir: string,
  outputExists: boolean,
): Promise<void> {
  if (!outputExists) {
    await rename(temporaryDir, outputDir);
    return;
  }
  const parent = path.dirname(outputDir);
  const backup = path.join(
    parent,
    `.${path.basename(outputDir)}.backup-${randomUUID()}`,
  );
  assertDirectChild(parent, backup);
  await rename(outputDir, backup);
  try {
    await rename(temporaryDir, outputDir);
  } catch (error) {
    await rename(backup, outputDir);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

/**
 * Build one deployment-ready, same-origin Studio showcase. The function owns
 * validation, rebasing, evidence, and transactional output replacement so
 * callers do not need to reproduce safety policy.
 */
export async function buildStudioShowcase(
  options: BuildStudioShowcaseOptions,
): Promise<StudioShowcaseBuildResult> {
  const requestedSource = path.resolve(options.sourceDir);
  const sourceDir = await realpath(requestedSource);
  if (
    normalizePathForComparison(sourceDir) !==
    normalizePathForComparison(requestedSource)
  ) {
    throw new Error(
      `Showcase source must not traverse symbolic links: ${requestedSource}`,
    );
  }
  const sourceStats = await stat(sourceDir);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Showcase source must be a directory: ${sourceDir}`);
  }

  const outputDir = path.resolve(options.outputDir);
  const comparableSource = normalizePathForComparison(sourceDir);
  const comparableOutput = normalizePathForComparison(outputDir);
  if (
    comparableSource === comparableOutput ||
    isInside(comparableSource, comparableOutput) ||
    isInside(comparableOutput, comparableSource)
  ) {
    throw new Error(
      "Showcase source and output directories must not contain each other.",
    );
  }
  const basePath = validatePublicPath(options.basePath, "basePath");
  const routeBase = validatePublicPath(options.routeBase, "routeBase");
  if (basePath === routeBase) {
    throw new Error("basePath and routeBase must be distinct.");
  }

  const outputParent = path.dirname(outputDir);
  await mkdir(outputParent, { recursive: true });
  const canonicalOutputParent = await realpath(outputParent);
  if (
    normalizePathForComparison(canonicalOutputParent) !==
    normalizePathForComparison(outputParent)
  ) {
    throw new Error(
      `Showcase output must not traverse symbolic links: ${outputParent}`,
    );
  }
  const physicalOutput = path.join(
    canonicalOutputParent,
    path.basename(outputDir),
  );
  if (
    comparableSource === normalizePathForComparison(physicalOutput) ||
    isInside(comparableSource, normalizePathForComparison(physicalOutput)) ||
    isInside(normalizePathForComparison(physicalOutput), comparableSource)
  ) {
    throw new Error(
      "Showcase source and output directories must not contain each other.",
    );
  }

  const report = await inspectStudioBuild(sourceDir);
  if (report.status !== "pass") {
    const failed = report.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.id)
      .join(", ");
    throw new Error(
      `Topo Studio build cannot be showcased; failed checks: ${failed}`,
    );
  }
  const sourceFiles = await collectSourceFiles(sourceDir);
  const outputExists = await assertOwnedOutput(outputDir);
  const temporaryDir = path.join(
    outputParent,
    `.${path.basename(outputDir)}.temporary-${randomUUID()}`,
  );
  assertDirectChild(outputParent, temporaryDir);
  await mkdir(temporaryDir);

  try {
    const files = await writeShowcaseFiles(sourceFiles, temporaryDir, basePath);
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(generatedAt))) {
      throw new Error("generatedAt must be an ISO-compatible date string.");
    }
    const manifest: StudioShowcaseManifest = {
      schemaVersion: SHOWCASE_MANIFEST_VERSION,
      generator: SHOWCASE_GENERATOR,
      generatedAt,
      status: "pass",
      basePath,
      routeBase,
      entry: `${routeBase}/welcome?demo=1&source=website`,
      sourceBuild: {
        schemaVersion: report.schemaVersion,
        status: "pass",
        reportSha256: stableBuildReportHash(report),
        checks: report.checks.map((check) => ({
          id: check.id,
          status: "pass" as const,
        })),
      },
      files,
      summary: {
        fileCount: files.length,
        bytes: files.reduce((total, file) => total + file.bytes, 0),
      },
    };
    const manifestPath = path.join(temporaryDir, "showcase-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await replaceOutput(temporaryDir, outputDir, outputExists);
    return {
      outputDir,
      manifestPath: path.join(outputDir, "showcase-manifest.json"),
      manifest,
    };
  } catch (error) {
    if (await pathExists(temporaryDir)) {
      await rm(temporaryDir, { recursive: true, force: true });
    }
    throw error;
  }
}
