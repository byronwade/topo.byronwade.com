import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DOCUMENTATION_POLICY,
  type ChangeType,
  type FeatureStatus,
} from "./policy.js";
import { validateAutomationWorkflows } from "./workflow-contract.js";

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export interface ProductFeature {
  id: string;
  title: string;
  summary: string;
  category: string;
  status: FeatureStatus;
  since?: string;
  updatedAt: string;
  docs: string[];
  evidence: string[];
  removedIn?: string;
  migration?: string;
}

export interface ProductPlan {
  id: string;
  name: string;
  availability: "available" | "considering" | "planned";
  priceLabel: string;
  summary: string;
  features: string[];
}

export interface ProductManifest {
  schemaVersion: 1;
  productVersion: string;
  updatedAt: string;
  repository: string;
  distribution: {
    status: "source-preview" | "package-preview" | "released";
    packageName: string;
    packagePublished: boolean;
  };
  plans: ProductPlan[];
  features: ProductFeature[];
}

export interface FeatureChange {
  id: string;
  type: ChangeType;
  fingerprint: string;
}

export interface ProductChange {
  id: string;
  date: string;
  summary: string;
  features: FeatureChange[];
}

export interface ProductChangeLog {
  schemaVersion: 1;
  changes: ProductChange[];
}

export interface DocumentationIssue {
  code: string;
  message: string;
  filePath?: string;
}

export interface DocumentationReport {
  ok: boolean;
  checkedFiles: number;
  featureCount: number;
  issues: DocumentationIssue[];
}

interface Frontmatter {
  title?: string;
  description?: string;
  public?: string;
  order?: string;
  updated?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseProductManifest(value: unknown): ProductManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("docs/product.json must use schemaVersion 1");
  }
  if (!Array.isArray(value.features) || !Array.isArray(value.plans)) {
    throw new Error("docs/product.json must define features and plans arrays");
  }
  const distribution = value.distribution;
  if (!isRecord(distribution)) {
    throw new Error("docs/product.json must define distribution metadata");
  }
  return {
    schemaVersion: 1,
    productVersion: String(value.productVersion ?? ""),
    updatedAt: String(value.updatedAt ?? ""),
    repository: String(value.repository ?? ""),
    distribution: {
      status: String(
        distribution.status,
      ) as ProductManifest["distribution"]["status"],
      packageName: String(distribution.packageName ?? ""),
      packagePublished: distribution.packagePublished === true,
    },
    plans: value.plans.map((item) => {
      if (!isRecord(item))
        throw new Error("Every product plan must be an object");
      return {
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        availability: String(item.availability) as ProductPlan["availability"],
        priceLabel: String(item.priceLabel ?? ""),
        summary: String(item.summary ?? ""),
        features: normalizeList(item.features),
      };
    }),
    features: value.features.map((item) => {
      if (!isRecord(item))
        throw new Error("Every product feature must be an object");
      return {
        id: String(item.id ?? ""),
        title: String(item.title ?? ""),
        summary: String(item.summary ?? ""),
        category: String(item.category ?? ""),
        status: String(item.status) as FeatureStatus,
        since: typeof item.since === "string" ? item.since : undefined,
        updatedAt: String(item.updatedAt ?? ""),
        docs: normalizeList(item.docs),
        evidence: normalizeList(item.evidence),
        removedIn:
          typeof item.removedIn === "string" ? item.removedIn : undefined,
        migration:
          typeof item.migration === "string" ? item.migration : undefined,
      };
    }),
  };
}

export function parseProductChangeLog(value: unknown): ProductChangeLog {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.changes)
  ) {
    throw new Error(
      "docs/product-changes.json must use schemaVersion 1 and define changes",
    );
  }
  return {
    schemaVersion: 1,
    changes: value.changes.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.features)) {
        throw new Error("Every product change must define feature entries");
      }
      return {
        id: String(item.id ?? ""),
        date: String(item.date ?? ""),
        summary: String(item.summary ?? ""),
        features: item.features.map((feature) => {
          if (!isRecord(feature))
            throw new Error("Every changed feature must be an object");
          return {
            id: String(feature.id ?? ""),
            type: String(feature.type) as ChangeType,
            fingerprint: String(feature.fingerprint ?? ""),
          };
        }),
      };
    }),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function featureFingerprint(feature: ProductFeature): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(feature)))
    .digest("hex");
}

function parseFrontmatter(markdown: string): Frontmatter | undefined {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing === -1) return undefined;
  const result: Frontmatter = {};
  for (const line of normalized.slice(4, closing).split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim() as keyof Frontmatter;
    const raw = line.slice(separator + 1).trim();
    result[key] = raw.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function markdownAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function markdownAnchors(markdown: string): Set<string> {
  return new Set(
    markdown
      .split(/\r?\n/)
      .filter((line) => /^#{1,6}\s+/.test(line))
      .map((line) => markdownAnchor(line.replace(/^#{1,6}\s+/, ""))),
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function markdownFiles(rootDir: string): Promise<string[]> {
  const files = ["README.md", "AGENTS.md"];
  const docsDir = path.join(rootDir, "docs");
  for (const name of await readdir(docsDir)) {
    if (name.endsWith(".md"))
      files.push(path.join("docs", name).replace(/\\/g, "/"));
  }
  return files.sort();
}

function localLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1]?.trim())
    .filter((href): href is string => Boolean(href))
    .filter(
      (href) =>
        !href.startsWith("http://") &&
        !href.startsWith("https://") &&
        !href.startsWith("mailto:") &&
        !href.startsWith("#"),
    );
}

export function renderProductChangelog(
  manifest: ProductManifest,
  changeLog: ProductChangeLog,
): string {
  const names = new Map(
    manifest.features.map((feature) => [feature.id, feature.title]),
  );
  const latestDate = changeLog.changes[0]?.date ?? manifest.updatedAt;
  const lines = [
    "---",
    'title: "Product changelog"',
    'description: "Added, changed, and removed Topo capabilities."',
    "public: true",
    "order: 90",
    `updated: ${latestDate}`,
    "generated: true",
    "---",
    "",
    "# Product changelog",
    "",
    "This file is generated from `docs/product-changes.json`. Run `pnpm docs:record` instead of editing it directly.",
    "",
  ];
  for (const change of changeLog.changes) {
    lines.push(`## ${change.date} — ${change.summary}`, "");
    for (const feature of change.features) {
      lines.push(
        `- **${feature.type}:** ${names.get(feature.id) ?? feature.id}`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export async function validateDocumentation(
  rootDir: string,
): Promise<DocumentationReport> {
  const root = path.resolve(rootDir);
  const issues: DocumentationIssue[] = [];
  const existenceCache = new Map<string, Promise<boolean>>();
  const fileExists = (filePath: string): Promise<boolean> => {
    const absolutePath = path.resolve(root, filePath);
    const cached = existenceCache.get(absolutePath);
    if (cached) return cached;
    const result = exists(absolutePath);
    existenceCache.set(absolutePath, result);
    return result;
  };
  let manifest: ProductManifest;
  let changeLog: ProductChangeLog;
  const issue = (code: string, message: string, filePath?: string) =>
    issues.push({ code, message, filePath });

  try {
    manifest = parseProductManifest(
      JSON.parse(
        await readFile(path.join(root, "docs", "product.json"), "utf8"),
      ) as unknown,
    );
  } catch (error) {
    issue(
      "product-manifest",
      error instanceof Error ? error.message : "Invalid product manifest",
      "docs/product.json",
    );
    return { ok: false, checkedFiles: 0, featureCount: 0, issues };
  }
  try {
    changeLog = parseProductChangeLog(
      JSON.parse(
        await readFile(path.join(root, "docs", "product-changes.json"), "utf8"),
      ) as unknown,
    );
  } catch (error) {
    issue(
      "product-changes",
      error instanceof Error ? error.message : "Invalid product change log",
      "docs/product-changes.json",
    );
    return {
      ok: false,
      checkedFiles: 1,
      featureCount: manifest.features.length,
      issues,
    };
  }

  const rootPackage = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ) as { version?: string };
  if (manifest.productVersion !== rootPackage.version) {
    issue(
      "version-drift",
      `Product version ${manifest.productVersion} does not match package version ${rootPackage.version}.`,
      "docs/product.json",
    );
  }

  for (const filePath of [
    ...DOCUMENTATION_POLICY.requiredDocuments,
    ...DOCUMENTATION_POLICY.requiredPublicRoutes,
  ]) {
    if (!(await fileExists(filePath)))
      issue(
        "missing-required-file",
        `Required file is missing: ${filePath}`,
        filePath,
      );
  }

  issues.push(...(await validateAutomationWorkflows(root)));

  const markdown = await markdownFiles(root);
  const markdownContent = new Map<string, string>();
  const frontmatter = new Map<string, Frontmatter>();
  for (const filePath of markdown) {
    const content = await readFile(path.join(root, filePath), "utf8");
    markdownContent.set(filePath, content);
    if (filePath.startsWith("docs/")) {
      const metadata = parseFrontmatter(content);
      if (
        !metadata?.title ||
        !metadata.description ||
        !metadata.updated ||
        !metadata.public
      ) {
        issue(
          "frontmatter",
          "Documentation requires title, description, public, and updated frontmatter.",
          filePath,
        );
      } else {
        frontmatter.set(filePath, metadata);
      }
    }
  }

  // Evidence and link checks can touch hundreds of files. Start every unique
  // filesystem lookup together so repository validation remains quick on
  // Windows as well as Unix filesystems. The cache keeps repeated evidence
  // and documentation references to the same path to one lookup.
  const pathsToCheck = new Set<string>([
    ...DOCUMENTATION_POLICY.requiredDocuments,
    ...DOCUMENTATION_POLICY.requiredPublicRoutes,
    "docs/CHANGELOG.md",
  ]);
  for (const feature of manifest.features) {
    for (const evidencePath of feature.evidence) pathsToCheck.add(evidencePath);
    for (const reference of feature.docs) {
      const [filePath] = reference.split("#", 1);
      if (filePath) pathsToCheck.add(filePath);
    }
  }
  for (const [filePath, content] of markdownContent) {
    for (const href of localLinks(content)) {
      const [target] = href.split("#", 1);
      if (target)
        pathsToCheck.add(path.resolve(root, path.dirname(filePath), target));
    }
  }
  await Promise.all([...pathsToCheck].map((filePath) => fileExists(filePath)));

  const featureIds = new Set<string>();
  for (const feature of manifest.features) {
    if (!feature.id || featureIds.has(feature.id))
      issue(
        "feature-id",
        `Feature id is empty or duplicated: ${feature.id}`,
        "docs/product.json",
      );
    featureIds.add(feature.id);
    if (!DOCUMENTATION_POLICY.featureStatuses.includes(feature.status))
      issue(
        "feature-status",
        `Unsupported status ${feature.status} on ${feature.id}.`,
        "docs/product.json",
      );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(feature.updatedAt))
      issue(
        "feature-date",
        `Feature ${feature.id} needs an ISO date in updatedAt.`,
        "docs/product.json",
      );
    if (
      (feature.status === "available" || feature.status === "preview") &&
      feature.evidence.length === 0
    )
      issue(
        "feature-evidence",
        `${feature.id} is ${feature.status} but has no implementation evidence.`,
        "docs/product.json",
      );
    if (feature.docs.length === 0)
      issue(
        "feature-docs",
        `${feature.id} has no canonical documentation reference.`,
        "docs/product.json",
      );
    if (
      feature.status === "removed" &&
      (!feature.removedIn || !feature.migration)
    )
      issue(
        "removed-feature",
        `${feature.id} is removed but has no removedIn version or migration reference.`,
        "docs/product.json",
      );

    for (const evidencePath of feature.evidence) {
      if (!(await fileExists(evidencePath)))
        issue(
          "missing-evidence",
          `${feature.id} evidence does not exist: ${evidencePath}`,
          "docs/product.json",
        );
    }
    for (const reference of feature.docs) {
      const [filePath, anchor] = reference.split("#", 2);
      if (!filePath || !(await fileExists(filePath))) {
        issue(
          "missing-feature-doc",
          `${feature.id} documentation does not exist: ${reference}`,
          "docs/product.json",
        );
        continue;
      }
      const content =
        markdownContent.get(filePath) ??
        (await readFile(path.join(root, filePath), "utf8"));
      if (anchor && !markdownAnchors(content).has(anchor))
        issue(
          "missing-doc-anchor",
          `${feature.id} references a missing heading: ${reference}`,
          filePath,
        );
      const metadata = frontmatter.get(filePath) ?? parseFrontmatter(content);
      if (metadata?.updated && metadata.updated < feature.updatedAt)
        issue(
          "stale-feature-doc",
          `${reference} predates the latest ${feature.id} change (${feature.updatedAt}).`,
          filePath,
        );
    }
  }

  for (const plan of manifest.plans) {
    if (!DOCUMENTATION_POLICY.planAvailability.includes(plan.availability))
      issue(
        "plan-availability",
        `Plan ${plan.id} has unsupported availability ${plan.availability}.`,
        "docs/product.json",
      );
    for (const featureId of plan.features) {
      if (!featureIds.has(featureId))
        issue(
          "plan-feature",
          `Plan ${plan.id} references unknown feature ${featureId}.`,
          "docs/product.json",
        );
    }
  }

  const latestChanges = new Map<string, FeatureChange>();
  for (const change of changeLog.changes) {
    for (const feature of change.features) {
      if (!latestChanges.has(feature.id))
        latestChanges.set(feature.id, feature);
    }
  }
  for (const feature of manifest.features) {
    const change = latestChanges.get(feature.id);
    if (!change) {
      issue(
        "unrecorded-feature",
        `${feature.id} has no product change record.`,
        "docs/product-changes.json",
      );
    } else if (change.fingerprint !== featureFingerprint(feature)) {
      issue(
        "unrecorded-change",
        `${feature.id} changed without a matching docs:record entry.`,
        "docs/product-changes.json",
      );
    }
  }

  const generatedChangelog = renderProductChangelog(manifest, changeLog);
  const changelogPath = path.join(root, "docs", "CHANGELOG.md");
  if (
    (await fileExists(changelogPath)) &&
    normalizeLineEndings(await readFile(changelogPath, "utf8")) !==
      normalizeLineEndings(generatedChangelog)
  ) {
    issue(
      "changelog-drift",
      "docs/CHANGELOG.md is not synchronized with product-changes.json.",
      "docs/CHANGELOG.md",
    );
  }

  for (const [filePath, content] of markdownContent) {
    for (const href of localLinks(content)) {
      const [target, anchor] = href.split("#", 2);
      if (!target) continue;
      const absoluteTarget = path.resolve(root, path.dirname(filePath), target);
      if (!(await fileExists(absoluteTarget))) {
        issue("broken-link", `Broken local link: ${href}`, filePath);
      } else if (anchor && absoluteTarget.endsWith(".md")) {
        const targetContent = await readFile(absoluteTarget, "utf8");
        if (!markdownAnchors(targetContent).has(anchor))
          issue("broken-anchor", `Broken Markdown anchor: ${href}`, filePath);
      }
    }
  }

  return {
    ok: issues.length === 0,
    checkedFiles: markdown.length + 4,
    featureCount: manifest.features.length,
    issues,
  };
}

export async function recordProductChange(
  rootDir: string,
  input: {
    id: string;
    date: string;
    summary: string;
    type: ChangeType;
    featureIds?: string[];
  },
): Promise<ProductChange> {
  const root = path.resolve(rootDir);
  const manifest = parseProductManifest(
    JSON.parse(
      await readFile(path.join(root, "docs", "product.json"), "utf8"),
    ) as unknown,
  );
  const changesPath = path.join(root, "docs", "product-changes.json");
  const changeLog = parseProductChangeLog(
    JSON.parse(await readFile(changesPath, "utf8")) as unknown,
  );
  const selected = input.featureIds?.length
    ? manifest.features.filter((feature) =>
        input.featureIds?.includes(feature.id),
      )
    : manifest.features;
  if (selected.length === 0)
    throw new Error("No matching product features were selected");
  const change: ProductChange = {
    id: input.id,
    date: input.date,
    summary: input.summary,
    features: selected.map((feature) => ({
      id: feature.id,
      type: feature.status === "removed" ? "removed" : input.type,
      fingerprint: featureFingerprint(feature),
    })),
  };
  changeLog.changes = [
    change,
    ...changeLog.changes.filter((item) => item.id !== input.id),
  ];
  await writeFile(
    changesPath,
    `${JSON.stringify(changeLog, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(root, "docs", "CHANGELOG.md"),
    renderProductChangelog(manifest, changeLog),
    "utf8",
  );
  return change;
}
