import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { emptyApplicationGraph } from "@topo/schema";

import {
  createProjectStateStore,
  retainJobHistory,
  type StoredJob,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("project state store", () => {
  it("commits a capture batch and preview batch with one durable state transition each", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-storage-"));
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.framework = "capture-benchmark";
    const store = createProjectStateStore(directory);

    await store.commitCapture({
      graph,
      snapshots: [
        {
          id: "snapshot-a",
          screenId: "screen-a",
          routePath: "/a",
          capturedAt: "2026-08-02T00:00:00.000Z",
          status: "failed",
          error: "fixture",
        },
        {
          id: "snapshot-b",
          screenId: "screen-b",
          routePath: "/b",
          capturedAt: "2026-08-02T00:00:00.000Z",
          status: "failed",
          error: "fixture",
        },
      ],
      visualComparisons: [],
    });
    await store.recordPreviewArtifacts([
      {
        version: 1,
        id: "preview-a",
        targetKind: "component",
        targetId: "component-a",
        previewId: "preview-source-a",
        adapterId: "fixture",
        title: "A",
        source: { filePath: "src/A.tsx", line: 1 },
        capturedAt: "2026-08-02T00:00:00.000Z",
        status: "failed",
        error: "fixture",
      },
      {
        version: 1,
        id: "preview-b",
        targetKind: "component",
        targetId: "component-b",
        previewId: "preview-source-b",
        adapterId: "fixture",
        title: "B",
        source: { filePath: "src/B.tsx", line: 1 },
        capturedAt: "2026-08-02T00:00:00.000Z",
        status: "failed",
        error: "fixture",
      },
    ]);

    const state = await store.read();
    expect(state.graph?.framework).toBe("capture-benchmark");
    expect(state.snapshots.map((snapshot) => snapshot.id)).toEqual([
      "snapshot-a",
      "snapshot-b",
    ]);
    expect(state.previewArtifacts.map((artifact) => artifact.id)).toEqual([
      "preview-a",
      "preview-b",
    ]);
  });

  it("writes atomically and rehydrates graph, snapshots, and jobs", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-storage-"));
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.framework = "next-app";

    const first = createProjectStateStore(directory);
    await first.saveGraph(graph);
    await first.recordSnapshot({
      id: "snapshot-1",
      screenId: "screen-1",
      routePath: "/",
      capturedAt: new Date().toISOString(),
      status: "captured",
      contentHash: "c".repeat(64),
    });
    await first.recordVisualBaseline({
      version: 1,
      id: "visual-baseline-home",
      screenId: "screen-1",
      routePath: "/",
      sourceSnapshotId: "snapshot-1",
      acceptedAt: "2026-08-01T00:00:00.000Z",
      artifactPath: ".topo/snapshots/home.png",
      contentHash: "a".repeat(64),
      width: 800,
      height: 600,
    });
    await first.recordVisualComparison({
      version: 1,
      id: "visual-comparison-home",
      screenId: "screen-1",
      routePath: "/",
      baselineId: "visual-baseline-home",
      baselineHash: "a".repeat(64),
      currentSnapshotId: "snapshot-1",
      currentHash: "b".repeat(64),
      comparedAt: "2026-08-01T00:01:00.000Z",
      status: "changed",
      threshold: 0.1,
      changedPixels: 600,
      totalPixels: 480_000,
      changeRatio: 0.00125,
      baselineSize: { width: 800, height: 600 },
      currentSize: { width: 800, height: 600 },
      artifactPath: ".topo/comparisons/home.png",
    });
    await first.recordPreviewArtifact({
      version: 1,
      id: "component-preview-1",
      targetKind: "component",
      targetId: "component:button",
      previewId: "storybook:button#Primary",
      adapterId: "storybook",
      title: "Primary",
      source: { filePath: "components/Button.stories.tsx", line: 1 },
      capturedAt: new Date().toISOString(),
      status: "captured",
      artifactPath: ".topo/previews/button.png",
      contentHash: "b".repeat(64),
      width: 720,
      height: 480,
    });
    await first.saveJob({
      id: "job-1",
      kind: "scan",
      status: "completed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: 1,
    });

    const second = createProjectStateStore(directory);
    const state = await second.read();
    expect(state.graph?.framework).toBe("next-app");
    expect(state.snapshots[0]?.contentHash).toBe("c".repeat(64));
    expect(state.visualBaselines[0]?.contentHash).toBe("a".repeat(64));
    expect(state.visualComparisons[0]).toMatchObject({
      status: "changed",
      changedPixels: 600,
    });
    expect(state.previewArtifacts[0]).toMatchObject({
      targetId: "component:button",
      previewId: "storybook:button#Primary",
      contentHash: "b".repeat(64),
    });
    expect(state.jobs[0]?.status).toBe("completed");
    expect(state.jobHistory).toEqual({
      terminalLimit: 100,
      retained: 1,
      pruned: 0,
    });
    expect(state.updatedAt).not.toBe(new Date(0).toISOString());
  });

  it("invalidates the shared parsed-state cache after an external replacement", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-storage-"));
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.framework = "next-app";
    const first = createProjectStateStore(directory);
    await first.saveGraph(graph);
    await first.read();

    const statePath = path.join(directory, ".topo", "state.json");
    const external = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      graph: { framework: string };
    };
    external.graph.framework = "external-framework-replacement";
    await fs.writeFile(statePath, `${JSON.stringify(external, null, 2)}\n`);

    await expect(
      createProjectStateStore(directory).read(),
    ).resolves.toMatchObject({
      graph: { framework: "external-framework-replacement" },
    });
  });

  it("replaces interaction probes only for the routes that were rerun", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-storage-"));
    temporaryDirectories.push(directory);
    const store = createProjectStateStore(directory);
    const artifact = (routePath: string, suffix: string) => ({
      version: 1 as const,
      id: `interaction-probe:${suffix}`,
      routePath,
      control: {
        index: 0,
        id: `control:${suffix}`,
        label: suffix,
        tagName: "button",
        role: "button",
        locator: `role=button[name="${suffix}"]`,
      },
      status: "possibly-inert" as const,
      effects: [],
      evidence: [`Activated ${suffix}`],
      observedAt: "2026-08-01T01:00:00.000Z",
    });

    await store.replaceInteractionProbes(
      ["/dashboard", "/settings"],
      [
        artifact("/dashboard", "dashboard-old"),
        artifact("/settings", "settings-old"),
      ],
    );
    await store.replaceInteractionProbes(
      ["/settings"],
      [artifact("/settings", "settings-new")],
    );

    expect(
      (await store.read()).interactionProbes.map((item) => item.id),
    ).toEqual([
      "interaction-probe:settings-new",
      "interaction-probe:dashboard-old",
    ]);
  });

  it("rehydrates version-one state created before interaction probes existed", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-storage-"));
    temporaryDirectories.push(directory);
    const stateDirectory = path.join(directory, ".topo");
    await fs.mkdir(stateDirectory, { recursive: true });
    await fs.writeFile(
      path.join(stateDirectory, "state.json"),
      `${JSON.stringify({
        version: 1,
        updatedAt: "2026-07-31T00:00:00.000Z",
        snapshots: [],
        previewArtifacts: [],
        findings: [],
        jobs: [],
      })}\n`,
    );

    expect(
      (await createProjectStateStore(directory).read()).interactionProbes,
    ).toEqual([]);
    expect(
      (await createProjectStateStore(directory).read()).visualBaselines,
    ).toEqual([]);
    expect(
      (await createProjectStateStore(directory).read()).visualComparisons,
    ).toEqual([]);
  });

  it("replaces baseline and comparison authority per screen", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-storage-"));
    temporaryDirectories.push(directory);
    const store = createProjectStateStore(directory);
    const baseline = (hash: string, screenId = "screen-1") => ({
      version: 1 as const,
      id: `baseline-${screenId}`,
      screenId,
      routePath: "/",
      sourceSnapshotId: `snapshot-${screenId}`,
      acceptedAt: "2026-08-01T00:00:00.000Z",
      artifactPath: `.topo/snapshots/${screenId}-${hash}.png`,
      contentHash: hash.repeat(64),
      width: 10,
      height: 10,
    });
    const comparison = (hash: string, screenId = "screen-1") => ({
      version: 1 as const,
      id: `comparison-${screenId}`,
      screenId,
      routePath: "/",
      baselineId: `baseline-${screenId}`,
      baselineHash: "a".repeat(64),
      currentSnapshotId: `snapshot-${screenId}`,
      currentHash: hash.repeat(64),
      comparedAt: "2026-08-01T00:01:00.000Z",
      status: "changed" as const,
      threshold: 0.1,
      changedPixels: 1,
      totalPixels: 100,
      changeRatio: 0.01,
      baselineSize: { width: 10, height: 10 },
      currentSize: { width: 10, height: 10 },
    });

    await store.recordVisualBaseline(baseline("a"));
    await store.recordVisualBaseline(baseline("b"));
    await store.recordVisualBaseline(baseline("c", "screen-2"));
    await store.recordVisualComparison(comparison("b"));
    await store.recordVisualComparison(comparison("c"));
    await store.recordVisualComparison(comparison("d", "screen-2"));

    const state = await store.read();
    expect(state.visualBaselines.map((item) => item.screenId)).toEqual([
      "screen-2",
      "screen-1",
    ]);
    expect(state.visualBaselines[1]?.contentHash).toBe("b".repeat(64));
    expect(state.visualComparisons.map((item) => item.currentHash)).toEqual([
      "d".repeat(64),
      "c".repeat(64),
    ]);
  });

  it("serializes independent store instances that target the same state file", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-storage-"));
    temporaryDirectories.push(directory);
    const stores = Array.from({ length: 24 }, () =>
      createProjectStateStore(directory),
    );

    await Promise.all(
      stores.map((store, index) =>
        store.recordSnapshot({
          id: `snapshot-${index}`,
          screenId: `screen-${index}`,
          routePath: `/route-${index}`,
          capturedAt: "2026-08-01T00:00:00.000Z",
          status: "captured",
          contentHash: String(index).padStart(64, "0"),
        }),
      ),
    );

    const state = await createProjectStateStore(directory).read();
    expect(state.snapshots).toHaveLength(stores.length);
    expect(state.snapshots.map((item) => item.id).sort()).toEqual(
      stores.map((_, index) => `snapshot-${index}`).sort(),
    );
  });

  it("retains every active job and only the newest terminal history", () => {
    const job = (
      id: string,
      status: StoredJob["status"],
      minute: number,
    ): StoredJob => ({
      id,
      kind: "scan",
      status,
      createdAt: `2026-08-01T00:0${minute}:00.000Z`,
      updatedAt: `2026-08-01T00:0${minute}:00.000Z`,
      progress: status === "completed" ? 1 : 0,
    });
    const retained = retainJobHistory(
      [
        job("terminal-old", "completed", 1),
        job("active-running", "running", 2),
        job("terminal-middle", "failed", 3),
        job("active-queued", "queued", 4),
        job("terminal-new", "completed", 5),
      ],
      2,
    );

    expect(retained.pruned).toBe(1);
    expect(retained.jobs.map((item) => item.id)).toEqual([
      "terminal-new",
      "active-queued",
      "terminal-middle",
      "active-running",
    ]);
  });

  it("compacts legacy oversized job history once and persists the audit count", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-storage-"));
    temporaryDirectories.push(directory);
    const stateDirectory = path.join(directory, ".topo");
    await fs.mkdir(stateDirectory, { recursive: true });
    const jobs: StoredJob[] = [1, 2, 3].map((minute) => ({
      id: `job-${minute}`,
      kind: "scan",
      status: "completed",
      createdAt: `2026-08-01T00:0${minute}:00.000Z`,
      updatedAt: `2026-08-01T00:0${minute}:00.000Z`,
      progress: 1,
    }));
    const statePath = path.join(stateDirectory, "state.json");
    await fs.writeFile(
      statePath,
      `${JSON.stringify({
        version: 1,
        updatedAt: "2026-08-01T00:00:00.000Z",
        snapshots: [],
        previewArtifacts: [],
        interactionProbes: [],
        findings: [],
        jobs,
      })}\n`,
    );
    const store = createProjectStateStore(directory, { terminalJobLimit: 2 });

    expect((await store.read()).jobHistory).toEqual({
      terminalLimit: 2,
      retained: 2,
      pruned: 1,
    });
    await store.compact();
    await store.compact();

    const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      jobs: StoredJob[];
      jobHistory: { terminalLimit: number; retained: number; pruned: number };
    };
    expect(persisted.jobs.map((item) => item.id)).toEqual(["job-3", "job-2"]);
    expect(persisted.jobHistory).toEqual({
      terminalLimit: 2,
      retained: 2,
      pruned: 1,
    });
  });
});
