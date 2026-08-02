import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defineConfig, type TopoProject } from "@topo/config";

import { startTopoLocalRuntime, type TopoLocalRuntime } from "./index.js";

const temporaryRoots: string[] = [];
const activeRuntimes: TopoLocalRuntime[] = [];

async function temporaryProject(previewPort: number): Promise<TopoProject> {
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), "topo-local-runtime-"),
  );
  temporaryRoots.push(projectRoot);
  await mkdir(path.join(projectRoot, "src"));
  await writeFile(
    path.join(projectRoot, "package.json"),
    `${JSON.stringify({ name: "topo-local-runtime-fixture", private: true }, null, 2)}\n`,
    "utf8",
  );
  const config = defineConfig({
    rootDir: ".",
    daemon: { host: "127.0.0.1", port: 4599 },
    preview: {
      baseUrl: `http://127.0.0.1:${previewPort}`,
      server: { mode: "external" },
    },
  });
  return {
    projectRoot,
    sourceRoot: projectRoot,
    configPath: path.join(projectRoot, "topo.config.ts"),
    config,
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not receive a port.");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function portIsAvailable(port: number): Promise<boolean> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

afterEach(async () => {
  await Promise.allSettled(
    activeRuntimes.splice(0).map((runtime) => runtime.close()),
  );
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("startTopoLocalRuntime", () => {
  it("starts one daemon and profile gateway behind an idempotent handle", async () => {
    const configuredPreviewPort = await freePort();
    const overriddenPreviewPort = await freePort();
    const project = await temporaryProject(configuredPreviewPort);
    const runtime = await startTopoLocalRuntime({
      project,
      previewPort: overriddenPreviewPort,
      daemonPort: 0,
      startApplication: false,
      startStudio: false,
      watch: false,
    });
    activeRuntimes.push(runtime);

    expect(runtime.application).toBeUndefined();
    expect(runtime.preview.mode).toBe("gateway");
    expect(runtime.preview.profiles).toEqual(["Anonymous"]);
    expect(runtime.preview.targetBaseUrl).toBe(
      `http://127.0.0.1:${overriddenPreviewPort}`,
    );
    expect(runtime.watching).toBe(false);
    const graph = (await fetch(`${runtime.daemon.url}/graph`).then((response) =>
      response.json(),
    )) as { previewBaseUrl?: string };
    expect(graph.previewBaseUrl).toBe(runtime.preview.baseUrl);

    await Promise.all([runtime.close(), runtime.close()]);
    expect(await portIsAvailable(runtime.daemon.port)).toBe(true);
  });

  it("rejects unsafe preview overrides before starting resources", async () => {
    const baseProject = await temporaryProject(await freePort());
    const project: TopoProject = {
      ...baseProject,
      config: defineConfig({
        preview: {
          baseUrl: "https://example.com",
          server: { mode: "external" },
        },
      }),
    };
    await expect(
      startTopoLocalRuntime({
        project,
        previewPort: 4400,
        daemonPort: 0,
        startApplication: false,
        startStudio: false,
      }),
    ).rejects.toThrow(
      "previewPort can override only a loopback HTTP application origin",
    );
  });

  it("rolls back the daemon and gateway when Studio startup fails", async () => {
    const daemonPort = await freePort();
    const project = await temporaryProject(await freePort());
    await expect(
      startTopoLocalRuntime({
        project,
        daemonPort,
        studioPort: 0,
        studioAssetsDir: path.join(project.projectRoot, "missing-studio"),
        startApplication: false,
        watch: false,
      }),
    ).rejects.toThrow("Topo Studio assets were not found");
    expect(await portIsAvailable(daemonPort)).toBe(true);
  });
});
