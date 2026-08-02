import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { storybookComponentPreviewAdapter } from "@topo/adapter-storybook";
import type { ApplicationGraph, ComponentPreviewSource } from "@topo/schema";
import { captureComponentPreviews } from "@topo/snapshots";
import { scanWorkspace } from "@topo/workspace";

export const STORYBOOK_CAPTURE_REPORT_VERSION = 1 as const;

export interface StorybookCaptureCheck {
  id:
    | "source-discovery"
    | "live-index-resolution"
    | "browser-capture"
    | "artifact-evidence";
  status: "pass" | "fail";
  detail: string;
  evidence: Record<string, boolean | number | string | string[]>;
}

export interface StorybookCaptureReport {
  schemaVersion: typeof STORYBOOK_CAPTURE_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  storybookVersion: string;
  browser: "chromium";
  stories: Array<{
    previewId: string;
    exportName: string;
    sourceLine: number | null;
    storyId: string;
    status: "captured" | "failed";
    contentHash: string | null;
    bytes: number;
  }>;
  summary: { passed: number; failed: number; total: number };
  checks: StorybookCaptureCheck[];
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Storybook fixture did not receive a TCP address"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function staticServer(staticRoot: string): Server {
  const root = path.resolve(staticRoot);
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname =
        decodeURIComponent(requestUrl.pathname) === "/"
          ? "/index.html"
          : decodeURIComponent(requestUrl.pathname);
      const absolutePath = path.resolve(root, `.${pathname}`);
      if (
        absolutePath !== root &&
        !absolutePath.startsWith(`${root}${path.sep}`)
      ) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await fs.readFile(absolutePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type":
          MIME_TYPES[path.extname(absolutePath)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch (error: unknown) {
      const status =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
          ? 404
          : 500;
      response.writeHead(status).end(status === 404 ? "Not found" : "Error");
    }
  });
}

async function createScanFixture(fixtureRoot: string): Promise<string> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "topo-storybook-check-"),
  );
  await fs.cp(
    path.join(fixtureRoot, "components"),
    path.join(rootDir, "components"),
    { recursive: true },
  );
  await fs.writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({
      name: "topo-storybook-capture-check",
      private: true,
      devDependencies: {
        "@storybook/react-vite": "10.5.5",
        storybook: "10.5.5",
      },
    })}\n`,
  );
  return rootDir;
}

function storyIdFromUrl(value: string): string {
  return new URL(value).searchParams.get("id") ?? "missing";
}

function stringVersion(value: unknown): string {
  if (typeof value !== "object" || value === null) return "unknown";
  const version = (value as { v?: unknown }).v;
  return typeof version === "number" || typeof version === "string"
    ? String(version)
    : "unknown";
}

export async function runStorybookCaptureCheck(
  fixtureRoot: string,
  options: { headless?: boolean } = {},
): Promise<StorybookCaptureReport> {
  const absoluteFixtureRoot = path.resolve(fixtureRoot);
  const staticRoot = path.join(absoluteFixtureRoot, "storybook-static");
  await fs.access(path.join(staticRoot, "index.json"));
  const scanRoot = await createScanFixture(absoluteFixtureRoot);
  const server = staticServer(staticRoot);

  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;
    const graph = await scanWorkspace(scanRoot);
    const component = graph.components.find(
      (candidate) => candidate.name === "StatusCard",
    );
    if (!component) {
      throw new Error("Storybook fixture scan did not discover StatusCard");
    }
    const previewSources = component.previewSources.filter(
      (preview) => preview.adapterId === "storybook",
    );
    const exactExports = ["Healthy", "Warning", "Loading"];
    const resolvedUrls = await Promise.all(
      previewSources.map((preview) =>
        storybookComponentPreviewAdapter.resolveCaptureUrl(preview, {
          baseUrl,
        }),
      ),
    );
    const captureGraph: ApplicationGraph = {
      ...graph,
      components: [{ ...component, previewSources }],
    };
    const capture = await captureComponentPreviews({
      rootDir: scanRoot,
      graph: captureGraph,
      adapters: [storybookComponentPreviewAdapter],
      baseUrls: { storybook: baseUrl },
      headless: options.headless ?? true,
      viewport: { width: 900, height: 640 },
    });
    const artifactsByPreview = new Map(
      capture.artifacts.map((artifact) => [artifact.previewId, artifact]),
    );
    const storyEvidence = await Promise.all(
      previewSources.map(async (preview, index) => {
        const artifact = artifactsByPreview.get(preview.id);
        const artifactPath = artifact?.artifactPath
          ? path.join(scanRoot, artifact.artifactPath)
          : undefined;
        const bytes = artifactPath
          ? (await fs.stat(artifactPath).catch(() => ({ size: 0 }))).size
          : 0;
        return {
          previewId: preview.id,
          exportName: preview.exportName ?? "missing",
          sourceLine: preview.source.line ?? null,
          storyId: storyIdFromUrl(resolvedUrls[index] ?? baseUrl),
          status: artifact?.status ?? ("failed" as const),
          contentHash: artifact?.contentHash ?? null,
          bytes,
        };
      }),
    );
    const indexResponse = await fetch(`${baseUrl}/index.json`);
    const indexJson: unknown = await indexResponse.json();
    const discoveredExports = previewSources.map(
      (preview) => preview.exportName ?? "missing",
    );
    const sourceDiscovery =
      JSON.stringify(discoveredExports) === JSON.stringify(exactExports) &&
      previewSources.every((preview) => (preview.source.line ?? 0) > 0);
    const indexResolved = storyEvidence.every(
      (story) => story.storyId !== "missing",
    );
    const browserCaptured =
      capture.failures.length === 0 &&
      storyEvidence.every((story) => story.status === "captured");
    const artifactsPersisted = storyEvidence.every(
      (story) =>
        story.bytes > 1_000 &&
        typeof story.contentHash === "string" &&
        story.contentHash.length === 64,
    );
    const checks: StorybookCaptureCheck[] = [
      {
        id: "source-discovery",
        status: sourceDiscovery ? "pass" : "fail",
        detail: `${previewSources.length} exported Storybook state(s) were mapped to StatusCard with exact source lines.`,
        evidence: {
          expectedExports: exactExports,
          discoveredExports,
          sourceLines: previewSources.map((preview) =>
            String(preview.source.line ?? "missing"),
          ),
        },
      },
      {
        id: "live-index-resolution",
        status: indexResolved ? "pass" : "fail",
        detail: `Storybook index v${stringVersion(indexJson)} supplied every capture ID; none were guessed by Topo.`,
        evidence: {
          indexVersion: stringVersion(indexJson),
          storyIds: storyEvidence.map((story) => story.storyId),
        },
      },
      {
        id: "browser-capture",
        status: browserCaptured ? "pass" : "fail",
        detail: browserCaptured
          ? "Chromium rendered and captured every real Storybook iframe state."
          : `${capture.failures.length} Storybook capture(s) failed.`,
        evidence: {
          captured: storyEvidence.filter((story) => story.status === "captured")
            .length,
          failures: capture.failures.map(
            (failure) => `${failure.previewId}: ${failure.error}`,
          ),
        },
      },
      {
        id: "artifact-evidence",
        status: artifactsPersisted ? "pass" : "fail",
        detail: artifactsPersisted
          ? "Each state produced a content-addressed PNG artifact."
          : "One or more Storybook states lacked durable PNG evidence.",
        evidence: {
          bytes: storyEvidence.map(
            (story) => `${story.exportName}:${story.bytes}`,
          ),
          hashes: storyEvidence.map(
            (story) => `${story.exportName}:${story.contentHash ?? "missing"}`,
          ),
        },
      },
    ];
    const failed = checks.filter((check) => check.status === "fail").length;
    return {
      schemaVersion: STORYBOOK_CAPTURE_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      status: failed === 0 ? "pass" : "fail",
      storybookVersion: "10.5.5",
      browser: "chromium",
      stories: storyEvidence,
      summary: { passed: checks.length - failed, failed, total: checks.length },
      checks,
    };
  } finally {
    await closeServer(server).catch(() => undefined);
    await fs.rm(scanRoot, { recursive: true, force: true });
  }
}
