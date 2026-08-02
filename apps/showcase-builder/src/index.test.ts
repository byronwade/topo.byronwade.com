import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildStudioShowcase,
  SHOWCASE_GENERATOR,
  type StudioShowcaseManifest,
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

async function createStudioBuild(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "topo-showcase-source-"),
  );
  temporaryDirectories.push(directory);
  await fs.mkdir(path.join(directory, "assets"));
  await fs.writeFile(
    path.join(directory, "index.html"),
    '<!doctype html><link rel="icon" href="/favicon.svg"><meta name="topo-daemon-url" content="__TOPO_DAEMON_URL__"><div id="root"></div><script type="module" src="/assets/index.js"></script>',
  );
  await fs.writeFile(path.join(directory, "favicon.svg"), "<svg></svg>\n");

  const manifest: Record<string, unknown> = {
    "index.html": {
      file: "assets/index.js",
      src: "index.html",
      isEntry: true,
      dynamicImports: [
        ...destinationSources,
        reviewExportSource,
        validationSource,
      ],
    },
    "src/PixiAtlasCanvas.tsx": {
      file: "assets/pixi.js",
      src: "src/PixiAtlasCanvas.tsx",
      isDynamicEntry: true,
    },
    [reviewExportSource]: {
      file: "assets/review-export.js",
      src: reviewExportSource,
      isDynamicEntry: true,
    },
    [validationSource]: {
      file: "assets/studio-validation.js",
      src: validationSource,
      isDynamicEntry: true,
    },
  };
  await fs.writeFile(
    path.join(directory, "assets", "index.js"),
    "export {};\n",
  );
  await fs.writeFile(
    path.join(directory, "assets", "pixi.js"),
    "export const pixi = true;\n",
  );
  await fs.writeFile(
    path.join(directory, "assets", "review-export.js"),
    "export const review = true;\n",
  );
  await fs.writeFile(
    path.join(directory, "assets", "studio-validation.js"),
    "export const parseGraph = (value) => value;\n",
  );
  for (const [index, source] of destinationSources.entries()) {
    const file = `assets/destination-${index}.js`;
    manifest[source] = { file, src: source, isDynamicEntry: true };
    await fs.writeFile(
      path.join(directory, file),
      `export const id = ${index};\n`,
    );
  }
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("buildStudioShowcase", () => {
  it("publishes a rebased, hashed, deterministic Studio artifact", async () => {
    const sourceDir = await createStudioBuild();
    const outputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-showcase-parent-"),
    );
    temporaryDirectories.push(outputDir);
    const siteDir = path.join(outputDir, "site");
    const generatedAt = "2026-08-02T12:00:00.000Z";

    const first = await buildStudioShowcase({
      sourceDir,
      outputDir: siteDir,
      basePath: "/_topo-studio/",
      routeBase: "/demo-studio/",
      generatedAt,
    });
    const html = await fs.readFile(path.join(siteDir, "index.html"), "utf8");
    expect(html).toContain('href="/_topo-studio/favicon.svg"');
    expect(html).toContain('src="/_topo-studio/assets/index.js"');
    expect(html).not.toContain("__TOPO_DAEMON_URL__");
    expect(first.manifest).toMatchObject({
      generator: SHOWCASE_GENERATOR,
      generatedAt,
      basePath: "/_topo-studio",
      routeBase: "/demo-studio",
      entry: "/demo-studio/welcome?demo=1&source=website",
      status: "pass",
      sourceBuild: { status: "pass" },
    });
    expect(first.manifest.files.map((file) => file.path)).toEqual(
      [...first.manifest.files.map((file) => file.path)].sort(),
    );
    expect(first.manifest.summary.fileCount).toBe(first.manifest.files.length);

    const second = await buildStudioShowcase({
      sourceDir,
      outputDir: siteDir,
      basePath: "/_topo-studio",
      routeBase: "/demo-studio",
      generatedAt,
    });
    expect(second.manifest.files).toEqual(first.manifest.files);
    expect(second.manifest.sourceBuild.reportSha256).toBe(
      first.manifest.sourceBuild.reportSha256,
    );
    const persisted = JSON.parse(
      await fs.readFile(second.manifestPath, "utf8"),
    ) as StudioShowcaseManifest;
    expect(persisted).toEqual(second.manifest);
  });

  it("refuses to replace output that it does not own", async () => {
    const sourceDir = await createStudioBuild();
    const outputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-showcase-unowned-"),
    );
    temporaryDirectories.push(outputDir);
    await fs.writeFile(path.join(outputDir, "keep.txt"), "user data");

    await expect(
      buildStudioShowcase({
        sourceDir,
        outputDir,
        basePath: "/assets",
        routeBase: "/demo",
      }),
    ).rejects.toThrow(/unowned showcase output/);
    expect(await fs.readFile(path.join(outputDir, "keep.txt"), "utf8")).toBe(
      "user data",
    );
  });

  it("rejects unsafe source and URL boundaries", async () => {
    const sourceDir = await createStudioBuild();
    await expect(
      buildStudioShowcase({
        sourceDir,
        outputDir: path.join(sourceDir, "nested"),
        basePath: "/assets",
        routeBase: "/demo",
      }),
    ).rejects.toThrow(/must not contain each other/);
    await expect(
      buildStudioShowcase({
        sourceDir,
        outputDir: `${sourceDir}-output`,
        basePath: "/../assets",
        routeBase: "/demo",
      }),
    ).rejects.toThrow(/dot segments/);
  });

  it("rejects a Studio bundle that fails production checks", async () => {
    const sourceDir = await createStudioBuild();
    const manifestPath = path.join(sourceDir, "manifest.json");
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, "utf8"),
    ) as Record<string, { dynamicImports?: string[] }>;
    manifest["index.html"]!.dynamicImports = [];
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    await expect(
      buildStudioShowcase({
        sourceDir,
        outputDir: `${sourceDir}-output`,
        basePath: "/assets",
        routeBase: "/demo",
      }),
    ).rejects.toThrow(/failed checks/);
  });

  it("rejects a missing relative HTML asset", async () => {
    const sourceDir = await createStudioBuild();
    await fs.appendFile(
      path.join(sourceDir, "index.html"),
      '<script src="./missing.js"></script>',
    );

    await expect(
      buildStudioShowcase({
        sourceDir,
        outputDir: `${sourceDir}-output`,
        basePath: "/assets",
        routeBase: "/demo",
      }),
    ).rejects.toThrow(/missing asset/);
  });

  it("rejects a source root reached through a filesystem link", async () => {
    const sourceDir = await createStudioBuild();
    const linkParent = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-showcase-link-"),
    );
    temporaryDirectories.push(linkParent);
    const sourceLink = path.join(linkParent, "source-link");
    try {
      await fs.symlink(
        sourceDir,
        sourceLink,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(
      buildStudioShowcase({
        sourceDir: sourceLink,
        outputDir: path.join(linkParent, "output"),
        basePath: "/assets",
        routeBase: "/demo",
      }),
    ).rejects.toThrow(/must not traverse symbolic links/);
  });
});
