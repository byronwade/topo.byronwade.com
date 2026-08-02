import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig, defineConfig, resolveProject } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("topo config", () => {
  it("provides a safe loopback default", () => {
    expect(defaultConfig().daemon).toEqual({ host: "127.0.0.1", port: 4599 });
    expect(defaultConfig().extensions).toEqual({
      frameworkAdapters: [],
      componentPreviewAdapters: [],
      apiEndpointAdapters: [],
      flowAdapters: [],
      applicationRuntimeAdapters: [],
    });
    expect(defaultConfig().preview.componentBaseUrls).toEqual({
      storybook: "http://127.0.0.1:6006",
    });
    expect(defaultConfig().preview.components).toEqual({});
    expect(defaultConfig().preview.routes).toEqual({});
    expect(defaultConfig().preview.server).toEqual({
      mode: "auto",
      cwd: ".",
      readyTimeoutMs: 45_000,
    });
    expect(defaultConfig().preview.autoCapture).toBe(true);
    expect(defaultConfig().studio).toEqual({
      remove: { destinations: [], commands: [] },
      destinations: {},
      commands: {},
    });
    expect(defaultConfig().atlas).toEqual({
      version: 1,
      routeGroups: {},
      componentGroups: {},
    });
  });

  it("normalizes keyed atlas route and component groups", () => {
    expect(
      defineConfig({
        atlas: {
          routeGroups: {
            workspace: {
              label: "Workspace",
              prefixes: ["/jobs", "/settings"],
            },
            administration: {
              label: "Administration",
              order: 10,
              prefixes: ["/admin"],
            },
          },
          componentGroups: {
            design: {
              label: "Design system",
              prefixes: ["src/components/ui"],
            },
          },
        },
      }).atlas,
    ).toEqual({
      version: 1,
      routeGroups: {
        workspace: {
          label: "Workspace",
          order: 100,
          prefixes: ["/jobs", "/settings"],
        },
        administration: {
          label: "Administration",
          order: 10,
          prefixes: ["/admin"],
        },
      },
      componentGroups: {
        design: {
          label: "Design system",
          order: 100,
          prefixes: ["src/components/ui"],
        },
      },
    });
  });

  it("accepts a compact project-owned Studio customization", () => {
    expect(
      defineConfig({
        studio: {
          remove: { destinations: ["editor"], commands: ["capture"] },
          destinations: {
            atlas: { label: "Map" },
            reviews: { url: "http://127.0.0.1:4400/reviews" },
          },
          commands: {
            doctor: { label: "Run checks" },
            openReviews: { to: "reviews" },
          },
        },
      }).studio,
    ).toMatchObject({
      remove: { destinations: ["editor"], commands: ["capture"] },
      destinations: {
        atlas: { label: "Map" },
        reviews: { url: "http://127.0.0.1:4400/reviews" },
      },
      commands: {
        doctor: { label: "Run checks" },
        openReviews: { to: "reviews" },
      },
    });
  });

  it("allows projects to disable automatic evidence refreshes explicitly", () => {
    expect(
      defineConfig({ preview: { autoCapture: false } }).preview.autoCapture,
    ).toBe(false);
  });

  it("accepts simple concrete examples for parameterized routes", () => {
    expect(
      defineConfig({
        preview: {
          routes: {
            "/customers/[customerId]": "/customers/customer-demo",
            "/jobs/:jobId": "/jobs/job-1042?panel=summary",
          },
        },
      }).preview.routes,
    ).toEqual({
      "/customers/[customerId]": "/customers/customer-demo",
      "/jobs/:jobId": "/jobs/job-1042?panel=summary",
    });
  });

  it("normalizes preview profiles", () => {
    expect(defineConfig({ profiles: [{ name: "Owner" }] }).profiles[0]).toEqual(
      {
        name: "Owner",
        headers: {},
        cookies: [],
        localStorage: {},
      },
    );
  });

  it("accepts project-installed framework adapter modules", () => {
    expect(
      defineConfig({
        extensions: { frameworkAdapters: ["@acme/topo-adapter-remix"] },
      }).extensions,
    ).toEqual({
      frameworkAdapters: ["@acme/topo-adapter-remix"],
      componentPreviewAdapters: [],
      apiEndpointAdapters: [],
      flowAdapters: [],
      applicationRuntimeAdapters: [],
    });
  });

  it("accepts project-installed preview adapters and adapter-specific capture origins", () => {
    const config = defineConfig({
      extensions: {
        componentPreviewAdapters: ["@acme/topo-preview-adapter"],
      },
      preview: {
        componentBaseUrls: { "acme.preview": "http://127.0.0.1:6100" },
      },
    });

    expect(config.extensions.componentPreviewAdapters).toEqual([
      "@acme/topo-preview-adapter",
    ]);
    expect(config.preview.componentBaseUrls["acme.preview"]).toBe(
      "http://127.0.0.1:6100",
    );
  });

  it("normalizes compact configured and accepted AI component previews", () => {
    const config = defineConfig({
      preview: {
        components: {
          "src/components/StatusCard.tsx": {
            source: "src/previews/StatusCard.preview.tsx",
            exportName: "ConfiguredStatusCard",
            title: "Configured status",
          },
          "src/components/SummaryCard.tsx": [
            {
              source: "src/previews/SummaryCard.generated.tsx",
              exportName: "AcceptedSummaryCard",
              provenance: "ai-accepted",
            },
          ],
        },
      },
    });

    expect(config.preview.components).toEqual({
      "src/components/StatusCard.tsx": [
        {
          source: "src/previews/StatusCard.preview.tsx",
          exportName: "ConfiguredStatusCard",
          title: "Configured status",
          provenance: "configured",
        },
      ],
      "src/components/SummaryCard.tsx": [
        {
          source: "src/previews/SummaryCard.generated.tsx",
          exportName: "AcceptedSummaryCard",
          provenance: "ai-accepted",
        },
      ],
    });
  });

  it("rejects configured preview paths that can escape the source root", () => {
    expect(() =>
      defineConfig({
        preview: {
          components: {
            "../outside.tsx": {
              source: "src/previews/Outside.tsx",
            },
          },
        },
      }),
    ).toThrow(/workspace-relative POSIX path/);
    expect(() =>
      defineConfig({
        preview: {
          components: {
            "src/components/Card.tsx": {
              source: "..\\Outside.tsx",
            },
          },
        },
      }),
    ).toThrow(/workspace-relative POSIX path/);
  });

  it("normalizes the native application runtime policy", () => {
    const config = defineConfig({
      extensions: {
        applicationRuntimeAdapters: ["@acme/topo-runtime"],
      },
      preview: {
        server: {
          mode: "managed",
          command: ["pnpm", "dev"],
          cwd: "apps/web",
          readyTimeoutMs: 60_000,
        },
      },
    });

    expect(config.preview.server).toEqual({
      mode: "managed",
      command: ["pnpm", "dev"],
      cwd: "apps/web",
      readyTimeoutMs: 60_000,
    });
    expect(config.extensions.applicationRuntimeAdapters).toEqual([
      "@acme/topo-runtime",
    ]);
  });

  it("resolves durable project ownership separately from nested source", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "topo-project-"));
    temporaryDirectories.push(projectRoot);
    await mkdir(path.join(projectRoot, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "topo.config.ts"),
      'export default { rootDir: "apps/web" };\n',
      "utf8",
    );

    const project = await resolveProject(projectRoot);

    expect(project.projectRoot).toBe(path.resolve(projectRoot));
    expect(project.sourceRoot).toBe(path.join(projectRoot, "apps", "web"));
    expect(project.configPath).toBe(path.join(projectRoot, "topo.config.ts"));
    expect(project.config.rootDir).toBe("apps/web");
    expect(Object.isFrozen(project)).toBe(true);
  });

  it("accepts platform paths for an explicitly selected application source", () => {
    expect(defineConfig({ rootDir: "." }).rootDir).toBe(".");
    expect(defineConfig({ rootDir: "apps/web" }).rootDir).toBe("apps/web");
    expect(defineConfig({ rootDir: "../outside" }).rootDir).toBe("../outside");
    expect(defineConfig({ rootDir: path.join("apps", "web") }).rootDir).toBe(
      path.join("apps", "web"),
    );
    expect(() => defineConfig({ rootDir: "" })).toThrow(
      /identify an application directory/,
    );
    expect(() => defineConfig({ rootDir: "\0" })).toThrow(/without null bytes/);
  });

  it("fails before scanning when the configured application root is missing or not a directory", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "topo-project-"));
    temporaryDirectories.push(projectRoot);
    await writeFile(
      path.join(projectRoot, "topo.config.ts"),
      'export default { rootDir: "apps/missing" };\n',
      "utf8",
    );
    await expect(resolveProject(projectRoot)).rejects.toThrow(
      /application root does not exist/,
    );

    const fileProjectRoot = await mkdtemp(
      path.join(os.tmpdir(), "topo-project-"),
    );
    temporaryDirectories.push(fileProjectRoot);
    await mkdir(path.join(fileProjectRoot, "apps"));
    await writeFile(
      path.join(fileProjectRoot, "apps", "web"),
      "not a directory",
    );
    await writeFile(
      path.join(fileProjectRoot, "topo.config.ts"),
      'export default { rootDir: "apps/web" };\n',
      "utf8",
    );
    await expect(resolveProject(fileProjectRoot)).rejects.toThrow(
      /application root is not a directory/,
    );
  });

  it("supports an explicit external application root without changing durable project ownership", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "topo-project-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "topo-outside-"));
    temporaryDirectories.push(projectRoot, outsideRoot);
    await writeFile(
      path.join(projectRoot, "topo.config.ts"),
      `export default { rootDir: ${JSON.stringify(outsideRoot)} };\n`,
      "utf8",
    );

    const project = await resolveProject(projectRoot);

    expect(project.projectRoot).toBe(path.resolve(projectRoot));
    expect(project.sourceRoot).toBe(path.resolve(outsideRoot));
    expect(project.config.rootDir).toBe(outsideRoot);
  });

  it("supports a linked application root while retaining its configured logical path", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "topo-project-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "topo-outside-"));
    temporaryDirectories.push(projectRoot, outsideRoot);
    await mkdir(path.join(projectRoot, "apps"));
    await symlink(
      outsideRoot,
      path.join(projectRoot, "apps", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(
      path.join(projectRoot, "topo.config.ts"),
      'export default { rootDir: "apps/linked" };\n',
      "utf8",
    );

    const project = await resolveProject(projectRoot);

    expect(project.projectRoot).toBe(path.resolve(projectRoot));
    expect(project.sourceRoot).toBe(path.join(projectRoot, "apps", "linked"));
    expect(project.config.rootDir).toBe("apps/linked");
  });
});
