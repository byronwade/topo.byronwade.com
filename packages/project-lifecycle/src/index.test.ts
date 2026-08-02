import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyProjectMigration,
  applyProjectUpdate,
  planProjectMigration,
  planProjectUpdate,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function installedProject(
  options: {
    schemaVersion?: 2 | 3;
    packageSpec?: string;
    userDependency?: boolean;
  } = {},
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "topo-lifecycle-"));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, ".topo"));
  const originalPackage = `${JSON.stringify(
    {
      name: "fixture",
      packageManager: "pnpm@10.12.1",
      scripts: { test: "vitest" },
      dependencies: { next: "16.0.0" },
      devDependencies: {},
    },
    null,
    2,
  )}\n`;
  const installedPackage = `${JSON.stringify(
    {
      name: "fixture",
      packageManager: "pnpm@10.12.1",
      scripts: { test: "vitest", topo: "topo dev" },
      dependencies: {
        next: "16.0.0",
        ...(options.userDependency ? { react: "19.1.0" } : {}),
      },
      devDependencies: { "@topo/cli": "^0.1.0" },
    },
    null,
    2,
  )}\n`;
  const schemaVersion = options.schemaVersion ?? 3;
  const manifest = {
    schemaVersion,
    installedAt: "2026-08-01T00:00:00.000Z",
    ...(schemaVersion === 3
      ? {
          updatedAt: "2026-08-01T00:00:00.000Z",
          packageSpec: options.packageSpec ?? "^0.1.0",
        }
      : {}),
    topoVersion: "0.1.0",
    packageName: "@topo/cli",
    packageManager: "pnpm",
    sourceRoot: ".",
    detection: {
      packageManager: "pnpm",
      monorepo: false,
      applications: [
        {
          path: ".",
          framework: "next",
          storybook: false,
          playwright: false,
          fixtures: false,
          mocks: false,
        },
      ],
      selectedApplication: {
        path: ".",
        framework: "next",
        storybook: false,
        playwright: false,
        fixtures: false,
        mocks: false,
      },
    },
    files: [
      {
        path: "package.json",
        action: "modified",
        beforeContent: originalPackage,
        afterHash: hash(
          options.userDependency
            ? installedPackage.replace(',\n    "react": "19.1.0"', "")
            : installedPackage,
        ),
      },
    ],
    createdDirectories: [".topo"],
  };
  await writeFile(path.join(directory, "package.json"), installedPackage);
  await writeFile(
    path.join(directory, ".topo", "install.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return directory;
}

describe("Topo project lifecycle", () => {
  it("plans and applies the registered install-manifest v2 to v3 migration", async () => {
    const projectRoot = await installedProject({ schemaVersion: 2 });
    const manifestPath = path.join(projectRoot, ".topo", "install.json");
    const before = await readFile(manifestPath, "utf8");

    const plan = await planProjectMigration({
      projectRoot,
      now: "2026-08-01T12:00:00.000Z",
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      status: "ready",
      fromVersion: 2,
      toVersion: 3,
      steps: [
        {
          id: "install-manifest-v2-to-v3",
          sourceVersion: 2,
          targetVersion: 3,
        },
      ],
    });
    expect(await readFile(manifestPath, "utf8")).toBe(before);

    const result = await applyProjectMigration(plan);
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "migrated",
      fromVersion: 2,
      toVersion: 3,
    });
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
      schemaVersion: 3,
      updatedAt: "2026-08-01T12:00:00.000Z",
      packageSpec: "^0.1.0",
    });
  });

  it("reports current and unsupported manifests without guessing", async () => {
    const currentRoot = await installedProject();
    await expect(
      planProjectMigration({ projectRoot: currentRoot }),
    ).resolves.toMatchObject({
      status: "current",
      fromVersion: 3,
      toVersion: 3,
    });

    const unsupportedRoot = await installedProject();
    await writeFile(
      path.join(unsupportedRoot, ".topo", "install.json"),
      '{"schemaVersion":1,"createdBy":"topo init"}\n',
    );
    await expect(
      planProjectMigration({ projectRoot: unsupportedRoot }),
    ).resolves.toMatchObject({
      status: "conflict",
      fromVersion: 1,
      conflicts: [expect.stringContaining("no registered migration")],
    });
  });

  it("rejects a stale migration plan before writing", async () => {
    const projectRoot = await installedProject({ schemaVersion: 2 });
    const manifestPath = path.join(projectRoot, ".topo", "install.json");
    const plan = await planProjectMigration({ projectRoot });
    await writeFile(manifestPath, '{"schemaVersion":2,"changed":true}\n');

    await expect(applyProjectMigration(plan)).rejects.toThrow("stale");
    await expect(readFile(manifestPath, "utf8")).resolves.toContain(
      '"changed":true',
    );
  });

  it("updates only Topo package ownership and preserves unrelated project changes", async () => {
    const projectRoot = await installedProject({ userDependency: true });
    const plan = await planProjectUpdate({
      projectRoot,
      targetVersion: "0.2.0",
      now: "2026-08-01T13:00:00.000Z",
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      status: "ready",
      currentVersion: "0.1.0",
      targetVersion: "0.2.0",
      packageSpec: "^0.2.0",
      installCommand: ["pnpm", "install"],
      changedPaths: ["package.json", ".topo/install.json"],
    });
    const result = await applyProjectUpdate(plan);
    expect(result.status).toBe("updated");

    const updatedPackage = JSON.parse(
      await readFile(path.join(projectRoot, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(updatedPackage).toMatchObject({
      scripts: { test: "vitest", topo: "topo dev" },
      dependencies: { next: "16.0.0", react: "19.1.0" },
      devDependencies: { "@topo/cli": "^0.2.0" },
    });

    const updatedManifest = JSON.parse(
      await readFile(path.join(projectRoot, ".topo", "install.json"), "utf8"),
    ) as {
      topoVersion: string;
      packageSpec: string;
      updatedAt: string;
      files: Array<{ path: string; beforeContent?: string; afterHash: string }>;
    };
    expect(updatedManifest).toMatchObject({
      topoVersion: "0.2.0",
      packageSpec: "^0.2.0",
      updatedAt: "2026-08-01T13:00:00.000Z",
    });
    const packageRecord = updatedManifest.files.find(
      (file) => file.path === "package.json",
    );
    expect(packageRecord?.beforeContent).toContain('"react": "19.1.0"');
    expect(packageRecord?.beforeContent).not.toContain('"@topo/cli"');
    expect(packageRecord?.beforeContent).not.toContain('"topo": "topo dev"');
    expect(packageRecord?.afterHash).toBe(
      hash(await readFile(path.join(projectRoot, "package.json"), "utf8")),
    );
  });

  it("refuses to overwrite a project-owned topo script", async () => {
    const projectRoot = await installedProject();
    const packagePath = path.join(projectRoot, "package.json");
    const value = JSON.parse(await readFile(packagePath, "utf8")) as {
      scripts: Record<string, string>;
    };
    value.scripts.topo = "custom-command";
    await writeFile(packagePath, `${JSON.stringify(value, null, 2)}\n`);

    const plan = await planProjectUpdate({
      projectRoot,
      targetVersion: "0.2.0",
    });
    expect(plan).toMatchObject({
      status: "conflict",
      conflicts: [expect.stringContaining('script "topo"')],
    });
    await expect(applyProjectUpdate(plan)).rejects.toThrow("conflicts");
    await expect(readFile(packagePath, "utf8")).resolves.toContain(
      "custom-command",
    );
  });
});
