import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";

import { createProjectStateStore } from "@topo/storage";

import { createJobQueue } from "./index.js";

describe("job queue", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  it("serializes work and persists lifecycle states", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-jobs-"));
    temporaryDirectories.push(directory);
    const store = createProjectStateStore(directory);
    const queue = createJobQueue(store);
    const first = queue.submit("scan", async () => "first");
    const second = queue.submit("capture", async () => "second");
    await expect(first.completion).resolves.toBe("first");
    await expect(second.completion).resolves.toBe("second");
    const jobs = await queue.list();
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.status === "completed")).toBe(true);
    await expect(queue.inspect()).resolves.toMatchObject({
      jobs: [{ status: "completed" }, { status: "completed" }],
      retention: { terminalLimit: 100, retained: 2, pruned: 0 },
    });
  });

  it("reports queued and running jobs without persisting transient transitions", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-jobs-"));
    temporaryDirectories.push(directory);
    const store = createProjectStateStore(directory);
    const queue = createJobQueue(store);
    let release: (() => void) | undefined;
    const blocked = queue.submit(
      "scan",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(queue.list()).resolves.toEqual([
      expect.objectContaining({ id: blocked.id, status: "running" }),
    ]);
    await expect(store.read()).resolves.toMatchObject({ jobs: [] });

    release?.();
    await blocked.completion;
    await expect(store.read()).resolves.toMatchObject({
      jobs: [expect.objectContaining({ id: blocked.id, status: "completed" })],
    });
  });

  it("drops terminal history when a fast operation is explicitly transient", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-jobs-"));
    temporaryDirectories.push(directory);
    const store = createProjectStateStore(directory);
    const queue = createJobQueue(store);

    await queue.submit("scan", async () => "done", {
      retainTerminal: false,
    }).completion;

    await expect(queue.list()).resolves.toEqual([]);
    await expect(store.read()).resolves.toMatchObject({ jobs: [] });
  });
});
