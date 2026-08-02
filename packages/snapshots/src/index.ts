import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import {
  captureRoute,
  captureRouteWithBrowser,
  launchPreviewBrowser,
  type PreviewProfile,
} from "@topo/browser";
import {
  createComponentPreviewAdapterRegistry,
  type ComponentPreviewAdapter,
} from "@topo/preview-adapter";
import type {
  ApplicationGraph,
  ComponentPreviewArtifact,
  ScreenNode,
  VisualBaseline,
  VisualComparison,
} from "@topo/schema";
import { screenPreviewPath } from "@topo/schema";
import { createProjectStateStore, type StoredSnapshot } from "@topo/storage";

export const DEFAULT_VISUAL_DIFF_THRESHOLD = 0.1;

export interface CaptureGraphOptions {
  rootDir: string;
  graph: ApplicationGraph;
  /** Omit to capture the whole graph; pass stable screen ids for change refreshes. */
  screenIds?: readonly string[];
  baseUrl?: string;
  profile?: PreviewProfile;
  headless?: boolean;
  executablePath?: string;
  viewport?: { width: number; height: number };
  capture?: typeof captureRoute;
}

export interface CaptureFailure {
  screenId: string;
  routePath: string;
  previewPath?: string;
  error: string;
}

export interface CaptureGraphResult {
  graph: ApplicationGraph;
  snapshots: StoredSnapshot[];
  comparisons: VisualComparison[];
  failures: CaptureFailure[];
}

export interface CompareSnapshotOptions {
  rootDir: string;
  baseline: VisualBaseline;
  snapshot: StoredSnapshot;
  threshold?: number;
  comparedAt?: string;
}

export interface AcceptVisualBaselineOptions {
  rootDir: string;
  screenId: string;
  acceptedAt?: string;
  threshold?: number;
}

export interface AcceptVisualBaselineResult {
  baseline: VisualBaseline;
  comparison: VisualComparison;
}

export interface CaptureComponentPreviewsOptions {
  rootDir: string;
  graph: ApplicationGraph;
  adapters: readonly ComponentPreviewAdapter[];
  baseUrls: Readonly<Record<string, string>>;
  componentIds?: readonly string[];
  profile?: PreviewProfile;
  headless?: boolean;
  executablePath?: string;
  viewport?: { width: number; height: number };
  capture?: typeof captureRoute;
  fetch?: typeof fetch;
}

export interface ComponentPreviewCaptureFailure {
  componentId: string;
  previewId: string;
  error: string;
}

export interface CaptureComponentPreviewsResult {
  artifacts: ComponentPreviewArtifact[];
  failures: ComponentPreviewCaptureFailure[];
}

function safeFilePart(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "screen"
  );
}

function snapshotId(screen: ScreenNode): string {
  return `snapshot-${safeFilePart(screen.id)}`;
}

function visualIdentity(kind: "baseline" | "comparison", screenId: string) {
  const identity = createHash("sha256").update(screenId).digest("hex");
  return `visual-${kind}-${identity.slice(0, 24)}`;
}

function resolveArtifactPath(rootDir: string, artifactPath: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(absoluteRoot, artifactPath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Visual artifact escapes the project root");
  }
  return absolutePath;
}

function requiredCapturedSnapshot(
  snapshot: StoredSnapshot,
): asserts snapshot is StoredSnapshot & {
  status: "captured";
  artifactPath: string;
  contentHash: string;
  width: number;
  height: number;
} {
  if (
    snapshot.status !== "captured" ||
    !snapshot.artifactPath ||
    !snapshot.contentHash ||
    !snapshot.width ||
    !snapshot.height
  ) {
    throw new Error(
      `Screen ${snapshot.screenId} has no captured visual evidence`,
    );
  }
}

function comparisonBase(
  baseline: VisualBaseline,
  snapshot: StoredSnapshot & {
    status: "captured";
    artifactPath: string;
    contentHash: string;
    width: number;
    height: number;
  },
  threshold: number,
  comparedAt: string,
) {
  return {
    version: 1 as const,
    id: visualIdentity("comparison", snapshot.screenId),
    screenId: snapshot.screenId,
    routePath: snapshot.routePath,
    baselineId: baseline.id,
    baselineHash: baseline.contentHash,
    currentSnapshotId: snapshot.id,
    currentHash: snapshot.contentHash,
    comparedAt,
    threshold,
    baselineSize: { width: baseline.width, height: baseline.height },
    currentSize: { width: snapshot.width, height: snapshot.height },
  };
}

export async function compareSnapshotToBaseline(
  options: CompareSnapshotOptions,
): Promise<VisualComparison> {
  const threshold = options.threshold ?? DEFAULT_VISUAL_DIFF_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Visual comparison threshold must be between 0 and 1");
  }
  requiredCapturedSnapshot(options.snapshot);
  const comparedAt = options.comparedAt ?? new Date().toISOString();
  const base = comparisonBase(
    options.baseline,
    options.snapshot,
    threshold,
    comparedAt,
  );
  const totalPixels = Math.max(
    1,
    Math.max(options.baseline.width, options.snapshot.width) *
      Math.max(options.baseline.height, options.snapshot.height),
  );

  if (options.baseline.contentHash === options.snapshot.contentHash) {
    return {
      ...base,
      status: "unchanged",
      changedPixels: 0,
      totalPixels,
      changeRatio: 0,
    };
  }

  if (
    options.baseline.width !== options.snapshot.width ||
    options.baseline.height !== options.snapshot.height
  ) {
    return {
      ...base,
      status: "dimension-changed",
      changedPixels: totalPixels,
      totalPixels,
      changeRatio: 1,
    };
  }

  try {
    const [baselineData, currentData] = await Promise.all([
      readFile(
        resolveArtifactPath(options.rootDir, options.baseline.artifactPath),
      ),
      readFile(
        resolveArtifactPath(options.rootDir, options.snapshot.artifactPath),
      ),
    ]);
    const baselinePng = PNG.sync.read(baselineData);
    const currentPng = PNG.sync.read(currentData);
    if (
      baselinePng.width !== currentPng.width ||
      baselinePng.height !== currentPng.height
    ) {
      return {
        ...base,
        status: "dimension-changed",
        changedPixels: totalPixels,
        totalPixels,
        changeRatio: 1,
        baselineSize: {
          width: baselinePng.width,
          height: baselinePng.height,
        },
        currentSize: { width: currentPng.width, height: currentPng.height },
      };
    }
    const diff = new PNG({
      width: currentPng.width,
      height: currentPng.height,
    });
    const changedPixels = pixelmatch(
      baselinePng.data,
      currentPng.data,
      diff.data,
      currentPng.width,
      currentPng.height,
      { threshold },
    );
    const pixelCount = currentPng.width * currentPng.height;
    const diffDirectory = path.join(
      path.resolve(options.rootDir),
      ".topo",
      "comparisons",
    );
    await mkdir(diffDirectory, { recursive: true });
    const fileName = `${safeFilePart(base.id)}-${options.baseline.contentHash.slice(0, 12)}-${options.snapshot.contentHash.slice(0, 12)}.png`;
    const absoluteArtifactPath = path.join(diffDirectory, fileName);
    await writeFile(absoluteArtifactPath, PNG.sync.write(diff));
    return {
      ...base,
      status: changedPixels === 0 ? "unchanged" : "changed",
      changedPixels,
      totalPixels: pixelCount,
      changeRatio: changedPixels / pixelCount,
      artifactPath: path
        .relative(path.resolve(options.rootDir), absoluteArtifactPath)
        .replace(/\\/g, "/"),
    };
  } catch (error: unknown) {
    return {
      ...base,
      status: "failed",
      changedPixels: 0,
      totalPixels,
      changeRatio: 0,
      error:
        error instanceof Error
          ? error.message
          : "Unable to compare visual evidence",
    };
  }
}

export async function acceptVisualBaseline(
  options: AcceptVisualBaselineOptions,
): Promise<AcceptVisualBaselineResult> {
  const stateStore = createProjectStateStore(options.rootDir);
  const state = await stateStore.read();
  const snapshot = state.snapshots.find(
    (candidate) => candidate.screenId === options.screenId,
  );
  if (!snapshot)
    throw new Error(`Unknown captured screen: ${options.screenId}`);
  requiredCapturedSnapshot(snapshot);
  resolveArtifactPath(options.rootDir, snapshot.artifactPath);
  const acceptedAt = options.acceptedAt ?? new Date().toISOString();
  const baseline: VisualBaseline = {
    version: 1,
    id: visualIdentity("baseline", snapshot.screenId),
    screenId: snapshot.screenId,
    routePath: snapshot.routePath,
    sourceSnapshotId: snapshot.id,
    acceptedAt,
    artifactPath: snapshot.artifactPath,
    contentHash: snapshot.contentHash,
    width: snapshot.width,
    height: snapshot.height,
  };
  const comparison = await compareSnapshotToBaseline({
    rootDir: options.rootDir,
    baseline,
    snapshot,
    threshold: options.threshold,
    comparedAt: acceptedAt,
  });
  await stateStore.recordVisualBaseline(baseline);
  await stateStore.recordVisualComparison(comparison);
  return { baseline, comparison };
}

function componentPreviewArtifactId(
  componentId: string,
  previewId: string,
): string {
  const identity = createHash("sha256")
    .update(componentId)
    .update("\0")
    .update(previewId)
    .digest("hex");
  return `component-preview-${identity.slice(0, 24)}`;
}

export async function captureComponentPreviews(
  options: CaptureComponentPreviewsOptions,
): Promise<CaptureComponentPreviewsResult> {
  const sharedBrowser = options.capture
    ? undefined
    : await launchPreviewBrowser(options);
  const capture =
    options.capture ??
    ((input) => captureRouteWithBrowser(sharedBrowser!, input));
  const absoluteRoot = path.resolve(options.rootDir);
  const artifactDirectory = path.join(absoluteRoot, ".topo", "previews");
  await mkdir(artifactDirectory, { recursive: true });
  const stateStore = createProjectStateStore(absoluteRoot);
  const registry = createComponentPreviewAdapterRegistry(options.adapters);
  const selectedIds = options.componentIds
    ? new Set(options.componentIds)
    : undefined;
  const artifacts: ComponentPreviewArtifact[] = [];
  const failures: ComponentPreviewCaptureFailure[] = [];

  try {
    for (const component of options.graph.components) {
      if (selectedIds && !selectedIds.has(component.id)) continue;
      for (const preview of component.previewSources) {
        const id = componentPreviewArtifactId(component.id, preview.id);
        try {
          const captureUrl = await registry.resolveCaptureUrl(preview, {
            baseUrls: options.baseUrls,
            fetch: options.fetch,
          });
          const parsedUrl = new URL(captureUrl);
          const result = await capture({
            baseUrl: parsedUrl.origin,
            routePath: parsedUrl.toString(),
            profile: options.profile,
            headless: options.headless,
            executablePath: options.executablePath,
            viewport: options.viewport,
            fullPage: false,
            waitUntil: "networkidle",
            readiness: preview.readiness,
          });
          const contentHash = createHash("sha256")
            .update(result.screenshot)
            .digest("hex");
          const fileName = `${safeFilePart(id)}-${contentHash.slice(0, 12)}.png`;
          const absoluteArtifactPath = path.join(artifactDirectory, fileName);
          await writeFile(absoluteArtifactPath, result.screenshot);
          const artifact: ComponentPreviewArtifact = {
            version: 1,
            id,
            targetKind: "component",
            targetId: component.id,
            previewId: preview.id,
            adapterId: preview.adapterId,
            title: preview.title,
            source: preview.source,
            capturedAt: result.capturedAt,
            status: "captured",
            artifactPath: path
              .relative(absoluteRoot, absoluteArtifactPath)
              .replace(/\\/g, "/"),
            contentHash,
            width: result.width,
            height: result.height,
          };
          artifacts.push(artifact);
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to capture preview";
          const artifact: ComponentPreviewArtifact = {
            version: 1,
            id,
            targetKind: "component",
            targetId: component.id,
            previewId: preview.id,
            adapterId: preview.adapterId,
            title: preview.title,
            source: preview.source,
            capturedAt: new Date().toISOString(),
            status: "failed",
            error: message,
          };
          artifacts.push(artifact);
          failures.push({
            componentId: component.id,
            previewId: preview.id,
            error: message,
          });
        }
      }
    }
  } finally {
    await sharedBrowser?.close();
  }

  if (artifacts.length > 0) {
    await stateStore.recordPreviewArtifacts(artifacts);
  }

  return { artifacts, failures };
}

export async function captureGraph(
  options: CaptureGraphOptions,
): Promise<CaptureGraphResult> {
  const sharedBrowser = options.capture
    ? undefined
    : await launchPreviewBrowser(options);
  const capture =
    options.capture ??
    ((input) => captureRouteWithBrowser(sharedBrowser!, input));
  const artifactDirectory = path.join(
    path.resolve(options.rootDir),
    ".topo",
    "snapshots",
  );
  await mkdir(artifactDirectory, { recursive: true });
  const stateStore = createProjectStateStore(options.rootDir);
  const baselineByScreen = new Map(
    (await stateStore.read()).visualBaselines.map((baseline) => [
      baseline.screenId,
      baseline,
    ]),
  );
  const snapshots: StoredSnapshot[] = [];
  const comparisons: VisualComparison[] = [];
  const failures: CaptureFailure[] = [];
  const selectedIds = options.screenIds
    ? new Set(options.screenIds)
    : undefined;
  const screens = options.graph.screens.filter(
    (screen) => !selectedIds || selectedIds.has(screen.id),
  );

  try {
    for (const screen of screens) {
      const id = snapshotId(screen);
      const previewPath = screenPreviewPath(screen);
      try {
        if (!previewPath) {
          throw new Error(
            screen.previewRoute?.status === "unresolved"
              ? screen.previewRoute.reason
              : `No preview path is available for ${screen.routePath}`,
          );
        }
        const result = await capture({
          baseUrl: options.baseUrl ?? options.graph.previewBaseUrl,
          routePath: previewPath,
          profile: options.profile,
          headless: options.headless,
          executablePath: options.executablePath,
          viewport: options.viewport,
        });
        const contentHash = createHash("sha256")
          .update(result.screenshot)
          .digest("hex");
        const fileName = `${safeFilePart(id)}-${contentHash.slice(0, 12)}.png`;
        const artifactPath = path.join(artifactDirectory, fileName);
        await writeFile(artifactPath, result.screenshot);
        const snapshot: StoredSnapshot = {
          id,
          screenId: screen.id,
          routePath: screen.routePath,
          previewPath,
          capturedAt: result.capturedAt,
          status: "captured",
          artifactPath: path
            .relative(path.resolve(options.rootDir), artifactPath)
            .replace(/\\/g, "/"),
          contentHash,
          width: result.width,
          height: result.height,
        };
        snapshots.push(snapshot);
        const baseline = baselineByScreen.get(screen.id);
        if (baseline) {
          const comparison = await compareSnapshotToBaseline({
            rootDir: options.rootDir,
            baseline,
            snapshot,
          });
          comparisons.push(comparison);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unable to capture route";
        const snapshot: StoredSnapshot = {
          id,
          screenId: screen.id,
          routePath: screen.routePath,
          ...(previewPath ? { previewPath } : {}),
          capturedAt: new Date().toISOString(),
          status: "failed",
          error: message,
        };
        snapshots.push(snapshot);
        failures.push({
          screenId: screen.id,
          routePath: screen.routePath,
          ...(previewPath ? { previewPath } : {}),
          error: message,
        });
      }
    }
  } finally {
    await sharedBrowser?.close();
  }

  const capturedIds = new Set(
    snapshots
      .filter((snapshot) => snapshot.status === "captured")
      .map((snapshot) => snapshot.screenId),
  );
  const attemptedIds = new Set(screens.map((screen) => screen.id));
  const nextGraph: ApplicationGraph = {
    ...options.graph,
    screens: options.graph.screens.map((screen) => ({
      ...screen,
      renderStatus: attemptedIds.has(screen.id)
        ? capturedIds.has(screen.id)
          ? "captured"
          : "blocked"
        : screen.renderStatus,
    })),
  };
  await stateStore.commitCapture({
    graph: nextGraph,
    snapshots,
    visualComparisons: comparisons,
  });
  return { graph: nextGraph, snapshots, comparisons, failures };
}
