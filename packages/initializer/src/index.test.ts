import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyInitialization,
  applyUninstall,
  planInitialization,
  planUninstall,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function projectFixture(manifest: object): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "topo-init-"));
  temporaryDirectories.push(directory);
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return directory;
}

describe("Topo initializer", () => {
  it("detects local tooling and returns every proposed change without writing", async () => {
    const projectRoot = await projectFixture({
      name: "fixture",
      packageManager: "pnpm@10.12.1",
      scripts: { dev: "next dev --port 3210" },
      dependencies: { next: "16.0.0", msw: "2.0.0" },
      devDependencies: {
        "@storybook/react": "9.0.0",
        "@playwright/test": "1.55.0",
      },
    });
    await mkdir(path.join(projectRoot, "fixtures"));

    const plan = await planInitialization({
      projectRoot,
      now: "2026-08-01T00:00:00.000Z",
    });

    expect(plan.status).toBe("ready");
    expect(plan.detection).toMatchObject({
      packageManager: "pnpm",
      monorepo: false,
      selectedApplication: {
        path: ".",
        framework: "next",
        storybook: true,
        playwright: true,
        fixtures: true,
        mocks: true,
      },
    });
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "topo.config.ts", action: "create" }),
        expect.objectContaining({ path: ".gitignore", action: "create" }),
        expect.objectContaining({ path: "package.json", action: "update" }),
      ]),
    );
    expect(
      await readFile(path.join(projectRoot, "package.json"), "utf8"),
    ).not.toContain('"topo"');
  });

  it("requires an explicit application when a monorepo has multiple apps", async () => {
    const projectRoot = await projectFixture({
      name: "monorepo",
      packageManager: "pnpm@10.12.1",
    });
    for (const [name, dependency] of [
      ["web", { next: "16.0.0" }],
      ["admin", { "@tanstack/react-start": "1.0.0" }],
    ] as const) {
      const directory = path.join(projectRoot, "apps", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "package.json"),
        `${JSON.stringify({ name, dependencies: dependency })}\n`,
      );
    }

    const unresolved = await planInitialization({ projectRoot });
    expect(unresolved.status).toBe("selection-required");
    expect(unresolved.detection.applications).toHaveLength(2);

    const selected = await planInitialization({
      projectRoot,
      application: "apps/admin",
    });
    expect(selected.status).toBe("ready");
    expect(selected.sourceRoot).toBe(path.join(projectRoot, "apps", "admin"));
    const config = selected.operations.find(
      (operation) =>
        operation.kind === "file" && operation.path === "topo.config.ts",
    );
    expect(config).toMatchObject({ action: "create" });
    expect(
      config && "afterContent" in config ? config.afterContent : "",
    ).toContain('rootDir: "apps/admin"');
  });

  it.each([
    ["react", { react: "19.2.0", vite: "8.2.0" }, 5173],
    ["vue", { vue: "3.5.0", vite: "8.2.0" }, 5173],
    ["nuxt", { nuxt: "4.0.0", vue: "3.5.0" }, 3000],
    [
      "svelte",
      { svelte: "5.0.0", "@sveltejs/kit": "2.0.0", vite: "8.2.0" },
      5173,
    ],
  ] as const)(
    "detects %s and chooses its native default preview port",
    async (framework, dependencies, port) => {
      const projectRoot = await projectFixture({
        name: `${framework}-fixture`,
        scripts: { dev: framework === "nuxt" ? "nuxt dev" : "vite" },
        dependencies,
      });

      const plan = await planInitialization({ projectRoot });
      expect(plan.detection.selectedApplication?.framework).toBe(framework);
      const config = plan.operations.find(
        (operation) =>
          operation.kind === "file" && operation.path === "topo.config.ts",
      );
      expect(
        config && "afterContent" in config ? config.afterContent : "",
      ).toContain(`baseUrl: "http://localhost:${port}"`);
    },
  );

  it("applies transactionally and uninstalls only unchanged installation output", async () => {
    const projectRoot = await projectFixture({
      name: "fixture",
      dependencies: { next: "16.0.0" },
    });
    const originalPackage = await readFile(
      path.join(projectRoot, "package.json"),
      "utf8",
    );
    const plan = await planInitialization({
      projectRoot,
      now: "2026-08-01T00:00:00.000Z",
    });
    const result = await applyInitialization(plan);

    expect(result.status).toBe("installed");
    expect(
      JSON.parse(await readFile(result.manifestPath, "utf8")),
    ).toMatchObject({
      schemaVersion: 3,
      packageSpec: "^0.1.0",
      sourceRoot: ".",
      packageManager: "npm",
    });
    expect(await planInitialization({ projectRoot })).toMatchObject({
      status: "already-installed",
    });

    const uninstallPlan = await planUninstall(projectRoot);
    expect(uninstallPlan.status).toBe("ready");
    expect((await applyUninstall(uninstallPlan)).status).toBe("uninstalled");
    expect(await readFile(path.join(projectRoot, "package.json"), "utf8")).toBe(
      originalPackage,
    );
    await expect(
      readFile(path.join(projectRoot, "topo.config.ts")),
    ).rejects.toThrow();
  });

  it("refuses a drifted uninstall before changing any file", async () => {
    const projectRoot = await projectFixture({
      name: "fixture",
      dependencies: { next: "16.0.0" },
    });
    await applyInitialization(await planInitialization({ projectRoot }));
    await writeFile(
      path.join(projectRoot, "topo.config.ts"),
      "export default { rootDir: 'custom' };\n",
    );

    const plan = await planUninstall(projectRoot);
    expect(plan.status).toBe("conflict");
    await expect(applyUninstall(plan)).rejects.toThrow("no files were changed");
    expect(
      await readFile(path.join(projectRoot, "package.json"), "utf8"),
    ).toContain('"topo": "topo dev"');
  });

  it("preserves legacy installation evidence instead of guessing", async () => {
    const projectRoot = await projectFixture({
      name: "fixture",
      dependencies: { next: "16.0.0" },
    });
    await mkdir(path.join(projectRoot, ".topo"));
    await writeFile(
      path.join(projectRoot, ".topo", "install.json"),
      '{"version":1,"createdBy":"topo init"}\n',
    );

    const plan = await planInitialization({ projectRoot });
    expect(plan.status).toBe("conflict");
    expect(plan.conflicts[0]).toContain("migrate explicitly");
  });
});
