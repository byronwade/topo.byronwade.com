import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  chmod,
  link,
  lstat,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";

import { parseModule, type ParsedExport } from "@topo/parser-oxc";
import type { ComponentNode } from "@topo/schema";

export const COMPONENT_PREVIEW_SCAFFOLD_VERSION = 1 as const;

export type ComponentPreviewScaffoldMode = "ready" | "fixture-required";

export interface ComponentPreviewScaffoldInput {
  sourceRoot: string;
  component: Pick<ComponentNode, "id" | "name" | "source">;
}

export interface ComponentPreviewScaffoldConflict {
  path: string;
  reason: "target-exists";
}

export interface ComponentPreviewScaffoldPlan {
  schemaVersion: typeof COMPONENT_PREVIEW_SCAFFOLD_VERSION;
  componentId: string;
  componentName: string;
  componentSource: string;
  previewSource: string;
  exportName: string;
  exportKind: ParsedExport["kind"];
  requiredProps: number;
  mode: ComponentPreviewScaffoldMode;
  canApply: boolean;
  sourceHash: string;
  templateHash: string;
  bytes: number;
  conflicts: ComponentPreviewScaffoldConflict[];
}

export interface ComponentPreviewScaffoldResult extends ComponentPreviewScaffoldPlan {
  status: "created";
  createdAt: string;
}

export type ComponentPreviewScaffoldErrorCode =
  | "invalid-source"
  | "source-outside-root"
  | "source-link-outside-root"
  | "missing-export"
  | "target-exists";

export class ComponentPreviewScaffoldError extends Error {
  constructor(
    readonly code: ComponentPreviewScaffoldErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ComponentPreviewScaffoldError";
  }
}

interface PreparedScaffold {
  plan: ComponentPreviewScaffoldPlan;
  targetPath: string;
  content: string;
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/i;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedSourcePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new ComponentPreviewScaffoldError(
      "source-outside-root",
      "Component source paths must be relative to the application source root.",
    );
  }
  const normalized = filePath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !SOURCE_EXTENSION.test(normalized) ||
    normalized.includes(".topo.")
  ) {
    throw new ComponentPreviewScaffoldError(
      "invalid-source",
      `Component source "${filePath}" cannot own a colocated Topo preview.`,
    );
  }
  return normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function chooseExport(
  exports: readonly ParsedExport[],
  componentName: string,
): ParsedExport | undefined {
  const callable = exports.filter(
    (candidate) =>
      candidate.runtimeKind === "function" ||
      candidate.runtimeKind === "arrow" ||
      candidate.runtimeKind === "class" ||
      candidate.runtimeKind === "reference",
  );
  return (
    callable.find((candidate) => candidate.name === componentName) ??
    callable.find((candidate) => candidate.name === "default") ??
    (callable.length === 1 ? callable[0] : undefined)
  );
}

function importStatement(
  selected: ParsedExport,
  componentName: string,
  modulePath: string,
): string {
  if (selected.name === "default") {
    return `import PreviewComponent from ${JSON.stringify(modulePath)};`;
  }
  if (!IDENTIFIER.test(selected.name)) {
    throw new ComponentPreviewScaffoldError(
      "missing-export",
      `Component "${componentName}" does not expose a scaffoldable JavaScript export.`,
    );
  }
  return `import { ${selected.name} as PreviewComponent } from ${JSON.stringify(modulePath)};`;
}

function previewTemplate(
  selected: ParsedExport,
  componentName: string,
  modulePath: string,
): { content: string; mode: ComponentPreviewScaffoldMode } {
  const componentImport = importStatement(selected, componentName, modulePath);
  if (selected.requiredProps === 0) {
    return {
      mode: "ready",
      content: `${componentImport}

export function Default() {
  return <PreviewComponent />;
}
`,
    };
  }

  return {
    mode: "fixture-required",
    content: `import type { ComponentProps } from "react";
${componentImport}

type PreviewProps = ComponentProps<typeof PreviewComponent>;

/**
 * Add deterministic local fixture values for every required prop.
 * Do not place credentials, production data, or environment values here.
 */
const fixture = {
  // TODO: add required ${componentName} props.
} satisfies Partial<PreviewProps>;

void fixture;

// When the fixture is complete, enable the preview:
// export function Default() {
//   return <PreviewComponent {...(fixture as PreviewProps)} />;
// }
`,
  };
}

async function prepareScaffold(
  input: ComponentPreviewScaffoldInput,
): Promise<PreparedScaffold> {
  const componentSource = normalizedSourcePath(input.component.source.filePath);
  const sourceRoot = await realpath(path.resolve(input.sourceRoot));
  const requestedSource = path.resolve(sourceRoot, componentSource);
  if (!isInside(sourceRoot, requestedSource)) {
    throw new ComponentPreviewScaffoldError(
      "source-outside-root",
      `Component source "${componentSource}" escapes the application source root.`,
    );
  }
  let sourcePath: string;
  try {
    sourcePath = await realpath(requestedSource);
  } catch {
    throw new ComponentPreviewScaffoldError(
      "invalid-source",
      `Component source "${componentSource}" does not exist.`,
    );
  }
  if (!isInside(sourceRoot, sourcePath)) {
    throw new ComponentPreviewScaffoldError(
      "source-link-outside-root",
      `Component source "${componentSource}" resolves outside the application source root.`,
    );
  }
  const sourceStat = await lstat(sourcePath);
  if (!sourceStat.isFile()) {
    throw new ComponentPreviewScaffoldError(
      "invalid-source",
      `Component source "${componentSource}" is not a file.`,
    );
  }

  const source = await readFile(sourcePath, "utf8");
  const parsed = parseModule(source, componentSource);
  const selected = chooseExport(parsed.exports, input.component.name);
  if (!selected) {
    throw new ComponentPreviewScaffoldError(
      "missing-export",
      `Component "${input.component.name}" has no unambiguous callable export to scaffold.`,
    );
  }

  const previewSource = componentSource.replace(SOURCE_EXTENSION, ".topo.tsx");
  const targetPath = path.resolve(sourceRoot, previewSource);
  const targetParent = await realpath(path.dirname(targetPath));
  if (
    !isInside(sourceRoot, targetParent) ||
    !isInside(targetParent, targetPath)
  ) {
    throw new ComponentPreviewScaffoldError(
      "source-link-outside-root",
      `Preview target "${previewSource}" resolves outside the application source root.`,
    );
  }
  const importBase = path
    .basename(componentSource)
    .replace(SOURCE_EXTENSION, "");
  const template = previewTemplate(
    selected,
    input.component.name,
    `./${importBase}`,
  );
  const conflicts: ComponentPreviewScaffoldConflict[] = [];
  try {
    await lstat(targetPath);
    conflicts.push({ path: previewSource, reason: "target-exists" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    targetPath,
    content: template.content,
    plan: {
      schemaVersion: COMPONENT_PREVIEW_SCAFFOLD_VERSION,
      componentId: input.component.id,
      componentName: input.component.name,
      componentSource,
      previewSource,
      exportName: selected.name,
      exportKind: selected.kind,
      requiredProps: selected.requiredProps,
      mode: template.mode,
      canApply: conflicts.length === 0,
      sourceHash: sha256(source),
      templateHash: sha256(template.content),
      bytes: Buffer.byteLength(template.content),
      conflicts,
    },
  };
}

/** Inspect the exact source-aware create operation without writing. */
export async function inspectComponentPreviewScaffold(
  input: ComponentPreviewScaffoldInput,
): Promise<ComponentPreviewScaffoldPlan> {
  return (await prepareScaffold(input)).plan;
}

/** Create one colocated preview without overwriting or following linked targets. */
export async function createComponentPreviewScaffold(
  input: ComponentPreviewScaffoldInput,
): Promise<ComponentPreviewScaffoldResult> {
  const prepared = await prepareScaffold(input);
  if (!prepared.plan.canApply) {
    throw new ComponentPreviewScaffoldError(
      "target-exists",
      `Preview target "${prepared.plan.previewSource}" already exists; Topo did not change it.`,
    );
  }

  const temporaryPath = path.join(
    path.dirname(prepared.targetPath),
    `.topo-preview-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, prepared.content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    try {
      await link(temporaryPath, prepared.targetPath);
      await chmod(prepared.targetPath, 0o644);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ComponentPreviewScaffoldError(
          "target-exists",
          `Preview target "${prepared.plan.previewSource}" already exists; Topo did not change it.`,
        );
      }
      throw error;
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }

  return {
    ...prepared.plan,
    status: "created",
    createdAt: new Date().toISOString(),
  };
}
