import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyInitialization, planInitialization } from "@topo/initializer";
import { afterEach, describe, expect, it } from "vitest";

import { runLifecycleCommand } from "./lifecycle-command.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function installedProject(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "topo-cli-lifecycle-"),
  );
  temporaryDirectories.push(directory);
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        packageManager: "pnpm@10.12.1",
        dependencies: { next: "16.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  await applyInitialization(
    await planInitialization({
      projectRoot: directory,
      packageVersion: "0.1.0",
      now: "2026-08-01T00:00:00.000Z",
    }),
  );
  return directory;
}

describe("project lifecycle CLI commands", () => {
  it("prints a bounded migration dry-run without writing", async () => {
    const projectRoot = await installedProject();
    const manifestPath = path.join(projectRoot, ".topo", "install.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.schemaVersion = 2;
    delete manifest.updatedAt;
    delete manifest.packageSpec;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await readFile(manifestPath, "utf8");
    const lines: string[] = [];

    await runLifecycleCommand(
      "migrate",
      projectRoot,
      [projectRoot, "--dry-run", "--json"],
      (line) => lines.push(line),
      "0.2.0",
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      schemaVersion: 1,
      kind: "project-migration",
      status: "ready",
      dryRun: true,
      fromVersion: 2,
      toVersion: 3,
      changedPaths: [".topo/install.json"],
    });
    expect(lines[0]).not.toContain("afterManifestContent");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  it("updates to the running CLI version and returns the install handoff", async () => {
    const projectRoot = await installedProject();
    const lines: string[] = [];

    await runLifecycleCommand(
      "update",
      projectRoot,
      [projectRoot, "--json"],
      (line) => lines.push(line),
      "0.2.0",
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      schemaVersion: 1,
      kind: "project-update",
      status: "updated",
      dryRun: false,
      previousVersion: "0.1.0",
      version: "0.2.0",
      packageSpec: "^0.2.0",
      changedPaths: ["package.json", ".topo/install.json"],
      installCommand: ["pnpm", "install"],
    });
    expect(lines[0]).not.toContain("afterPackageContent");
    expect(
      JSON.parse(
        await readFile(path.join(projectRoot, "package.json"), "utf8"),
      ),
    ).toMatchObject({ devDependencies: { "@topo/cli": "^0.2.0" } });
  });

  it("rejects unknown lifecycle options", async () => {
    const projectRoot = await installedProject();
    await expect(
      runLifecycleCommand("update", projectRoot, ["--surprise"]),
    ).rejects.toThrow("Unknown option --surprise");
  });
});
