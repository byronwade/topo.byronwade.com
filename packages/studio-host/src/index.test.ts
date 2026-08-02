import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  findStudioAssets,
  inspectStudioBuild,
  startStudioHost,
  TOPO_DAEMON_URL_PLACEHOLDER,
  type TopoStudioHost,
} from "./index.js";

const destinationSources = [
  "src/components/AtlasWorkspace.tsx",
  "src/components/EditorWorkspace.tsx",
  "src/components/NotesWorkspace.tsx",
  "src/components/DoctorWorkspace.tsx",
  "src/components/SettingsWorkspace.tsx",
] as const;

const reviewExportSource = "../../packages/exporter/dist/index.js";
const validationSource = "src/studio-validation.ts";

const temporaryDirectories: string[] = [];
const activeHosts: TopoStudioHost[] = [];

async function createAssets(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "topo-studio-host-"),
  );
  temporaryDirectories.push(directory);
  await fs.mkdir(path.join(directory, "assets"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "index.html"),
    `<!doctype html><meta name="topo-daemon-url" content="${TOPO_DAEMON_URL_PLACEHOLDER}"><div id="root"></div>`,
  );
  await fs.writeFile(
    path.join(directory, "assets", "index-abc123.js"),
    "globalThis.topo = true;\n",
  );
  return directory;
}

async function createBuildAssets(options?: {
  eagerPixi?: boolean;
  eagerReviewExport?: boolean;
  eagerValidation?: boolean;
  entryBytes?: number;
}): Promise<string> {
  const directory = await createAssets();
  const manifest: Record<string, unknown> = {
    "index.html": {
      file: "assets/index-abc123.js",
      src: "index.html",
      isEntry: true,
      imports: [
        ...(options?.eagerPixi ? ["src/PixiAtlasCanvas.tsx"] : []),
        ...(options?.eagerReviewExport ? [reviewExportSource] : []),
        ...(options?.eagerValidation ? [validationSource] : []),
      ],
      dynamicImports: [
        ...destinationSources,
        ...(!options?.eagerReviewExport ? [reviewExportSource] : []),
        ...(!options?.eagerValidation ? [validationSource] : []),
      ],
    },
    "src/PixiAtlasCanvas.tsx": {
      file: "assets/PixiAtlasCanvas-abc123.js",
      src: "src/PixiAtlasCanvas.tsx",
      isDynamicEntry: true,
      imports: ["src/live-frames.ts"],
    },
    "src/live-frames.ts": {
      file: "assets/live-frames-abc123.js",
      src: "src/live-frames.ts",
    },
    [reviewExportSource]: {
      file: "assets/review-export-abc123.js",
      src: reviewExportSource,
      isDynamicEntry: !options?.eagerReviewExport,
    },
    [validationSource]: {
      file: "assets/studio-validation-abc123.js",
      src: validationSource,
      isDynamicEntry: !options?.eagerValidation,
    },
  };
  for (const [index, source] of destinationSources.entries()) {
    manifest[source] = {
      file: `assets/Destination${index}-abc123.js`,
      src: source,
      isDynamicEntry: true,
    };
    await fs.writeFile(
      path.join(directory, "assets", `Destination${index}-abc123.js`),
      `export const destination = ${index};\n`,
    );
  }
  await fs.writeFile(
    path.join(directory, "assets", "index-abc123.js"),
    Buffer.alloc(options?.entryBytes ?? 32, 97),
  );
  await fs.writeFile(
    path.join(directory, "assets", "PixiAtlasCanvas-abc123.js"),
    "export const pixi = true;\n",
  );
  await fs.writeFile(
    path.join(directory, "assets", "live-frames-abc123.js"),
    "export const frames = true;\n",
  );
  await fs.writeFile(
    path.join(directory, "assets", "review-export-abc123.js"),
    "export const exportReview = () => true;\n",
  );
  await fs.writeFile(
    path.join(directory, "assets", "studio-validation-abc123.js"),
    "export const parseGraph = (value) => value;\n",
  );
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(activeHosts.splice(0).map((host) => host.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("Studio asset discovery", () => {
  it("selects the first candidate containing a real index", async () => {
    const assets = await createAssets();
    expect(
      await findStudioAssets([path.join(assets, "missing"), undefined, assets]),
    ).toBe(await fs.realpath(assets));
  });

  it("reports every attempted location when no bundle exists", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-studio-missing-"),
    );
    temporaryDirectories.push(directory);
    await expect(
      findStudioAssets([directory, path.join(directory, "other")]),
    ).rejects.toThrow(/Studio assets were not found.*Checked:/);
  });
});

describe("Studio build inspection", () => {
  it("returns JSON-safe evidence for a bounded lazy production artifact", async () => {
    const assets = await createBuildAssets();
    const report = await inspectStudioBuild(assets);

    expect(report).toMatchObject({
      schemaVersion: 3,
      status: "pass",
      summary: { passed: 6, failed: 0, total: 6 },
      initial: { bytes: 32 },
      pixi: { deferred: true },
      reviewExport: { deferred: true },
      validation: { deferred: true },
    });
    expect(report.destinations).toHaveLength(5);
    expect(report.pixi.assets.map((asset) => asset.source)).toEqual([
      "src/PixiAtlasCanvas.tsx",
    ]);
    expect(report.reviewExport.assets.map((asset) => asset.source)).toEqual([
      reviewExportSource,
    ]);
    expect(report.validation.assets.map((asset) => asset.source)).toEqual([
      validationSource,
    ]);
    expect(report.checks.map((check) => check.id)).toEqual([
      "initial-js-bytes",
      "initial-js-gzip-bytes",
      "lazy-destinations",
      "lazy-pixi-runtime",
      "lazy-review-export",
      "lazy-studio-validation",
    ]);
    const serialized = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(serialized.status).toBe("pass");
    expect(serialized.destinations[0]).toMatchObject({
      source: destinationSources[0],
    });
  });

  it("reports an oversized entry and an eager Pixi dependency", async () => {
    const assets = await createBuildAssets({
      eagerPixi: true,
      entryBytes: 350_001,
    });
    const report = await inspectStudioBuild(assets);

    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "initial-js-bytes", status: "fail" }),
        expect.objectContaining({ id: "lazy-pixi-runtime", status: "fail" }),
      ]),
    );
    expect(report.pixi.deferred).toBe(false);
  });

  it("rejects a review exporter that is statically reachable from the entry", async () => {
    const assets = await createBuildAssets({ eagerReviewExport: true });
    const report = await inspectStudioBuild(assets);

    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lazy-review-export", status: "fail" }),
      ]),
    );
    expect(report.reviewExport.deferred).toBe(false);
  });

  it("rejects Studio validation that is statically reachable from the entry", async () => {
    const assets = await createBuildAssets({ eagerValidation: true });
    const report = await inspectStudioBuild(assets);

    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lazy-studio-validation",
          status: "fail",
        }),
      ]),
    );
    expect(report.validation.deferred).toBe(false);
  });

  it("rejects a labeled dynamic destination that the entry cannot reach", async () => {
    const assets = await createBuildAssets();
    const manifestPath = path.join(assets, "manifest.json");
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, "utf8"),
    ) as Record<string, { dynamicImports?: string[] }>;
    manifest["index.html"]!.dynamicImports = destinationSources.slice(1);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    const report = await inspectStudioBuild(assets);

    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lazy-destinations", status: "fail" }),
      ]),
    );
  });

  it("rejects manifest assets outside the real build root", async () => {
    const assets = await createBuildAssets();
    const manifestPath = path.join(assets, "manifest.json");
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, "utf8"),
    ) as Record<string, { file: string }>;
    manifest[destinationSources[0]]!.file = "../outside.js";
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    await expect(inspectStudioBuild(assets)).rejects.toThrow(
      /asset escapes its root/,
    );
  });
});

describe("Studio host", () => {
  it("injects destination-scoped module preloads without leaking Pixi into Notes", async () => {
    const assetsDir = await createBuildAssets();
    const host = await startStudioHost({
      assetsDir,
      daemonUrl: "http://127.0.0.1:4599",
      port: 0,
    });
    activeHosts.push(host);

    const notesHtml = await (await fetch(`${host.url}/notes`)).text();
    expect(notesHtml).toContain(
      'rel="modulepreload" crossorigin href="/assets/Destination2-abc123.js"',
    );
    expect(notesHtml).not.toContain("PixiAtlasCanvas-abc123.js");
    expect(notesHtml).not.toContain("live-frames-abc123.js");

    const atlasHtml = await (await fetch(`${host.url}/atlas/routes`)).text();
    expect(atlasHtml).toContain(
      'rel="modulepreload" crossorigin href="/assets/Destination0-abc123.js"',
    );
    expect(atlasHtml).toContain("/assets/PixiAtlasCanvas-abc123.js");
    expect(atlasHtml).toContain("/assets/live-frames-abc123.js");
  });

  it("serves assets and client routes with injected local daemon evidence", async () => {
    const assetsDir = await createAssets();
    const host = await startStudioHost({
      assetsDir,
      daemonUrl: "http://127.0.0.1:4599",
      frameOrigins: ["http://127.0.0.2:4180", "http://[::1]:4181"],
      port: 0,
    });
    activeHosts.push(host);

    const routeResponse = await fetch(`${host.url}/atlas/routes?selected=home`);
    expect(routeResponse.status).toBe(200);
    expect(routeResponse.headers.get("content-type")).toContain("text/html");
    const policy = routeResponse.headers.get("content-security-policy");
    expect(policy).toContain("http://127.0.0.1:4599");
    expect(policy).toContain("http://127.0.0.2:4180");
    expect(policy).toContain("http://[::1]:4181");
    expect(policy).toContain("connect-src 'self' data:");
    expect(policy).toContain(
      "img-src 'self' data: blob: http://127.0.0.1:4599",
    );
    expect(policy).not.toContain("http://[::1]:*");
    const html = await routeResponse.text();
    expect(html).toContain('content="http://127.0.0.1:4599"');
    expect(html).not.toContain(TOPO_DAEMON_URL_PLACEHOLDER);
    expect(await (await fetch(`${host.url}/index.html`)).text()).toContain(
      'content="http://127.0.0.1:4599"',
    );

    const assetResponse = await fetch(`${host.url}/assets/index-abc123.js`, {
      method: "HEAD",
    });
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toContain(
      "text/javascript",
    );
    expect(assetResponse.headers.get("cache-control")).toContain("immutable");
    expect(await assetResponse.text()).toBe("");
  });

  it("does not turn missing assets or traversal requests into the SPA", async () => {
    const assetsDir = await createAssets();
    const host = await startStudioHost({
      assetsDir,
      daemonUrl: "http://127.0.0.1:4599",
      port: 0,
    });
    activeHosts.push(host);

    expect((await fetch(`${host.url}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${host.url}/..%2Foutside.txt`)).status).toBe(404);
    expect(
      (
        await fetch(host.url, {
          method: "POST",
        })
      ).status,
    ).toBe(405);
  });

  it("falls back to an ephemeral port only when requested", async () => {
    const blocker = createServer((_request, response) => response.end());
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const address = blocker.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected blocker TCP address");
    }
    const assetsDir = await createAssets();
    try {
      const host = await startStudioHost({
        assetsDir,
        daemonUrl: "http://127.0.0.1:4599",
        port: address.port,
        fallbackToRandomPort: true,
      });
      activeHosts.push(host);
      expect(host.port).not.toBe(address.port);
      expect((await fetch(host.url)).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects a non-loopback bind", async () => {
    const assetsDir = await createAssets();
    await expect(
      startStudioHost({
        assetsDir,
        daemonUrl: "http://127.0.0.1:4599",
        host: "0.0.0.0",
        port: 0,
      }),
    ).rejects.toThrow(/must bind to loopback/);
  });

  it("rejects a remote frame origin", async () => {
    const assetsDir = await createAssets();
    await expect(
      startStudioHost({
        assetsDir,
        daemonUrl: "http://127.0.0.1:4599",
        frameOrigins: ["https://example.com"],
        port: 0,
      }),
    ).rejects.toThrow(/frame origins must use loopback HTTP/);
  });
});
