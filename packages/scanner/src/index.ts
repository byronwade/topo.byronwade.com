import { promises as fs } from "node:fs";
import path from "node:path";

import {
  FrameworkAdapterContractError,
  createFrameworkAdapterRegistry,
  type DiscoveredRoute,
  type FrameworkAdapter,
  type FrameworkAdapterContext,
  type FrameworkAdapterScan,
} from "@topo/framework-adapter";
import {
  createApiEndpointAdapterRegistry,
  type ApiEndpointAdapter,
  type ApiEndpointAdapterContext,
  type ApiEndpointAdapterScan,
  type DiscoveredApiEndpoint,
} from "@topo/endpoint-adapter";
import {
  createFlowDiscoveryAdapterRegistry,
  type DiscoveredFlowTransition,
  type FlowDiscoveryAdapter,
  type FlowDiscoveryAdapterContext,
} from "@topo/flow-adapter";
import {
  createComponentPreviewAdapterRegistry,
  type ComponentPreviewAdapter,
  type DiscoveredComponentPreview,
} from "@topo/preview-adapter";
import { parseModules, type ParsedModule } from "@topo/parser-oxc";
import {
  type ApplicationGraph,
  type ApiEndpointNode,
  type ComponentNode,
  type Finding,
  type FlowTransition,
  type Framework,
  type InferredFlow,
  type PreviewRouteExamples,
  type ProjectRecognition,
  type ScreenNode,
  emptyApplicationGraph,
  resolveScreenPreviewRoute,
} from "@topo/schema";

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
const API_CONTRACT_FILE =
  /^(?:openapi|swagger)(?:[._-][^.]+)*\.(?:json|ya?ml)$/i;
const PARSABLE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".topo",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export interface ScanOptions {
  adapters: readonly FrameworkAdapter[];
  endpointAdapters?: readonly ApiEndpointAdapter[];
  flowAdapters?: readonly FlowDiscoveryAdapter[];
  previewAdapters?: readonly ComponentPreviewAdapter[];
  ignore?: readonly string[];
  previewRoutes?: PreviewRouteExamples;
}

function isTrackedSourcePath(filePath: string): boolean {
  return (
    SOURCE_EXTENSIONS.has(path.posix.extname(filePath)) ||
    API_CONTRACT_FILE.test(path.posix.basename(filePath))
  );
}

/**
 * A serialized, project-local source snapshot. Omitting changed paths performs
 * full discovery; supplying paths updates only those entries before rebuilding
 * the normalized graph through the same adapter contracts.
 */
export interface ScannerSession {
  scan(changedPaths?: readonly string[]): Promise<ApplicationGraph>;
}

interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

interface RouteCandidate extends DiscoveredRoute {
  adapterId: string;
  file: SourceFile;
}

interface SourceReadModel {
  sourceByPath: ReadonlyMap<string, string>;
  parsedByPath: ReadonlyMap<string, ParsedModule>;
  dependenciesByPath: ReadonlyMap<string, readonly string[]>;
}

interface CachedSource {
  source: string;
  error?: unknown;
}

interface SourceSnapshot {
  files: SourceFile[];
  sourcesByPath: Map<string, CachedSource>;
  packageNames: Set<string>;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function titleFromRoute(routePath: string, state: ScreenNode["state"]): string {
  if (state !== "default") return `${routePath} · ${state}`;
  if (routePath === "/") return "Home";

  return routePath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/^\[(\.\.\.)?/, "").replace(/\]?$/, ""))
    .map((segment) => segment.replace(/[-_]/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" / ");
}

function groupFromRoute(routePath: string): string {
  const firstSegment = routePath.split("/").filter(Boolean)[0];
  return firstSegment ? `/${firstSegment}` : "/";
}

async function walkSourceFiles(
  rootDir: string,
  ignored: Set<string>,
): Promise<SourceFile[]> {
  const result: SourceFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (IGNORED_DIRECTORY_NAMES.has(entry.name) || ignored.has(entry.name))
      )
        continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (isTrackedSourcePath(entry.name)) {
        result.push({
          absolutePath,
          relativePath: normalizePath(path.relative(rootDir, absolutePath)),
        });
      }
    }
  }

  await visit(rootDir);
  return result.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function readPackageNames(rootDir: string): Promise<Set<string>> {
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(rootDir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function ignoredSourcePath(
  relativePath: string,
  ignored: Set<string>,
): boolean {
  return relativePath
    .split("/")
    .filter(Boolean)
    .some(
      (segment) => IGNORED_DIRECTORY_NAMES.has(segment) || ignored.has(segment),
    );
}

async function readCachedSource(file: SourceFile): Promise<CachedSource> {
  try {
    return { source: await fs.readFile(file.absolutePath, "utf8") };
  } catch (error) {
    return { source: "", error };
  }
}

async function discoverSourceSnapshot(
  absoluteRoot: string,
  ignored: Set<string>,
): Promise<SourceSnapshot> {
  const [files, packageNames] = await Promise.all([
    walkSourceFiles(absoluteRoot, ignored),
    readPackageNames(absoluteRoot),
  ]);
  const sources = await Promise.all(
    files.map(
      async (file) =>
        [file.relativePath, await readCachedSource(file)] as const,
    ),
  );
  return {
    files,
    sourcesByPath: new Map(sources),
    packageNames,
  };
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

async function refreshSourceSnapshot(
  absoluteRoot: string,
  current: SourceSnapshot,
  changedPaths: readonly string[],
  ignored: Set<string>,
): Promise<SourceSnapshot> {
  const normalizedPaths = [...new Set(changedPaths.map(normalizeChangedPath))];
  if (!normalizedPaths.every((item): item is string => item !== undefined)) {
    return discoverSourceSnapshot(absoluteRoot, ignored);
  }

  const filesByPath = new Map(
    current.files.map((file) => [file.relativePath, file]),
  );
  const sourcesByPath = new Map(current.sourcesByPath);
  let packageNames = current.packageNames;

  for (const relativePath of normalizedPaths) {
    if (ignoredSourcePath(relativePath, ignored)) continue;
    if (relativePath === "package.json") {
      packageNames = await readPackageNames(absoluteRoot);
    }

    const sourceExtension = isTrackedSourcePath(relativePath);
    const knownDirectory = [...filesByPath.keys()].some((filePath) =>
      filePath.startsWith(`${relativePath}/`),
    );

    const absolutePath = path.resolve(absoluteRoot, ...relativePath.split("/"));
    try {
      const stats = await fs.stat(absolutePath);
      if (stats.isDirectory()) {
        return discoverSourceSnapshot(absoluteRoot, ignored);
      }
      if (!sourceExtension) continue;
      const file = { absolutePath, relativePath };
      filesByPath.set(relativePath, file);
      sourcesByPath.set(relativePath, await readCachedSource(file));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      if (knownDirectory) {
        return discoverSourceSnapshot(absoluteRoot, ignored);
      }
      filesByPath.delete(relativePath);
      sourcesByPath.delete(relativePath);
    }
  }

  return {
    files: [...filesByPath.values()].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
    sourcesByPath,
    packageNames,
  };
}

function makeScreen(
  candidate: RouteCandidate,
  index: number,
  previewRoutes: PreviewRouteExamples,
): ScreenNode {
  const stableFilePath = normalizePath(candidate.file.relativePath);
  const tags = [
    ...new Set([...(index === 0 ? ["entry"] : []), ...(candidate.tags ?? [])]),
  ];
  const previewRoute = resolveScreenPreviewRoute(
    candidate.routePath,
    previewRoutes,
  );
  return {
    id: `${candidate.framework}:${candidate.routePath}:${candidate.state}:${stableFilePath}`,
    kind: "screen",
    title:
      candidate.title ?? titleFromRoute(candidate.routePath, candidate.state),
    routePath: candidate.routePath,
    framework: candidate.framework,
    adapterId: candidate.adapterId,
    state: candidate.state,
    group: candidate.group ?? groupFromRoute(candidate.routePath),
    source: { filePath: stableFilePath, line: 1 },
    previewRoute,
    renderStatus: previewRoute.status === "unresolved" ? "blocked" : "unseen",
    tags,
  };
}

function readSourceModel(snapshot: SourceSnapshot): SourceReadModel {
  const files = snapshot.files;
  // Snapshot discovery already completed every source read. Project the
  // immutable cache directly instead of scheduling one promise continuation
  // per file on every graph rebuild (including one-file refreshes).
  const sources = files.map((file) => {
    const cached = snapshot.sourcesByPath.get(file.relativePath);
    return {
      filePath: file.relativePath,
      source: cached && !cached.error ? cached.source : "",
    };
  });
  const sourceByPath = new Map(
    sources.map((item) => [item.filePath, item.source]),
  );
  const parsed = parseModules(
    sources.filter((item) =>
      PARSABLE_EXTENSIONS.has(path.posix.extname(item.filePath)),
    ),
  );
  const parsedByPath = new Map(parsed.map((item) => [item.filePath, item]));
  const filePaths = new Set(files.map((file) => file.relativePath));
  const dependenciesByPath = new Map<string, readonly string[]>();
  for (const item of parsed) {
    dependenciesByPath.set(
      item.filePath,
      item.dependencies.flatMap((specifier) => {
        const resolved = resolveLocalDependency(
          item.filePath,
          specifier,
          filePaths,
        );
        return resolved ? [resolved] : [];
      }),
    );
  }
  return { sourceByPath, parsedByPath, dependenciesByPath };
}

function resolveLocalDependency(
  importer: string,
  rawSpecifier: string,
  filePaths: ReadonlySet<string>,
): string | undefined {
  if (!rawSpecifier.startsWith(".")) return undefined;
  const specifier = rawSpecifier.split(/[?#]/, 1)[0] ?? rawSpecifier;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  );
  if (base === ".." || base.startsWith("../") || base.startsWith("/")) {
    return undefined;
  }
  const extension = path.posix.extname(base);
  const candidates = extension
    ? [base]
    : [
        ...[...PARSABLE_EXTENSIONS].map((item) => `${base}${item}`),
        ...[...PARSABLE_EXTENSIONS].map((item) =>
          path.posix.join(base, `index${item}`),
        ),
      ];
  return candidates.find((candidate) => filePaths.has(candidate));
}

function reachableModules(
  entry: string,
  dependenciesByPath: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const dependency of dependenciesByPath.get(current) ?? []) {
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return visited;
}

function parserFindings(
  parsedByPath: ReadonlyMap<string, ParsedModule>,
): Finding[] {
  return [...parsedByPath.values()].flatMap((module) =>
    module.diagnostics.map((diagnostic, index) => ({
      id: `source-parse:${module.filePath}:${diagnostic.line}:${diagnostic.column}:${index}`,
      severity:
        diagnostic.severity === "error"
          ? ("high" as const)
          : diagnostic.severity === "warning"
            ? ("medium" as const)
            : ("info" as const),
      status: "open" as const,
      title:
        diagnostic.severity === "error"
          ? "Source parse error"
          : "Source parser diagnostic",
      description: `Oxc reported ${diagnostic.message} in ${module.filePath}.`,
      source: {
        filePath: module.filePath,
        line: diagnostic.line,
        column: diagnostic.column,
      },
      evidence: [
        `Parser: ${module.engine}`,
        `Severity: ${diagnostic.severity}`,
        diagnostic.message,
      ],
      confidence: 1,
    })),
  );
}

function previewDraftFindings(
  files: readonly SourceFile[],
  components: readonly ComponentNode[],
  sourceModel: SourceReadModel,
): Finding[] {
  const sourcePaths = new Set(files.map((file) => file.relativePath));
  return components.flatMap((component): Finding[] => {
    const previewSource = component.source.filePath.replace(
      /\.(?:[cm]?[jt]sx?)$/i,
      ".topo.tsx",
    );
    if (
      previewSource === component.source.filePath ||
      !sourcePaths.has(previewSource) ||
      component.previewSources.some(
        (preview) => preview.source.filePath === previewSource,
      )
    ) {
      return [];
    }
    const parsed = sourceModel.parsedByPath.get(previewSource);
    const parseError = parsed?.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    return [
      {
        id: `component-preview-draft:${component.id}`,
        severity: parseError ? "high" : "low",
        status: "open",
        title: parseError
          ? "Component preview draft has a parse error"
          : "Component preview fixture required",
        description: parseError
          ? `${previewSource} cannot become a preview until its source parses successfully.`
          : `${previewSource} exists for ${component.name}, but no active renderable preview export was discovered.`,
        source: {
          filePath: previewSource,
          line: parseError?.line ?? 1,
          ...(parseError ? { column: parseError.column } : {}),
        },
        evidence: [
          `Component: ${component.id}`,
          `Component source: ${component.source.filePath}`,
          parseError?.message ??
            "Add deterministic fixture values, then export a zero-argument preview function.",
        ],
        confidence: 1,
      },
    ];
  });
}

function collectComponents(
  files: SourceFile[],
  screens: ScreenNode[],
  previewContributions: readonly DiscoveredComponentPreview[],
  sourceModel: SourceReadModel,
): ComponentNode[] {
  const previewsByComponent = new Map<string, DiscoveredComponentPreview[]>();
  for (const contribution of previewContributions) {
    const current = previewsByComponent.get(contribution.componentFilePath);
    if (current) current.push(contribution);
    else
      previewsByComponent.set(contribution.componentFilePath, [contribution]);
  }

  const reachableByScreen = new Map(
    screens.map((screen) => [
      screen.id,
      reachableModules(screen.source.filePath, sourceModel.dependenciesByPath),
    ]),
  );

  return files
    .filter((file) => /(^|\/)(components|ui)\//.test(file.relativePath))
    .filter(
      (file) =>
        ![".test.", ".spec.", ".stories.", ".topo."].some((marker) =>
          file.relativePath.includes(marker),
        ),
    )
    .map((file) => {
      const name = path.basename(
        file.relativePath,
        path.extname(file.relativePath),
      );
      const parsed = sourceModel.parsedByPath.get(file.relativePath);
      const previewSources = (previewsByComponent.get(file.relativePath) ?? [])
        .map((contribution) => contribution.preview)
        .sort(
          (left, right) => (left.priority ?? 500) - (right.priority ?? 500),
        );
      const usedBy = screens
        .filter((screen) =>
          reachableByScreen.get(screen.id)?.has(file.relativePath),
        )
        .map((screen) => screen.id);
      const sourceExport = parsed?.exports.find(
        (item) => item.name === name || item.name === "default",
      );
      const parseBlocked = parsed?.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      );
      return {
        id: `component:${file.relativePath}`,
        kind: "component" as const,
        name,
        source: { filePath: file.relativePath, line: sourceExport?.line ?? 1 },
        previewStatus: parseBlocked
          ? ("blocked" as const)
          : previewSources.length > 0
            ? ("renderable" as const)
            : ("missing" as const),
        previewSources,
        usedBy,
      };
    });
}

function buildHierarchyEdges(screens: ScreenNode[]): ApplicationGraph["edges"] {
  const defaults = screens.filter((screen) => screen.state === "default");
  const edges: ApplicationGraph["edges"] = [];

  for (const screen of defaults) {
    if (screen.routePath === "/") continue;
    const segments = screen.routePath.split("/").filter(Boolean);
    let parentPath = "/";
    for (let count = segments.length - 1; count > 0; count -= 1) {
      const candidate = `/${segments.slice(0, count).join("/")}`;
      if (
        defaults.some(
          (parent) =>
            parent.framework === screen.framework &&
            parent.routePath === candidate,
        )
      ) {
        parentPath = candidate;
        break;
      }
    }

    const parent = defaults.find(
      (item) =>
        item.framework === screen.framework && item.routePath === parentPath,
    );
    if (!parent) continue;
    edges.push({
      id: `hierarchy:${parent.id}->${screen.id}`,
      source: parent.id,
      target: screen.id,
      kind: "hierarchy",
      confidence: 1,
    });
  }

  return edges;
}

function summarizeFrameworks(frameworks: readonly Framework[]): Framework {
  const unique = [...new Set(frameworks)];
  if (unique.length === 0) return "unknown";
  if (unique.length === 1) return unique[0] ?? "unknown";
  return "mixed";
}

function projectRecognition(
  adapterScan: FrameworkAdapterScan,
  snapshot: SourceSnapshot,
  graph: ApplicationGraph,
): ProjectRecognition {
  const frameworks = new Map<
    Framework,
    ProjectRecognition["frameworks"][number]
  >();
  for (const contribution of adapterScan.contributions) {
    for (const match of contribution.matches) {
      const current = frameworks.get(match.framework);
      frameworks.set(match.framework, {
        framework: match.framework,
        confidence: Math.max(current?.confidence ?? 0, match.confidence),
        adapterIds: [
          ...new Set([...(current?.adapterIds ?? []), contribution.adapterId]),
        ].sort(),
        reasons: [
          ...new Set([...(current?.reasons ?? []), ...match.reasons]),
        ].sort(),
      });
    }
  }

  const capabilities: ProjectRecognition["capabilities"] = [];
  const addCapability = (
    id: ProjectRecognition["capabilities"][number]["id"],
    confidence: number,
    reasons: string[],
    sources: ProjectRecognition["capabilities"][number]["sources"] = [],
  ): void => {
    capabilities.push({ id, confidence, reasons, sources: sources.slice(0, 8) });
  };
  if (graph.screens.length > 0) {
    addCapability(
      "routing",
      1,
      [`${graph.screens.length} canonical screens were discovered.`],
      graph.screens.map((screen) => screen.source),
    );
  }
  if (graph.apiEndpoints.length > 0) {
    addCapability(
      "api",
      1,
      [`${graph.apiEndpoints.length} HTTP operations were discovered.`],
      graph.apiEndpoints.flatMap((endpoint) =>
        endpoint.discoveries.map((item) => item.source),
      ),
    );
  }
  const previewSources = graph.components.flatMap(
    (component) => component.previewSources,
  );
  if (previewSources.length > 0) {
    addCapability(
      "component-previews",
      1,
      [`${previewSources.length} renderable component preview sources were discovered.`],
      previewSources.map((preview) => preview.source),
    );
  }
  const sourcePaths = snapshot.files.map((file) => file.relativePath);
  if (
    snapshot.packageNames.has("storybook") ||
    [...snapshot.packageNames].some((name) => name.startsWith("@storybook/")) ||
    sourcePaths.some((filePath) => /\.stories\.[^.]+$/i.test(filePath))
  ) {
    addCapability("storybook", 0.98, ["Storybook packages or story source files are present."]);
  }
  if (
    snapshot.packageNames.has("@playwright/test") ||
    sourcePaths.some((filePath) => /(^|\/)playwright\.config\.[^.]+$/i.test(filePath))
  ) {
    addCapability("playwright", 0.98, ["Playwright package or configuration evidence is present."]);
  }
  if (
    ["vitest", "jest", "@jest/core", "@playwright/test"].some((name) =>
      snapshot.packageNames.has(name),
    ) ||
    sourcePaths.some((filePath) => /\.(?:test|spec)\.[^.]+$/i.test(filePath))
  ) {
    addCapability("testing", 0.95, ["Test packages or colocated test files are present."]);
  }
  if (
    snapshot.packageNames.has("typescript") ||
    sourcePaths.some((filePath) => /\.(?:ts|tsx)$/i.test(filePath))
  ) {
    addCapability("typescript", 0.98, ["TypeScript package or source files are present."]);
  }

  const recognizedFrameworks = [...frameworks.values()].sort((left, right) =>
    left.framework.localeCompare(right.framework),
  );
  return {
    version: 1,
    status:
      recognizedFrameworks.length === 0
        ? "unknown"
        : recognizedFrameworks.length === 1
          ? "recognized"
          : "mixed",
    frameworks: recognizedFrameworks,
    capabilities: capabilities.sort((left, right) => left.id.localeCompare(right.id)),
    sourceFileCount: snapshot.files.length,
  };
}

function buildFlowEdges(
  transitions: readonly FlowTransition[],
): ApplicationGraph["edges"] {
  return transitions.flatMap((transition) => {
    const targetId =
      transition.target.kind === "screen"
        ? transition.target.screenId
        : transition.target.kind === "api-endpoint" &&
            transition.target.endpointId
          ? transition.target.endpointId
          : undefined;
    if (!targetId) return [];
    return [
      {
        id: `flow-edge:${transition.id}`,
        source: transition.sourceScreenId,
        target: targetId,
        kind:
          transition.target.kind === "screen"
            ? ("navigation" as const)
            : ("related" as const),
        confidence: transition.confidence,
        adapterId: transition.adapterId,
        label: transition.action,
        sourceLocation: transition.source,
      },
    ];
  });
}

function routePatternMatches(pattern: string, actual: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean);
  const actualParts = actual.split("/").filter(Boolean);
  let actualIndex = 0;
  for (const segment of patternParts) {
    const catchAll =
      /^\[\[?\.\.\.[^\]]+\]\]?$/.test(segment) ||
      /^:\w+[+*]$/.test(segment);
    if (catchAll) return actualIndex < actualParts.length;
    if (actualIndex >= actualParts.length) return false;
    const dynamic =
      /^\[[^\]]+\]$/.test(segment) ||
      /^:[^/]+$/.test(segment) ||
      /^\$[^/]+$/.test(segment);
    if (!dynamic && segment !== actualParts[actualIndex]) return false;
    actualIndex += 1;
  }
  return actualIndex === actualParts.length;
}

function normalizeFlowTransitions(
  discoveries: readonly (DiscoveredFlowTransition & { adapterId: string })[],
  graph: ApplicationGraph,
): FlowTransition[] {
  const screenById = new Map(graph.screens.map((screen) => [screen.id, screen]));
  const defaultScreens = graph.screens.filter((screen) => screen.state === "default");
  const unique = new Map<string, FlowTransition>();

  for (const discovery of discoveries) {
    const sourceScreen = screenById.get(discovery.sourceScreenId);
    if (!sourceScreen) continue;
    let target: FlowTransition["target"];
    if (discovery.target.kind === "route") {
      const discoveredTarget = discovery.target;
      const sameFramework = defaultScreens.find(
        (screen) =>
          screen.framework === sourceScreen.framework &&
          routePatternMatches(screen.routePath, discoveredTarget.routePath),
      );
      const anyFramework = defaultScreens.find((screen) =>
        routePatternMatches(screen.routePath, discoveredTarget.routePath),
      );
      const resolved = sameFramework ?? anyFramework;
      target = resolved
        ? {
            kind: "screen",
            status: "resolved",
            routePath: resolved.routePath,
            screenId: resolved.id,
          }
        : {
            kind: "route",
            status: "unresolved",
            routePath: discoveredTarget.routePath,
          };
    } else {
      const discoveredTarget = discovery.target;
      const endpoint = graph.apiEndpoints.find(
        (item) =>
          (item.method === discoveredTarget.method || item.method === "ANY") &&
          routePatternMatches(item.path, discoveredTarget.path),
      );
      target = {
        kind: "api-endpoint",
        status: endpoint ? "resolved" : "unresolved",
        method: discoveredTarget.method,
        path: endpoint?.path ?? discoveredTarget.path,
        ...(endpoint ? { endpointId: endpoint.id } : {}),
      };
    }
    const targetIdentity =
      target.kind === "screen"
        ? target.screenId
        : target.kind === "route"
          ? target.routePath
          : `${target.method}:${target.path}`;
    const identity = `${discovery.adapterId}:${sourceScreen.id}:${discovery.kind}:${targetIdentity}:${discovery.source.filePath}:${discovery.source.line ?? 1}`;
    const transition: FlowTransition = {
      version: 1,
      id: `flow-transition:${stableIssueId(identity)}`,
      adapterId: discovery.adapterId,
      kind: discovery.kind,
      sourceScreenId: sourceScreen.id,
      sourceRoutePath: sourceScreen.routePath,
      target,
      action: discovery.action,
      source: discovery.source,
      confidence: discovery.confidence,
    };
    unique.set(identity, transition);
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function inferredStepId(identity: string): string {
  return `inferred-step:${stableIssueId(identity)}`;
}

function inferFlows(
  transitions: readonly FlowTransition[],
  graph: ApplicationGraph,
): InferredFlow[] {
  if (transitions.length === 0) return [];
  const screens = new Map(graph.screens.map((screen) => [screen.id, screen]));
  const outgoing = new Map<string, FlowTransition[]>();
  const incoming = new Set<string>();
  for (const transition of transitions) {
    const current = outgoing.get(transition.sourceScreenId);
    if (current) current.push(transition);
    else outgoing.set(transition.sourceScreenId, [transition]);
    if (transition.target.kind === "screen") incoming.add(transition.target.screenId);
  }
  const entryIds = [...outgoing.keys()]
    .filter((screenId) => {
      const screen = screens.get(screenId);
      return (
        screen?.routePath === "/" ||
        screen?.tags.includes("entry") ||
        !incoming.has(screenId)
      );
    })
    .sort();
  if (entryIds.length === 0) entryIds.push([...outgoing.keys()].sort()[0]!);

  const result: InferredFlow[] = [];
  for (const entryScreenId of entryIds.slice(0, 24)) {
    const entryScreen = screens.get(entryScreenId);
    if (!entryScreen) continue;
    const steps = new Map<string, InferredFlow["steps"][number]>();
    const entryStepId = inferredStepId(`screen:${entryScreenId}`);
    steps.set(entryStepId, {
      id: entryStepId,
      kind: "screen",
      title: entryScreen.title,
      routePath: entryScreen.routePath,
      screenId: entryScreen.id,
      transitionIds: [],
      sources: [entryScreen.source],
      nextStepIds: [],
    });
    const queue: Array<{ screenId: string; depth: number }> = [
      { screenId: entryScreenId, depth: 0 },
    ];
    const visited = new Set<string>();
    const includedTransitions: FlowTransition[] = [];
    let truncated = false;
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.screenId)) continue;
      visited.add(current.screenId);
      const sourceStepId = inferredStepId(`screen:${current.screenId}`);
      const sourceStep = steps.get(sourceStepId);
      if (!sourceStep) continue;
      const candidates = outgoing.get(current.screenId) ?? [];
      for (const transition of candidates) {
        if (steps.size >= 32 || current.depth >= 8) {
          truncated = true;
          continue;
        }
        let targetIdentity: string;
        let targetStep: InferredFlow["steps"][number];
        if (transition.target.kind === "screen") {
          const targetScreen = screens.get(transition.target.screenId);
          if (!targetScreen) continue;
          targetIdentity = `screen:${targetScreen.id}`;
          targetStep = {
            id: inferredStepId(targetIdentity),
            kind: "screen",
            title: targetScreen.title,
            routePath: targetScreen.routePath,
            screenId: targetScreen.id,
            action: transition.action,
            transitionIds: [],
            sources: [targetScreen.source],
            nextStepIds: [],
          };
          if (!visited.has(targetScreen.id)) {
            queue.push({ screenId: targetScreen.id, depth: current.depth + 1 });
          }
        } else if (transition.target.kind === "api-endpoint") {
          targetIdentity = transition.target.endpointId
            ? `endpoint:${transition.target.endpointId}`
            : `endpoint:${transition.target.method}:${transition.target.path}`;
          targetStep = {
            id: inferredStepId(targetIdentity),
            kind: "api-endpoint",
            title: `${transition.target.method} ${transition.target.path}`,
            ...(transition.target.endpointId
              ? { endpointId: transition.target.endpointId }
              : {}),
            action: transition.action,
            transitionIds: [],
            sources: [],
            nextStepIds: [],
          };
        } else {
          targetIdentity = `route:${transition.target.routePath}`;
          targetStep = {
            id: inferredStepId(targetIdentity),
            kind: "unresolved-route",
            title: `Unresolved ${transition.target.routePath}`,
            routePath: transition.target.routePath,
            action: transition.action,
            transitionIds: [],
            sources: [],
            nextStepIds: [],
          };
        }
        const targetStepId = targetStep.id;
        const existing = steps.get(targetStepId);
        if (existing) {
          existing.transitionIds = [
            ...new Set([...existing.transitionIds, transition.id]),
          ];
          existing.sources = [
            ...new Map(
              [...existing.sources, transition.source].map((source) => [
                `${source.filePath}:${source.line ?? 1}:${source.column ?? 1}`,
                source,
              ]),
            ).values(),
          ];
        } else {
          targetStep.transitionIds = [transition.id];
          targetStep.sources.push(transition.source);
          steps.set(targetStepId, targetStep);
        }
        sourceStep.nextStepIds = [
          ...new Set([...sourceStep.nextStepIds, targetStepId]),
        ];
        includedTransitions.push(transition);
      }
    }
    if (includedTransitions.length === 0 || steps.size < 2) continue;
    const confidence =
      includedTransitions.reduce((sum, item) => sum + item.confidence, 0) /
      includedTransitions.length;
    result.push({
      version: 1,
      id: `inferred-flow:${stableIssueId(entryScreenId)}`,
      title: `${entryScreen.title} inferred journey`,
      description: `Read-only journey candidate inferred from ${includedTransitions.length} source-located transitions.`,
      entryStepId,
      confidence,
      adapterIds: [
        ...new Set(includedTransitions.map((transition) => transition.adapterId)),
      ].sort(),
      transitionCount: includedTransitions.length,
      truncated,
      steps: [...steps.values()].sort((left, right) =>
        left.id === entryStepId
          ? -1
          : right.id === entryStepId
            ? 1
            : left.title.localeCompare(right.title),
      ),
    });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

interface EndpointCandidate extends DiscoveredApiEndpoint {
  adapterId: string;
}

function endpointPriority(endpoint: EndpointCandidate): number {
  return endpoint.discoveryKind === "openapi"
    ? 0
    : endpoint.discoveryKind === "framework-source"
      ? 1
      : 2;
}

function mergeApiEndpoints(scan: ApiEndpointAdapterScan): ApiEndpointNode[] {
  const grouped = new Map<string, EndpointCandidate[]>();
  for (const contribution of scan.contributions) {
    for (const endpoint of contribution.endpoints) {
      const key = `${endpoint.method}:${endpoint.path}`;
      const candidate = { ...endpoint, adapterId: contribution.adapterId };
      const current = grouped.get(key);
      if (current) current.push(candidate);
      else grouped.set(key, [candidate]);
    }
  }

  return [...grouped.values()]
    .map((candidates): ApiEndpointNode => {
      const ordered = [...candidates].sort(
        (left, right) =>
          endpointPriority(left) - endpointPriority(right) ||
          right.confidence - left.confidence ||
          left.source.filePath.localeCompare(right.source.filePath),
      );
      const primary = ordered[0]!;
      const parameters = new Map<string, ApiEndpointNode["parameters"][number]>();
      const responses = new Map<string, ApiEndpointNode["responses"][number]>();
      for (const candidate of ordered) {
        for (const parameter of candidate.parameters ?? [])
          parameters.set(`${parameter.in}:${parameter.name}`, parameter);
        for (const response of candidate.responses ?? [])
          responses.set(response.status, response);
      }
      const security =
        ordered.find((candidate) => candidate.security?.status === "declared")
          ?.security ??
        ordered.find((candidate) => candidate.security?.status === "none")
          ?.security ??
        primary.security ?? { status: "unknown" as const, schemes: [] };
      return {
        version: 1,
        id: `api:http:${primary.method}:${primary.path}`,
        kind: "api-endpoint",
        protocol: "http",
        method: primary.method,
        path: primary.path,
        title: primary.title ?? `${primary.method} ${primary.path}`,
        ...(primary.operationId ? { operationId: primary.operationId } : {}),
        ...(primary.summary ? { summary: primary.summary } : {}),
        ...(primary.description ? { description: primary.description } : {}),
        frameworks: [
          ...new Set(ordered.flatMap((item) => item.framework ?? [])),
        ].sort(),
        adapterIds: [...new Set(ordered.map((item) => item.adapterId))].sort(),
        tags: [...new Set(ordered.flatMap((item) => item.tags ?? []))].sort(),
        parameters: [...parameters.values()],
        requestContentTypes: [
          ...new Set(
            ordered.flatMap((item) => item.requestContentTypes ?? []),
          ),
        ].sort(),
        responses: [...responses.values()].sort((left, right) =>
          left.status.localeCompare(right.status),
        ),
        security: {
          status: security.status,
          schemes: [...new Set(security.schemes ?? [])].sort(),
        },
        discoveries: ordered.map((item) => ({
          adapterId: item.adapterId,
          kind: item.discoveryKind,
          ...(item.framework ? { framework: item.framework } : {}),
          source: item.source,
          confidence: item.confidence,
        })),
      };
    })
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.method.localeCompare(right.method),
    );
}

function stableIssueId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function scanSourceSnapshot(
  absoluteRoot: string,
  snapshot: SourceSnapshot,
  options: ScanOptions,
): Promise<ApplicationGraph> {
  const files = snapshot.files;
  const filesByPath = new Map(files.map((file) => [file.relativePath, file]));
  const readSource = (filePath: string): Promise<string> => {
    const cached = snapshot.sourcesByPath.get(filePath);
    if (!cached || !filesByPath.has(filePath)) {
      throw new FrameworkAdapterContractError(
        `Framework adapter requested "${filePath}", which is not part of the workspace source snapshot.`,
      );
    }
    return cached.error
      ? Promise.reject(cached.error)
      : Promise.resolve(cached.source);
  };
  const context: FrameworkAdapterContext & ApiEndpointAdapterContext = {
    rootDir: absoluteRoot,
    files: files.map((file) => ({
      filePath: file.relativePath,
      extension: path.extname(file.relativePath),
    })),
    packageNames: snapshot.packageNames,
    readFile: readSource,
  };

  const [adapterScan, previewScan, endpointScan] = await Promise.all([
    createFrameworkAdapterRegistry(options.adapters).scan(context),
    createComponentPreviewAdapterRegistry(options.previewAdapters ?? []).scan(
      context,
    ),
    createApiEndpointAdapterRegistry(options.endpointAdapters ?? []).scan(
      context,
    ),
  ]);
  const candidates: RouteCandidate[] = [];
  for (const contribution of adapterScan.contributions) {
    for (const route of contribution.routes) {
      const file = filesByPath.get(route.filePath);
      if (!file) {
        throw new FrameworkAdapterContractError(
          `Framework adapter "${contribution.adapterId}" returned source "${route.filePath}", which is not part of the workspace source snapshot.`,
        );
      }
      candidates.push({ ...route, adapterId: contribution.adapterId, file });
    }
  }

  const graph = emptyApplicationGraph(absoluteRoot);
  graph.framework = summarizeFrameworks(adapterScan.frameworks);
  const seen = new Set<string>();
  graph.screens = candidates
    .sort(
      (left, right) =>
        (left.routePath === "/" ? -1 : right.routePath === "/" ? 1 : 0) ||
        left.routePath.localeCompare(right.routePath) ||
        left.state.localeCompare(right.state) ||
        left.framework.localeCompare(right.framework) ||
        left.file.relativePath.localeCompare(right.file.relativePath),
    )
    .filter((candidate) => {
      const key = `${candidate.framework}:${candidate.routePath}:${candidate.state}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((candidate, index) =>
      makeScreen(candidate, index, options.previewRoutes ?? {}),
    );
  const sourceModel = readSourceModel(snapshot);
  graph.components = collectComponents(
    files,
    graph.screens,
    previewScan.previews,
    sourceModel,
  );
  graph.apiEndpoints = mergeApiEndpoints(endpointScan);
  graph.projectRecognition = projectRecognition(
    adapterScan,
    snapshot,
    graph,
  );
  const flowAdapters = options.flowAdapters ?? [];
  const flowScan =
    flowAdapters.length === 0
      ? { contributions: [], transitions: [], issues: [] }
      : await createFlowDiscoveryAdapterRegistry(flowAdapters).scan({
          ...context,
          screens: graph.screens.map((screen) => ({
            screenId: screen.id,
            routePath: screen.routePath,
            sourceFilePaths: [
              ...reachableModules(
                screen.source.filePath,
                sourceModel.dependenciesByPath,
              ),
            ].sort(),
          })),
        } satisfies FlowDiscoveryAdapterContext);
  graph.flowTransitions = normalizeFlowTransitions(
    flowScan.transitions,
    graph,
  );
  graph.inferredFlows = inferFlows(graph.flowTransitions, graph);
  graph.edges = [
    ...buildHierarchyEdges(graph.screens),
    ...buildFlowEdges(graph.flowTransitions),
  ];
  graph.findings = [
    ...parserFindings(sourceModel.parsedByPath),
    ...previewDraftFindings(files, graph.components, sourceModel),
  ];
  graph.sourceIssues = [
    ...endpointScan.issues.map((issue) => ({
      version: 1 as const,
      id: `api-endpoint:${stableIssueId(`${issue.adapterId}:${issue.filePath}:${issue.message}`)}`,
      area: "api-endpoint" as const,
      adapterId: issue.adapterId,
      filePath: issue.filePath,
      message: issue.message,
    })),
    ...flowScan.issues.map((issue) => ({
      version: 1 as const,
      id: `flow-discovery:${stableIssueId(`${issue.adapterId}:${issue.filePath}:${issue.message}`)}`,
      area: "flow-discovery" as const,
      adapterId: issue.adapterId,
      filePath: issue.filePath,
      message: issue.message,
    })),
  ];
  graph.generatedAt = new Date().toISOString();
  return graph;
}

export function createScannerSession(
  rootDir: string,
  options: ScanOptions,
): ScannerSession {
  const absoluteRoot = path.resolve(rootDir);
  const ignored = new Set(options.ignore ?? []);
  const stableOptions: ScanOptions = {
    ...options,
    adapters: [...options.adapters],
    endpointAdapters: [...(options.endpointAdapters ?? [])],
    flowAdapters: [...(options.flowAdapters ?? [])],
    previewAdapters: [...(options.previewAdapters ?? [])],
    ignore: [...ignored],
  };
  let snapshot: SourceSnapshot | undefined;
  let queue = Promise.resolve();

  const run = async (
    changedPaths: readonly string[] | undefined,
  ): Promise<ApplicationGraph> => {
    snapshot =
      !snapshot || changedPaths === undefined
        ? await discoverSourceSnapshot(absoluteRoot, ignored)
        : await refreshSourceSnapshot(
            absoluteRoot,
            snapshot,
            changedPaths,
            ignored,
          );
    return scanSourceSnapshot(absoluteRoot, snapshot, stableOptions);
  };

  return {
    scan(changedPaths) {
      const next = queue.then(() => run(changedPaths));
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

export async function scanWorkspace(
  rootDir: string,
  options: ScanOptions,
): Promise<ApplicationGraph> {
  return createScannerSession(rootDir, options).scan();
}
