import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { Finding, SourceLocation } from "@topo/schema";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mdx",
  ".mjs",
  ".svelte",
  ".ts",
  ".tsx",
  ".vue",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".topo",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export interface StaticAnalysisOptions {
  ignore?: string[];
  maxFindings?: number;
}

export interface StaticAnalysisResult {
  findings: Finding[];
  filesScanned: number;
}

export interface StaticAnalysisSession {
  /** Omitted paths perform complete discovery; supplied paths update the snapshot. */
  scan(changedPaths?: readonly string[]): Promise<StaticAnalysisResult>;
}

interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function sourceLocation(file: SourceFile, lineNumber: number): SourceLocation {
  return { filePath: file.relativePath, line: lineNumber };
}

function findingId(
  rule: string,
  file: SourceFile,
  lineNumber: number,
  text: string,
): string {
  const digest = createHash("sha1")
    .update(`${rule}:${file.relativePath}:${lineNumber}:${text}`)
    .digest("hex")
    .slice(0, 16);
  return `static:${rule}:${digest}`;
}

function makeFinding(
  rule: string,
  file: SourceFile,
  lineNumber: number,
  title: string,
  description: string,
  evidence: string[],
  confidence = 0.7,
): Finding {
  return {
    id: findingId(rule, file, lineNumber, evidence.join("\n")),
    severity: "low",
    status: "open",
    title,
    description,
    source: sourceLocation(file, lineNumber),
    evidence,
    confidence,
  };
}

async function walkSourceFiles(
  rootDir: string,
  ignored: Set<string>,
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (IGNORED_DIRECTORIES.has(entry.name) || ignored.has(entry.name))
      )
        continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      const relativePath = normalizePath(path.relative(rootDir, absolutePath));
      if (/\.(test|spec|stories)\./.test(relativePath)) continue;
      files.push({ absolutePath, relativePath });
    }
  }

  await visit(rootDir);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function isRecognizedButtonAction(tag: string): boolean {
  return /(?:\b(?:onClick|onclick|on:click|v-on:click)|@click)\s*=|\btype\s*=\s*["']submit["']|\b(?:formAction|formaction)\s*=|(?:\b|:)(?:disabled|bind:disabled|v-bind:disabled)(?=\s|=|\/?>)/.test(
    tag,
  );
}

function isDestructiveLabel(value: string): boolean {
  return /\b(delete|remove|destroy|pay|payment|purchase|cancel|send|logout|log out|sign out|irreversible)\b/i.test(
    value,
  );
}

function ignoredSourcePath(
  relativePath: string,
  ignored: Set<string>,
): boolean {
  return relativePath
    .split("/")
    .filter(Boolean)
    .some(
      (segment) => IGNORED_DIRECTORIES.has(segment) || ignored.has(segment),
    );
}

function normalizeChangedPath(value: string): string | undefined {
  const normalized = path.posix
    .normalize(value.replaceAll("\\", "/"))
    .replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function shouldAnalyze(relativePath: string): boolean {
  return (
    SOURCE_EXTENSIONS.has(path.posix.extname(relativePath)) &&
    !/\.(test|spec|stories)\./.test(relativePath)
  );
}

function analyzeSource(
  file: SourceFile,
  source: string,
  maxFindings: number,
): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split(/\r?\n/);
  for (
    let index = 0;
    index < lines.length && findings.length < maxFindings;
    index += 1
  ) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    for (const match of line.matchAll(/<button\b[^>]*>/gi)) {
      const tag = match[0];
      if (!isRecognizedButtonAction(tag) && !isDestructiveLabel(line)) {
        findings.push(
          makeFinding(
            "button-without-action",
            file,
            lineNumber,
            "Button may be inert",
            "This button has no recognized click handler, form submission, or disabled state. Static analysis cannot prove it is broken; verify it with an isolated runtime probe.",
            [`${file.relativePath}:${lineNumber}`, tag.trim()],
          ),
        );
      }
    }

    for (const match of line.matchAll(
      /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi,
    )) {
      const href = match[1] ?? "";
      if (href !== "" && href !== "#" && !/^javascript:/i.test(href)) continue;
      findings.push(
        makeFinding(
          "placeholder-link",
          file,
          lineNumber,
          "Link has a placeholder destination",
          "This anchor points to an empty, hash, or javascript destination and may not provide useful navigation.",
          [`${file.relativePath}:${lineNumber}`, match[0].trim()],
          0.9,
        ),
      );
    }

    for (const match of line.matchAll(
      /<(div|span)\b[^>]*(?:\b(?:onClick|onclick|on:click|v-on:click)|@click)\s*=\s*[^>]*>/gi,
    )) {
      const tag = match[0];
      if (
        /\brole\s*=|\btabindex\s*=|(?:\b(?:onKeyDown|onkeydown|on:keydown|v-on:keydown)|@keydown)\s*=/i.test(
          tag,
        )
      )
        continue;
      findings.push(
        makeFinding(
          "nonsemantic-click-target",
          file,
          lineNumber,
          "Clickable nonsemantic element may be inaccessible",
          "A div or span has a click handler without a role, keyboard handler, or tab index visible to static analysis.",
          [`${file.relativePath}:${lineNumber}`, tag.trim()],
          0.8,
        ),
      );
    }

    if (
      /<form\b/i.test(line) &&
      !/(?:\b(?:onSubmit|onsubmit|on:submit|v-on:submit)|@submit)\s*=|\baction\s*=|\b(?:formAction|formaction)\s*=/.test(
        line,
      )
    ) {
      findings.push(
        makeFinding(
          "form-without-submit-path",
          file,
          lineNumber,
          "Form has no recognized submission path",
          "The form opening tag does not expose an onSubmit, action, or formAction handler to static analysis.",
          [`${file.relativePath}:${lineNumber}`, line.trim()],
          0.65,
        ),
      );
    }
  }
  return findings.slice(0, maxFindings);
}

function projectResult(
  findingsByPath: ReadonlyMap<string, readonly Finding[]>,
  maxFindings: number,
): StaticAnalysisResult {
  const paths = [...findingsByPath.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    findings: paths
      .flatMap((filePath) => findingsByPath.get(filePath) ?? [])
      .slice(0, maxFindings),
    filesScanned: paths.length,
  };
}

export function createStaticAnalysisSession(
  rootDir: string,
  options: StaticAnalysisOptions = {},
): StaticAnalysisSession {
  const absoluteRoot = path.resolve(rootDir);
  const ignored = new Set(options.ignore ?? []);
  const maxFindings = options.maxFindings ?? 500;
  let findingsByPath: Map<string, readonly Finding[]> | undefined;
  let queue = Promise.resolve();

  const discover = async (): Promise<StaticAnalysisResult> => {
    const files = await walkSourceFiles(absoluteRoot, ignored);
    const entries = await Promise.all(
      files.map(async (file) => {
        const source = await fs.readFile(file.absolutePath, "utf8");
        return [
          file.relativePath,
          analyzeSource(file, source, maxFindings),
        ] as const;
      }),
    );
    findingsByPath = new Map(entries);
    return projectResult(findingsByPath, maxFindings);
  };

  const refresh = async (
    changedPaths: readonly string[],
  ): Promise<StaticAnalysisResult> => {
    if (!findingsByPath) return discover();
    const normalized = [...new Set(changedPaths.map(normalizeChangedPath))];
    if (!normalized.every((item): item is string => item !== undefined)) {
      return discover();
    }

    for (const relativePath of normalized) {
      if (ignoredSourcePath(relativePath, ignored)) continue;
      if (!shouldAnalyze(relativePath)) {
        findingsByPath.delete(relativePath);
        continue;
      }
      const absolutePath = path.resolve(
        absoluteRoot,
        ...relativePath.split("/"),
      );
      try {
        const stats = await fs.stat(absolutePath);
        if (stats.isDirectory()) return discover();
        const file = { absolutePath, relativePath };
        const source = await fs.readFile(absolutePath, "utf8");
        findingsByPath.set(
          relativePath,
          analyzeSource(file, source, maxFindings),
        );
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        findingsByPath.delete(relativePath);
      }
    }
    return projectResult(findingsByPath, maxFindings);
  };

  return {
    scan(changedPaths) {
      const next = queue.then(() =>
        changedPaths === undefined ? discover() : refresh(changedPaths),
      );
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

export async function analyzeStaticWorkspace(
  rootDir: string,
  options: StaticAnalysisOptions = {},
): Promise<StaticAnalysisResult> {
  return createStaticAnalysisSession(rootDir, options).scan();
}
