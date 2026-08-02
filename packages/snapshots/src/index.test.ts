import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { PNG } from "pngjs";

import type { CaptureRouteOptions } from "@topo/browser";
import { emptyApplicationGraph } from "@topo/schema";

import {
  acceptVisualBaseline,
  captureComponentPreviews,
  captureGraph,
  compareSnapshotToBaseline,
} from "./index.js";

const temporaryDirectories: string[] = [];

function solidPng(red: number, green: number, blue: number): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = red;
    png.data[index + 1] = green;
    png.data[index + 2] = blue;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("captureGraph", () => {
  it("stores captured artifacts and blocks failed routes without stopping the batch", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-snapshots-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.screens = [
      {
        id: "screen:home",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
      {
        id: "screen:missing",
        kind: "screen",
        title: "Missing",
        routePath: "/missing",
        framework: "next-app",
        state: "default",
        group: "/",
        source: { filePath: "app/missing/page.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
    ];

    const result = await captureGraph({
      rootDir: directory,
      graph,
      capture: async ({ routePath }) => {
        if (routePath === "/missing") throw new Error("preview returned 404");
        return {
          url: "http://localhost:3000/",
          title: "Home",
          screenshot: Buffer.from("fake-png"),
          width: 800,
          height: 600,
          capturedAt: new Date().toISOString(),
        };
      },
    });

    expect(result.failures).toHaveLength(1);
    expect(result.graph.screens[0]?.renderStatus).toBe("captured");
    expect(result.graph.screens[1]?.renderStatus).toBe("blocked");
    expect(
      await fs.readdir(path.join(directory, ".topo", "snapshots")),
    ).toHaveLength(1);
    expect(
      JSON.parse(
        await fs.readFile(path.join(directory, ".topo", "state.json"), "utf8"),
      ).snapshots,
    ).toHaveLength(2);
  });

  it("captures only selected screens and preserves every unrelated render state", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-snapshots-scoped-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.screens = [
      {
        id: "screen:home",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
      {
        id: "screen:customers",
        kind: "screen",
        title: "Customers",
        routePath: "/customers",
        framework: "next-app",
        state: "default",
        group: "/customers",
        source: { filePath: "app/customers/page.tsx", line: 1 },
        renderStatus: "captured",
        tags: [],
      },
    ];
    const capturedRoutes: string[] = [];

    const result = await captureGraph({
      rootDir: directory,
      graph,
      screenIds: ["screen:home"],
      capture: async ({ routePath }) => {
        capturedRoutes.push(routePath);
        return {
          url: `http://localhost:3000${routePath}`,
          title: "Home",
          screenshot: Buffer.from("new-home"),
          width: 800,
          height: 600,
          capturedAt: "2026-08-01T04:00:00.000Z",
        };
      },
    });

    expect(capturedRoutes).toEqual(["/"]);
    expect(result.snapshots).toHaveLength(1);
    expect(result.graph.screens.map((screen) => screen.renderStatus)).toEqual([
      "captured",
      "captured",
    ]);
  });

  it("captures a configured dynamic-route example while preserving canonical identity", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-snapshots-dynamic-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.screens = [
      {
        id: "screen:customer",
        kind: "screen",
        title: "Customer",
        routePath: "/customers/[customerId]",
        framework: "next-app",
        state: "default",
        group: "/customers",
        source: { filePath: "app/customers/[customerId]/page.tsx", line: 1 },
        previewRoute: {
          version: 1,
          status: "configured",
          path: "/customers/customer-demo?tab=activity",
          source: "topo.config.ts",
        },
        renderStatus: "unseen",
        tags: [],
      },
    ];
    const requested: string[] = [];

    const result = await captureGraph({
      rootDir: directory,
      graph,
      capture: async ({ routePath }) => {
        requested.push(routePath);
        return {
          url: `http://localhost:3000${routePath}`,
          title: "Customer",
          screenshot: Buffer.from("customer-preview"),
          width: 800,
          height: 600,
          capturedAt: "2026-08-01T04:00:00.000Z",
        };
      },
    });

    expect(requested).toEqual(["/customers/customer-demo?tab=activity"]);
    expect(result.snapshots[0]).toMatchObject({
      routePath: "/customers/[customerId]",
      previewPath: "/customers/customer-demo?tab=activity",
      status: "captured",
    });
  });

  it("records unresolved dynamic routes without launching a browser", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-snapshots-unresolved-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.screens = [
      {
        id: "screen:job",
        kind: "screen",
        title: "Job",
        routePath: "/jobs/:jobId",
        framework: "tanstack-router",
        state: "default",
        group: "/jobs",
        source: { filePath: "src/routes/jobs.$jobId.tsx", line: 1 },
        previewRoute: {
          version: 1,
          status: "unresolved",
          reason:
            'Add preview.routes["/jobs/:jobId"] to topo.config.ts with one concrete local path.',
        },
        renderStatus: "blocked",
        tags: [],
      },
    ];
    let launched = false;

    const result = await captureGraph({
      rootDir: directory,
      graph,
      capture: async () => {
        launched = true;
        throw new Error("must not launch");
      },
    });

    expect(launched).toBe(false);
    expect(result.failures[0]).toMatchObject({
      routePath: "/jobs/:jobId",
      error: expect.stringContaining("preview.routes"),
    });
    expect(result.graph.screens[0]?.renderStatus).toBe("blocked");
  });

  it("accepts a baseline and compares the next capture as durable pixel evidence", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-visual-comparison-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.screens = [
      {
        id: "screen:home",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
    ];
    const firstPng = solidPng(20, 30, 40);
    const secondPng = solidPng(240, 30, 40);

    await captureGraph({
      rootDir: directory,
      graph,
      capture: async () => ({
        url: "http://localhost:3000/",
        title: "Home",
        screenshot: firstPng,
        width: 2,
        height: 2,
        capturedAt: "2026-08-01T06:00:00.000Z",
      }),
    });
    const accepted = await acceptVisualBaseline({
      rootDir: directory,
      screenId: "screen:home",
      acceptedAt: "2026-08-01T06:01:00.000Z",
    });
    expect(accepted.comparison).toMatchObject({
      status: "unchanged",
      changedPixels: 0,
      changeRatio: 0,
    });

    const second = await captureGraph({
      rootDir: directory,
      graph,
      capture: async () => ({
        url: "http://localhost:3000/",
        title: "Home",
        screenshot: secondPng,
        width: 2,
        height: 2,
        capturedAt: "2026-08-01T06:02:00.000Z",
      }),
    });
    expect(second.comparisons).toEqual([
      expect.objectContaining({
        screenId: "screen:home",
        status: "changed",
        changedPixels: 4,
        totalPixels: 4,
        changeRatio: 1,
      }),
    ]);
    const comparison = second.comparisons[0]!;
    expect(comparison.artifactPath).toMatch(/^\.topo\/comparisons\/.+\.png$/);
    await expect(
      fs.access(path.join(directory, comparison.artifactPath!)),
    ).resolves.toBeUndefined();

    const state = JSON.parse(
      await fs.readFile(path.join(directory, ".topo", "state.json"), "utf8"),
    ) as { visualBaselines: unknown[]; visualComparisons: unknown[] };
    expect(state.visualBaselines).toHaveLength(1);
    expect(state.visualComparisons).toEqual([
      expect.objectContaining({ status: "changed", changedPixels: 4 }),
    ]);
  });

  it("short-circuits identical hashes without decoding image bytes", async () => {
    const hash = "a".repeat(64);
    const comparison = await compareSnapshotToBaseline({
      rootDir: "C:/path/does-not-need-to-exist",
      baseline: {
        version: 1,
        id: "baseline-home",
        screenId: "screen:home",
        routePath: "/",
        sourceSnapshotId: "snapshot-home",
        acceptedAt: "2026-08-01T06:00:00.000Z",
        artifactPath: ".topo/snapshots/missing.png",
        contentHash: hash,
        width: 1440,
        height: 1024,
      },
      snapshot: {
        id: "snapshot-home",
        screenId: "screen:home",
        routePath: "/",
        capturedAt: "2026-08-01T06:01:00.000Z",
        status: "captured",
        artifactPath: ".topo/snapshots/also-missing.png",
        contentHash: hash,
        width: 1440,
        height: 1024,
      },
    });

    expect(comparison).toMatchObject({
      status: "unchanged",
      changedPixels: 0,
      totalPixels: 1_474_560,
      changeRatio: 0,
    });
  });

  it("captures component preview variants independently and retains failures as evidence", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-previews-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.components = [
      {
        id: "component:components/Button.tsx",
        kind: "component",
        name: "Button",
        source: { filePath: "components/Button.tsx", line: 1 },
        previewStatus: "renderable",
        previewSources: [
          {
            id: "fixture.preview:button#Primary",
            title: "Primary",
            adapterId: "fixture.preview",
            source: { filePath: "components/Button.preview.tsx", line: 1 },
            exportName: "Primary",
            locator: "components/Button.preview.tsx#Primary",
            readiness: {
              readySelector: 'html[data-topo-preview-status="ready"]',
              errorSelector: 'html[data-topo-preview-status="error"]',
              timeoutMs: 4_000,
            },
          },
          {
            id: "fixture.preview:button#Broken",
            title: "Broken",
            adapterId: "fixture.preview",
            source: { filePath: "components/Button.preview.tsx", line: 1 },
            exportName: "Broken",
            locator: "components/Button.preview.tsx#Broken",
            readiness: {
              readySelector: 'html[data-topo-preview-status="ready"]',
              errorSelector: 'html[data-topo-preview-status="error"]',
              timeoutMs: 4_000,
            },
          },
        ],
        usedBy: [],
      },
    ];

    const captureOptions: CaptureRouteOptions[] = [];
    const result = await captureComponentPreviews({
      rootDir: directory,
      graph,
      adapters: [
        {
          apiVersion: 1,
          id: "fixture.preview",
          displayName: "Fixture preview",
          scan: () => ({ previews: [] }),
          resolveCaptureUrl: (preview, { baseUrl }) =>
            new URL(`/preview/${preview.exportName}`, baseUrl).toString(),
        },
      ],
      baseUrls: { "fixture.preview": "http://127.0.0.1:6100" },
      capture: async (options) => {
        captureOptions.push(options);
        const { routePath } = options;
        if (routePath.endsWith("/Broken")) throw new Error("preview crashed");
        return {
          url: routePath,
          title: "Primary",
          screenshot: Buffer.from("component-png"),
          width: 720,
          height: 480,
          capturedAt: "2026-07-31T12:00:00.000Z",
        };
      },
    });

    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]).toMatchObject({
      targetId: "component:components/Button.tsx",
      previewId: "fixture.preview:button#Primary",
      status: "captured",
      width: 720,
      height: 480,
    });
    expect(result.artifacts[1]).toMatchObject({
      previewId: "fixture.preview:button#Broken",
      status: "failed",
      error: "preview crashed",
    });
    expect(result.failures).toEqual([
      {
        componentId: "component:components/Button.tsx",
        previewId: "fixture.preview:button#Broken",
        error: "preview crashed",
      },
    ]);
    expect(captureOptions).toHaveLength(2);
    expect(captureOptions[0]).toMatchObject({
      waitUntil: "networkidle",
      readiness: {
        readySelector: 'html[data-topo-preview-status="ready"]',
        errorSelector: 'html[data-topo-preview-status="error"]',
        timeoutMs: 4_000,
      },
    });
    expect(
      await fs.readdir(path.join(directory, ".topo", "previews")),
    ).toHaveLength(1);
    const state = JSON.parse(
      await fs.readFile(path.join(directory, ".topo", "state.json"), "utf8"),
    ) as { previewArtifacts: unknown[] };
    expect(state.previewArtifacts).toHaveLength(2);
  });
});
