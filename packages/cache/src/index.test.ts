import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanProjectCache, inspectProjectCache } from "./index.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "topo-cache-"));
  temporaryDirectories.push(projectRoot);
  await mkdir(path.join(projectRoot, ".topo", "cache", "textures"), {
    recursive: true,
  });
  await writeFile(path.join(projectRoot, ".topo", "cache", "atlas.json"), "atlas");
  await writeFile(
    path.join(projectRoot, ".topo", "cache", "textures", "home.bin"),
    "pixels",
  );
  const durableArtifacts: ReadonlyArray<readonly [string, string]> = [
    ["notes/note.md", "note"],
    ["flows/flow.json", "flow"],
    ["snapshots/home.png", "snapshot"],
    ["previews/button.png", "preview"],
    ["llm/context.json", "context"],
    ["state.json", "state"],
  ];
  for (const [relativePath, body] of durableArtifacts) {
    const target = path.join(projectRoot, ".topo", relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  return projectRoot;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("project cache", () => {
  it("reports deterministic top-level entries and recursive totals", async () => {
    const projectRoot = await fixture();
    const report = await inspectProjectCache(projectRoot);

    expect(report.entries.map((entry) => entry.path)).toEqual([
      "atlas.json",
      "textures",
    ]);
    expect(report.totals).toEqual({
      bytes: 11,
      files: 2,
      directories: 1,
      symlinks: 0,
    });
  });

  it("projects a dry run without writing to disk", async () => {
    const projectRoot = await fixture();
    const result = await cleanProjectCache(projectRoot, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.removed.files).toBe(2);
    expect(result.after.totals).toEqual({
      bytes: 0,
      files: 0,
      directories: 0,
      symlinks: 0,
    });
    await expect(
      readFile(path.join(projectRoot, ".topo", "cache", "atlas.json"), "utf8"),
    ).resolves.toBe("atlas");
  });

  it("cleans only derived cache contents and retains durable evidence", async () => {
    const projectRoot = await fixture();
    const result = await cleanProjectCache(projectRoot);

    expect(result.dryRun).toBe(false);
    expect(result.after.exists).toBe(true);
    expect(result.after.entries).toEqual([]);
    await expect(
      access(path.join(projectRoot, ".topo", "cache", "atlas.json")),
    ).rejects.toThrow();
    for (const relativePath of [
      "notes/note.md",
      "flows/flow.json",
      "snapshots/home.png",
      "previews/button.png",
      "llm/context.json",
      "state.json",
    ]) {
      await expect(
        access(path.join(projectRoot, ".topo", relativePath)),
      ).resolves.toBeUndefined();
    }
  });

  it("does not follow a cache symlink into an external directory", async () => {
    const projectRoot = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "topo-cache-outside-"));
    temporaryDirectories.push(outside);
    const marker = path.join(outside, "keep.txt");
    await writeFile(marker, "keep");
    await symlink(
      outside,
      path.join(projectRoot, ".topo", "cache", "outside-link"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const report = await inspectProjectCache(projectRoot);
    expect(report.totals.symlinks).toBe(1);
    expect(
      report.entries.find((entry) => entry.path === "outside-link"),
    ).toMatchObject({ kind: "symlink" });

    await cleanProjectCache(projectRoot);
    await expect(readFile(marker, "utf8")).resolves.toBe("keep");
  });
});
