import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defineConfig } from "@topo/config";
import { emptyApplicationGraph } from "@topo/schema";
import { captureGraph as persistCaptureGraph } from "@topo/snapshots";
import { createProjectStateStore } from "@topo/storage";

import {
  classifyWatchedResource,
  createComponentPreviewRuntimeManager,
  createDaemon,
  type DaemonOptions,
} from "./index.js";

const temporaryDirectories: string[] = [];

const runDoctorFixture: NonNullable<DaemonOptions["runDoctor"]> = async ({
  project,
  graph,
}) => ({
  schemaVersion: 1,
  generatedAt: "2026-08-01T06:30:00.000Z",
  projectRoot: project.projectRoot,
  sourceRoot: project.sourceRoot,
  ok: true,
  summary: { total: 1, passed: 1, warnings: 0, errors: 0 },
  checks: [
    {
      id: "application.source-scan",
      scope: "application",
      title: "Source discovery",
      status: "pass",
      severity: "info",
      detail: `${graph.screens.length} screen(s) are present in the normalized graph.`,
      evidence: { screens: graph.screens.length },
    },
  ],
});

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for evidence");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("daemon", () => {
  it("classifies only authoritative durable resources for refresh", () => {
    expect(classifyWatchedResource(".topo/notes/review-home.md")).toBe("notes");
    expect(classifyWatchedResource(".topo/flows/checkout.json")).toBe("flows");
    expect(classifyWatchedResource("topo/adapters/acme/adapter.json")).toBe(
      "adapters",
    );
    expect(
      classifyWatchedResource(".topo/llm/records/note.jsonl"),
    ).toBeUndefined();
    expect(classifyWatchedResource(".topo/state.json")).toBeUndefined();
  });

  it("exposes a graph-aware inventory for built-in and project adapters", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-adapters-"),
    );
    temporaryDirectories.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, "app"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "topo", "adapters", "acme-routes"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.writeFile(
      path.join(projectRoot, "app", "page.tsx"),
      "export default function Page() { return <main>Home</main>; }\n",
    );
    await fs.writeFile(
      path.join(projectRoot, "topo", "adapters", "acme-routes", "adapter.json"),
      JSON.stringify({
        schemaVersion: 1,
        kind: "framework",
        id: "acme.routes",
        displayName: "Acme routes",
        source: "local",
        entry: "index.mjs",
        test: "index.test.mjs",
        registration: {
          configKey: "frameworkAdapters",
          moduleSpecifier: "./topo/adapters/acme-routes/index.mjs",
        },
        generatedBy: "topo adapters create",
      }),
    );
    await fs.writeFile(
      path.join(projectRoot, "topo", "adapters", "acme-routes", "index.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.routes",
  displayName: "Acme routes",
  detect() { return []; },
  scan() { return { routes: [] }; },
};
`,
    );

    const daemon = await createDaemon({
      projectRoot,
      config: defineConfig({
        preview: { autoCapture: false },
        extensions: {
          frameworkAdapters: ["./topo/adapters/acme-routes/index.mjs"],
        },
      }),
      host: "127.0.0.1",
      port: 0,
      watch: true,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();
    const controller = new AbortController();

    try {
      const baseUrl = `http://${daemon.host}:${daemon.port}`;
      const response = await fetch(`${baseUrl}/adapters`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        schemaVersion: 1,
        summary: { total: 17, active: 1, registered: 1, issues: 0 },
        adapters: expect.arrayContaining([
          expect.objectContaining({
            id: "builtin:framework:topo.next",
            status: "active",
            routeCount: 1,
          }),
          expect.objectContaining({
            id: "scaffold:framework:acme.routes",
            status: "registered",
            registered: true,
          }),
        ]),
      });

      const eventResponse = await fetch(`${baseUrl}/events`, {
        signal: controller.signal,
      });
      const reader = eventResponse.body!.getReader();
      const decoder = new TextDecoder();
      const readAdapterEvent = async () => {
        let buffer = "";
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Event stream closed unexpectedly");
          buffer += decoder.decode(chunk.value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            if (!block.startsWith("event: resource.updated")) continue;
            const data = block
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6);
            if (!data) continue;
            const event = JSON.parse(data) as { resource?: string };
            if (event.resource === "adapters") return event;
          }
        }
      };
      const adapterEvent = readAdapterEvent();
      const malformedDirectory = path.join(
        projectRoot,
        "topo",
        "adapters",
        "broken",
      );
      await fs.mkdir(malformedDirectory, { recursive: true });
      await fs.writeFile(
        path.join(malformedDirectory, "adapter.json"),
        '{"schemaVersion":1,"kind":"framework"}\n',
      );
      await expect(adapterEvent).resolves.toMatchObject({
        type: "resource.updated",
        resource: "adapters",
      });
      expect(await (await fetch(`${baseUrl}/adapters`)).json()).toMatchObject({
        summary: { issues: 1 },
      });
    } finally {
      controller.abort();
      await daemon.close();
    }
  });

  it("preserves third-party route adapter ownership through graph, inventory, and context", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-adapter-ownership-"),
    );
    temporaryDirectories.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, "views"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "topo", "adapters", "acme-routes"), {
      recursive: true,
    });
    await fs.writeFile(path.join(projectRoot, "package.json"), "{}\n");
    await fs.writeFile(
      path.join(projectRoot, "views", "home.tsx"),
      "export default function Home() { return <main>Home</main>; }\n",
    );
    await fs.writeFile(
      path.join(projectRoot, "topo", "adapters", "acme-routes", "adapter.json"),
      JSON.stringify({
        schemaVersion: 1,
        kind: "framework",
        id: "acme.routes",
        displayName: "Acme routes",
        source: "local",
        entry: "index.mjs",
        test: "index.test.mjs",
        registration: {
          configKey: "frameworkAdapters",
          moduleSpecifier: "./topo/adapters/acme-routes/index.mjs",
        },
        generatedBy: "topo adapters create",
      }),
    );
    await fs.writeFile(
      path.join(projectRoot, "topo", "adapters", "acme-routes", "index.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.routes",
  displayName: "Acme routes",
  detect: ({ files }) => files.some(({ filePath }) => filePath === "views/home.tsx")
    ? [{ framework: "acme-router", confidence: 1, reasons: ["views route"] }]
    : [],
  scan: ({ files }) => ({
    routes: files.filter(({ filePath }) => filePath === "views/home.tsx").map(({ filePath }) => ({
      framework: "acme-router",
      filePath,
      routePath: "/",
      state: "default"
    }))
  })
};
`,
    );

    const daemon = await createDaemon({
      projectRoot,
      config: defineConfig({
        preview: { autoCapture: false },
        extensions: {
          frameworkAdapters: ["./topo/adapters/acme-routes/index.mjs"],
        },
      }),
      host: "127.0.0.1",
      port: 0,
      watch: false,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();

    try {
      const baseUrl = `http://${daemon.host}:${daemon.port}`;
      const graph = (await (await fetch(`${baseUrl}/graph`)).json()) as {
        screens: Array<{ id: string; adapterId?: string }>;
      };
      const screen = graph.screens[0];
      expect(screen).toMatchObject({ adapterId: "acme.routes" });

      expect(await (await fetch(`${baseUrl}/adapters`)).json()).toMatchObject({
        summary: { active: 1, registered: 1, issues: 0 },
        adapters: expect.arrayContaining([
          expect.objectContaining({
            id: "scaffold:framework:acme.routes",
            status: "active",
            routeCount: 1,
            screenIds: [screen!.id],
          }),
        ]),
      });

      expect(
        await (
          await fetch(`${baseUrl}/context?kind=adapter,route,screen&limit=25`)
        ).json(),
      ).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: "adapter",
            id: "adapter:acme.routes",
            relationships: expect.arrayContaining([
              expect.objectContaining({
                type: "discovers-route",
                targetKind: "route",
              }),
            ]),
            data: expect.objectContaining({
              routeCount: 1,
              screenIds: [screen!.id],
            }),
          }),
          expect.objectContaining({
            kind: "route",
            relationships: expect.arrayContaining([
              {
                type: "discovered-by",
                targetKind: "adapter",
                targetId: "adapter:acme.routes",
              },
            ]),
            data: expect.objectContaining({ adapterIds: ["acme.routes"] }),
          }),
          expect.objectContaining({
            kind: "screen",
            id: screen!.id,
            relationships: expect.arrayContaining([
              {
                type: "discovered-by",
                targetKind: "adapter",
                targetId: "adapter:acme.routes",
              },
            ]),
            data: expect.objectContaining({ adapterId: "acme.routes" }),
          }),
        ]),
      });
    } finally {
      await daemon.close();
    }
  });

  it("exposes typed cache inspection and contained cleanup", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-cache-"),
    );
    temporaryDirectories.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, "app"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.writeFile(
      path.join(projectRoot, "app", "page.tsx"),
      "export default function Page() { return <main>Home</main>; }\n",
    );
    const daemon = await createDaemon({
      projectRoot,
      config: defineConfig({ preview: { autoCapture: false } }),
      host: "127.0.0.1",
      port: 0,
      watch: false,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();

    try {
      await fs.mkdir(path.join(projectRoot, ".topo", "cache", "textures"), {
        recursive: true,
      });
      await fs.mkdir(path.join(projectRoot, ".topo", "notes"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(projectRoot, ".topo", "cache", "textures", "home.bin"),
        "pixels",
      );
      const durableNote = path.join(projectRoot, ".topo", "notes", "keep.md");
      await fs.writeFile(durableNote, "keep");

      const baseUrl = `http://${daemon.host}:${daemon.port}`;
      const inspection = (await (await fetch(`${baseUrl}/cache`)).json()) as {
        totals: { bytes: number; files: number };
      };
      expect(inspection.totals).toMatchObject({ bytes: 6, files: 1 });

      const invalid = await fetch(`${baseUrl}/cache/clean`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: "yes" }),
      });
      expect(invalid.status).toBe(400);

      const dryRun = (await (
        await fetch(`${baseUrl}/cache/clean`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        })
      ).json()) as { dryRun: boolean; removed: { files: number } };
      expect(dryRun).toMatchObject({ dryRun: true, removed: { files: 1 } });
      await expect(
        fs.access(
          path.join(projectRoot, ".topo", "cache", "textures", "home.bin"),
        ),
      ).resolves.toBeUndefined();

      const cleaned = (await (
        await fetch(`${baseUrl}/cache/clean`, { method: "POST" })
      ).json()) as {
        dryRun: boolean;
        after: { totals: { files: number } };
      };
      expect(cleaned).toMatchObject({
        dryRun: false,
        after: { totals: { files: 0 } },
      });
      await expect(fs.access(durableNote)).resolves.toBeUndefined();
    } finally {
      await daemon.close();
    }
  });

  it("compacts legacy job history and exposes the retention evidence", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-job-retention-"),
    );
    temporaryDirectories.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, "app"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, ".topo"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.writeFile(
      path.join(projectRoot, "app", "page.tsx"),
      "export default function Page() { return <main>Home</main>; }\n",
    );
    await fs.writeFile(
      path.join(projectRoot, ".topo", "state.json"),
      `${JSON.stringify({
        version: 1,
        updatedAt: "2026-08-01T00:00:00.000Z",
        snapshots: [],
        previewArtifacts: [],
        interactionProbes: [],
        findings: [],
        jobs: [1, 2, 3].map((minute) => ({
          id: `job-${minute}`,
          kind: "scan",
          status: "completed",
          createdAt: `2026-08-01T00:0${minute}:00.000Z`,
          updatedAt: `2026-08-01T00:0${minute}:00.000Z`,
          progress: 1,
        })),
      })}\n`,
    );

    const daemon = await createDaemon({
      projectRoot,
      config: defineConfig({ preview: { autoCapture: false } }),
      host: "127.0.0.1",
      port: 0,
      watch: false,
      terminalJobLimit: 2,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();

    try {
      const response = await fetch(`http://${daemon.host}:${daemon.port}/jobs`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        schemaVersion: 1,
        jobs: [
          expect.objectContaining({ id: "job-3", status: "completed" }),
          expect.objectContaining({ id: "job-2", status: "completed" }),
        ],
        retention: { terminalLimit: 2, retained: 2, pruned: 1 },
      });

      const persisted = JSON.parse(
        await fs.readFile(
          path.join(projectRoot, ".topo", "state.json"),
          "utf8",
        ),
      ) as {
        jobs: Array<{ id: string }>;
        jobHistory: {
          terminalLimit: number;
          retained: number;
          pruned: number;
        };
      };
      expect(persisted.jobs.map((job) => job.id)).toEqual(["job-3", "job-2"]);
      expect(persisted.jobHistory).toEqual({
        terminalLimit: 2,
        retained: 2,
        pruned: 1,
      });
    } finally {
      await daemon.close();
    }
  });

  it("exposes sanitized runtime preview sessions without replacing the native capture origin", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-preview-sessions-"),
    );
    temporaryDirectories.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, "app"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        name: "preview-app",
        dependencies: { next: "^16.0.0" },
      }),
    );
    await fs.writeFile(
      path.join(projectRoot, "app", "page.tsx"),
      "export default function Page() { return <main>Home</main>; }\n",
    );
    const config = defineConfig({
      preview: {
        baseUrl: "http://127.0.0.1:3000",
        autoCapture: false,
        headless: false,
        viewport: { width: 1280, height: 800 },
      },
      profiles: [{ name: "Owner" }, { name: "Customer" }],
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
    });
    const previewSessions = [
      {
        profileName: "Owner",
        baseUrl: "http://127.0.0.1:4180/",
        launchUrl: "http://127.0.0.1:4180/?topo_session=opaque-owner-token",
        expiresAt: "2026-08-01T20:00:00.000Z",
      },
      {
        profileName: "Customer",
        baseUrl: "http://127.0.0.1:4181/",
        launchUrl: "http://127.0.0.1:4181/?topo_session=opaque-customer-token",
        expiresAt: "2026-08-01T20:00:00.000Z",
      },
    ] as const;
    const daemon = await createDaemon({
      projectRoot,
      config,
      host: "127.0.0.1",
      port: 0,
      watch: false,
      previewSessions,
      livePreviewBaseUrl: previewSessions[0].baseUrl,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();
    try {
      const baseUrl = `http://${daemon.host}:${daemon.port}`;
      expect((await daemon.getGraph()).previewBaseUrl).toBe(
        previewSessions[0].baseUrl,
      );
      expect(await (await fetch(`${baseUrl}/preview/sessions`)).json()).toEqual(
        { schemaVersion: 1, sessions: previewSessions },
      );
      expect(await (await fetch(`${baseUrl}/project`)).json()).toEqual({
        schemaVersion: 1,
        name: "preview-app",
        projectRoot,
        sourceRoot: projectRoot,
        configPath: path.join(projectRoot, "topo.config.ts"),
        capture: {
          version: 1,
          autoCapture: false,
          headless: false,
          viewport: { width: 1280, height: 800 },
        },
      });
      expect(await (await fetch(`${baseUrl}/studio`)).json()).toMatchObject({
        schemaVersion: 1,
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
      const context = (await (
        await fetch(`${baseUrl}/context?q=opaque-owner-token&limit=10`)
      ).json()) as { items: unknown[] };
      expect(context.items).toEqual([]);
      const projectContext = (await (
        await fetch(`${baseUrl}/context?kind=project&limit=1`)
      ).json()) as { items: Array<{ data: Record<string, unknown> }> };
      expect(projectContext.items[0]?.data.studio).toMatchObject({
        destinations: {
          atlas: { label: "Map" },
          reviews: { url: "http://127.0.0.1:4400/reviews" },
        },
      });
      expect(projectContext.items[0]?.data.capture).toEqual({
        version: 1,
        autoCapture: false,
        headless: false,
        viewport: { width: 1280, height: 800 },
      });
      expect(config.preview.baseUrl).toBe("http://127.0.0.1:3000");
    } finally {
      await daemon.close();
    }
  });

  it("serves configured route organization to Studio, scenes, and bounded LLM queries", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-atlas-organization-"),
    );
    temporaryDirectories.push(projectRoot);
    await Promise.all(
      ["app", "app/jobs", "app/settings/profile"].map((directory) =>
        fs.mkdir(path.join(projectRoot, directory), { recursive: true }),
      ),
    );
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await Promise.all([
      fs.writeFile(
        path.join(projectRoot, "app", "page.tsx"),
        "export default function Page() { return <main>Home</main>; }\n",
      ),
      fs.writeFile(
        path.join(projectRoot, "app", "jobs", "page.tsx"),
        "export default function Page() { return <main>Jobs</main>; }\n",
      ),
      fs.writeFile(
        path.join(projectRoot, "app", "settings", "profile", "page.tsx"),
        "export default function Page() { return <main>Profile</main>; }\n",
      ),
    ]);
    const config = defineConfig({
      preview: { autoCapture: false },
      atlas: {
        routeGroups: {
          workspace: {
            label: "Workspace",
            order: 10,
            prefixes: ["/jobs", "/settings"],
          },
        },
      },
    });
    const daemon = await createDaemon({
      projectRoot,
      config,
      host: "127.0.0.1",
      port: 0,
      watch: false,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();

    try {
      const baseUrl = `http://${daemon.host}:${daemon.port}`;
      expect(
        await (await fetch(`${baseUrl}/atlas/organization`)).json(),
      ).toEqual(config.atlas);

      const scene = (await (await fetch(`${baseUrl}/atlas/scene`)).json()) as {
        routeMap: {
          sections: Array<{
            id: string;
            groupIds: string[];
          }>;
          groups: Array<{
            id: string;
            label: string;
            routeNodeIds: string[];
          }>;
        };
      };
      expect(scene.routeMap.groups).toMatchObject([
        { id: "/", label: "Entry", routeNodeIds: ["route:/"] },
        {
          id: "workspace",
          label: "Workspace",
          routeNodeIds: ["route:/jobs", "route:/settings/profile"],
        },
      ]);
      expect(scene.routeMap.sections).toMatchObject([
        { id: "section:top-level", groupIds: ["/"] },
        { id: "section:configured:workspace", groupIds: ["workspace"] },
      ]);

      const query = (await (
        await fetch(`${baseUrl}/context?q=Workspace&kind=project&limit=1`)
      ).json()) as { items: Array<{ data: Record<string, unknown> }> };
      expect(query.items).toHaveLength(1);
      expect(query.items[0]?.data.atlas).toEqual(config.atlas);
    } finally {
      await daemon.close();
    }
  });

  it("keeps nested application source separate from project-owned durable context", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-monorepo-"),
    );
    temporaryDirectories.push(projectRoot);
    const sourceRoot = path.join(projectRoot, "apps", "web");
    await fs.mkdir(path.join(sourceRoot, "app"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "topo-monorepo-fixture" }),
    );
    await fs.writeFile(
      path.join(sourceRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.writeFile(
      path.join(sourceRoot, "app", "page.tsx"),
      "export default function Page() { return <main>Home</main>; }\n",
    );
    const daemon = await createDaemon({
      projectRoot,
      config: defineConfig({
        rootDir: "apps/web",
        preview: { autoCapture: false },
      }),
      host: "127.0.0.1",
      port: 0,
      watch: true,
    });
    await daemon.listen();

    try {
      expect((await daemon.getGraph()).rootDir).toBe(sourceRoot);
      await fs.mkdir(path.join(sourceRoot, "app", "about"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(sourceRoot, "app", "about", "page.tsx"),
        "export default function Page() { return <main>About</main>; }\n",
      );
      await waitFor(async () =>
        (await daemon.getGraph()).screens.some(
          (screen) => screen.routePath === "/about",
        ),
      );

      const baseUrl = `http://${daemon.host}:${daemon.port}`;
      const noteResponse = await fetch(`${baseUrl}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Project-owned note",
          body: "Stored beside the monorepo configuration.",
          type: "screen",
          targetRoute: "/about",
        }),
      });
      expect(noteResponse.status).toBe(201);
      const note = (await noteResponse.json()) as { id: string };
      await expect(
        fs.access(path.join(projectRoot, ".topo", "notes", `${note.id}.md`)),
      ).resolves.toBeUndefined();
      await expect(fs.access(path.join(sourceRoot, ".topo"))).rejects.toThrow();

      const manifestResponse = await fetch(`${baseUrl}/context/manifest`);
      expect(await manifestResponse.json()).toMatchObject({
        schemaVersion: 7,
        project: { projectRoot, sourceRoot, rootDir: sourceRoot },
      });
    } finally {
      await daemon.close();
    }
  });

  it("rescans and recaptures only source-impacted screens after a watched change", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-watch-"),
    );
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.mkdir(path.join(directory, "app", "customers"), {
      recursive: true,
    });
    const homePath = path.join(directory, "app", "page.tsx");
    await fs.writeFile(
      homePath,
      "export default function Page() { return <main>Home</main>; }\n",
    );
    await fs.writeFile(
      path.join(directory, "app", "customers", "page.tsx"),
      "export default function Page() { return <main>Customers</main>; }\n",
    );
    const captureScopes: string[][] = [];
    const daemon = await createDaemon({
      projectRoot: directory,
      host: "127.0.0.1",
      port: 0,
      watch: true,
      captureRoutes: async (options) => {
        captureScopes.push([...(options.screenIds ?? [])]);
        return persistCaptureGraph({
          ...options,
          capture: async ({ routePath }) => ({
            url: `http://localhost:3000${routePath}`,
            title: routePath,
            screenshot: Buffer.from(`capture:${routePath}`),
            width: 800,
            height: 600,
            capturedAt: "2026-08-01T05:00:00.000Z",
          }),
        });
      },
    });
    await daemon.listen();

    try {
      const initial = await daemon.getGraph();
      const home = initial.screens.find((screen) => screen.routePath === "/");
      const customers = initial.screens.find(
        (screen) => screen.routePath === "/customers",
      );
      if (!home || !customers) throw new Error("Expected route fixtures");

      await fs.writeFile(
        homePath,
        "export default function Page() { return <main>Updated home</main>; }\n",
      );
      let capturedContext: unknown;
      try {
        await waitFor(async () => {
          const state = await createProjectStateStore(directory).read();
          const capturePersisted =
            captureScopes.length > 0 &&
            state.graph?.screens.find((screen) => screen.id === home.id)
              ?.renderStatus === "captured";
          if (!capturePersisted) return false;
          const response = await fetch(
            `http://${daemon.host}:${daemon.port}/context?kind=screen&route=/&limit=10`,
          );
          if (!response.ok) return false;
          capturedContext = await response.json();
          return (
            typeof capturedContext === "object" &&
            capturedContext !== null &&
            "items" in capturedContext &&
            Array.isArray(capturedContext.items) &&
            capturedContext.items.some(
              (item) =>
                typeof item === "object" &&
                item !== null &&
                "summary" in item &&
                typeof item.summary === "string" &&
                item.summary.includes("render status captured"),
            )
          );
        });
      } catch (error) {
        const state = await createProjectStateStore(directory).read();
        throw new Error(
          `Watcher evidence timed out: ${JSON.stringify({
            captureScopes,
            homeStatus: state.graph?.screens.find(
              (screen) => screen.id === home.id,
            )?.renderStatus,
            jobs: state.jobs.map((job) => ({
              kind: job.kind,
              status: job.status,
              error: job.error,
            })),
          })}`,
          { cause: error },
        );
      }

      expect(captureScopes.at(-1)).toEqual([home.id]);
      expect(captureScopes.at(-1)).not.toContain(customers.id);
      expect(capturedContext).toMatchObject({
        items: [
          expect.objectContaining({
            summary: expect.stringContaining("render status captured"),
          }),
        ],
      });
    } finally {
      await daemon.close();
    }
  }, 15_000);

  it("refreshes inferred journeys and agent context from one reported source change", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-flow-refresh-"),
    );
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.mkdir(path.join(directory, "app", "customers"), {
      recursive: true,
    });
    const homePath = path.join(directory, "app", "page.tsx");
    await fs.writeFile(
      homePath,
      'export default function Page() { return <a href="/customers">Customers</a> }\n',
    );
    await fs.writeFile(
      path.join(directory, "app", "customers", "page.tsx"),
      "export default function Page() { return <main>Customers</main> }\n",
    );
    const daemon = await createDaemon({
      projectRoot: directory,
      host: "127.0.0.1",
      port: 0,
      watch: false,
    });
    await daemon.listen();

    try {
      const baseUrl = `http://${daemon.host}:${daemon.port}`;
      const initial = await daemon.getGraph();
      expect(initial.flowTransitions).toHaveLength(1);
      expect(initial.inferredFlows).toHaveLength(1);
      const initialContext = (await (
        await fetch(`${baseUrl}/context?kind=flow-transition&limit=10`)
      ).json()) as { items: unknown[] };
      expect(initialContext.items).toHaveLength(1);

      await fs.writeFile(
        homePath,
        "export default function Page() { return <main>Home</main> }\n",
      );
      const refreshed = await daemon.refreshChanged(["app/page.tsx"]);
      expect(refreshed.flowTransitions).toEqual([]);
      expect(refreshed.inferredFlows).toEqual([]);
      const refreshedContext = (await (
        await fetch(`${baseUrl}/context?kind=flow-transition&limit=10`)
      ).json()) as { items: unknown[] };
      expect(refreshedContext.items).toEqual([]);
    } finally {
      await daemon.close();
    }
  });

  it("provides validated note CRUD and publishes durable resource updates", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-daemon-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.mkdir(path.join(directory, "app"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "app", "page.tsx"),
      "export default function Page() { return <main>Home</main>; }\n",
    );
    const daemon = await createDaemon({
      projectRoot: directory,
      host: "127.0.0.1",
      port: 0,
      watch: false,
    });
    await daemon.listen();
    const controller = new AbortController();
    let resourceEventPromise: Promise<unknown> | undefined;

    try {
      const baseUrl = `http://${daemon.host}:${daemon.port}`;
      const eventResponse = await fetch(`${baseUrl}/events`, {
        signal: controller.signal,
      });
      const reader = eventResponse.body!.getReader();
      const decoder = new TextDecoder();
      let eventBuffer = "";
      const readResourceEvent = async () => {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Event stream closed unexpectedly");
          eventBuffer += decoder.decode(chunk.value, { stream: true });
          const blocks = eventBuffer.split("\n\n");
          eventBuffer = blocks.pop() ?? "";
          for (const block of blocks) {
            if (!block.startsWith("event: resource.updated")) continue;
            const data = block
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6);
            if (data) return JSON.parse(data) as unknown;
          }
        }
      };

      const preflight = await fetch(`${baseUrl}/notes/review-home`, {
        method: "OPTIONS",
      });
      expect(preflight.headers.get("access-control-allow-methods")).toContain(
        "PATCH",
      );
      expect(preflight.headers.get("access-control-allow-methods")).toContain(
        "DELETE",
      );

      resourceEventPromise = readResourceEvent();
      const createdResponse = await fetch(`${baseUrl}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "review-home",
          type: "element",
          title: "Review home",
          body: "Check the hero wording.",
          targetKind: "screen",
          targetRoute: "/",
          author: "local",
          anchor: {
            status: "attached",
            source: { filePath: "app/page.tsx", line: 1 },
            verifiedAt: "2026-08-01T02:00:00.000Z",
          },
        }),
      });
      expect(createdResponse.status).toBe(201);
      expect(await createdResponse.json()).toMatchObject({
        id: "review-home",
        status: "open",
        anchor: { status: "attached" },
      });
      await expect(resourceEventPromise).resolves.toMatchObject({
        type: "resource.updated",
        resource: "notes",
      });

      const itemResponse = await fetch(`${baseUrl}/notes/review-home`);
      expect(itemResponse.status).toBe(200);
      expect(await itemResponse.json()).toMatchObject({
        id: "review-home",
        body: "Check the hero wording.",
      });

      const updateResponse = await fetch(`${baseUrl}/notes/review-home`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Review the home hero",
          status: "resolved",
          anchor: {
            status: "drifted",
            source: { filePath: "app/page.tsx", line: 1 },
            testLocator: "hero-title",
            domFingerprint: "a91c",
            driftPixels: 14,
            verifiedAt: "2026-08-01T03:00:00.000Z",
          },
        }),
      });
      expect(updateResponse.status).toBe(200);
      expect(await updateResponse.json()).toMatchObject({
        title: "Review the home hero",
        status: "resolved",
        anchor: { testLocator: "hero-title", driftPixels: 14 },
      });

      await fs.writeFile(
        path.join(directory, ".topo", "notes", "malformed.md"),
        "This note has no frontmatter.\n",
      );
      const listResponse = await fetch(`${baseUrl}/notes`);
      expect(await listResponse.json()).toMatchObject({
        schemaVersion: 1,
        notes: [{ id: "review-home", status: "resolved" }],
        issues: [
          {
            filePath: ".topo/notes/malformed.md",
            message: expect.stringContaining("frontmatter"),
          },
        ],
      });

      const invalidCreate = await fetch(`${baseUrl}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "../outside", title: "Invalid" }),
      });
      expect(invalidCreate.status).toBe(400);

      const invalidUpdate = await fetch(`${baseUrl}/notes/review-home`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anchor: { status: "attached", secret: true } }),
      });
      expect(invalidUpdate.status).toBe(400);

      expect((await fetch(`${baseUrl}/notes/missing`)).status).toBe(404);
      expect(
        (
          await fetch(`${baseUrl}/notes/missing`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "resolved" }),
          })
        ).status,
      ).toBe(404);

      const deleteResponse = await fetch(`${baseUrl}/notes/review-home`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(204);
      expect((await fetch(`${baseUrl}/notes/review-home`)).status).toBe(404);
      expect(
        await fs.readFile(
          path.join(directory, ".topo", "llm", "records", "note.jsonl"),
          "utf8",
        ),
      ).toBe("");
    } finally {
      controller.abort();
      await resourceEventPromise?.catch(() => undefined);
      await daemon.close();
    }
  });

  it("validates, persists, and filters route-scoped interaction probes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-daemon-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.mkdir(path.join(directory, "app"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "app", "page.tsx"),
      "export default function Page() { return <button>Watch tour</button>; }\n",
    );
    const artifact = {
      version: 1 as const,
      id: "interaction-probe:home-watch-tour",
      routePath: "/",
      control: {
        index: 0,
        id: "control:home-watch-tour",
        label: "Watch tour",
        tagName: "button",
        role: "button",
        locator: 'role=button[name="Watch tour"]',
      },
      status: "possibly-inert" as const,
      effects: [],
      evidence: ["Activated Watch tour on /"],
      observedAt: "2026-08-01T01:00:00.000Z",
    };
    const finding = {
      id: artifact.id,
      severity: "low" as const,
      status: "open" as const,
      title: "Control may be inert",
      description: "No recognized effect was observed.",
      evidence: [`Probe artifact: ${artifact.id}`, "Probe route: /"],
      confidence: 0.82,
    };
    const daemon = await createDaemon({
      projectRoot: directory,
      host: "127.0.0.1",
      port: 0,
      watch: false,
      runDiagnostics: async (options) => ({
        graph: { ...options.graph, findings: [finding] },
        findings: [finding],
        staticFilesScanned: 1,
        runtimeObservations: [artifact],
        interactionProbes: [artifact],
        probedRoutes: ["/"],
      }),
    });
    await daemon.listen();

    try {
      const unknown = await fetch(
        `http://${daemon.host}:${daemon.port}/diagnostics`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runtime: true, routes: ["/missing"] }),
        },
      );
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toMatchObject({
        error: "Unknown diagnostic route: /missing",
      });

      const response = await fetch(
        `http://${daemon.host}:${daemon.port}/diagnostics`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runtime: true, routes: ["/"] }),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        interactionProbes: [{ id: artifact.id, routePath: "/" }],
      });

      const list = await fetch(
        `http://${daemon.host}:${daemon.port}/interaction-probes?routePath=${encodeURIComponent("/")}`,
      );
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({
        schemaVersion: 1,
        interactionProbes: [artifact],
      });
      expect(
        (await createProjectStateStore(directory).read()).interactionProbes,
      ).toEqual([artifact]);
    } finally {
      await daemon.close();
    }
  });

  it("starts the built-in preview runtime lazily and closes it once", async () => {
    const graph = emptyApplicationGraph("C:/workspace");
    graph.components = [
      {
        id: "component:components/StoryOnly.tsx",
        kind: "component",
        name: "StoryOnly",
        source: { filePath: "components/StoryOnly.tsx", line: 1 },
        previewStatus: "renderable",
        previewSources: [
          {
            id: "storybook:story-only#Primary",
            title: "Primary",
            adapterId: "storybook",
            source: {
              filePath: "components/StoryOnly.stories.tsx",
              line: 1,
            },
            exportName: "Primary",
            locator: "components/StoryOnly.stories.tsx#Primary",
          },
        ],
        usedBy: [],
      },
      {
        id: "component:components/NativePreview.tsx",
        kind: "component",
        name: "NativePreview",
        source: { filePath: "components/NativePreview.tsx", line: 1 },
        previewStatus: "renderable",
        previewSources: [
          {
            id: "topo:components/NativePreview.topo.tsx#Default",
            title: "Default",
            adapterId: "topo",
            source: {
              filePath: "components/NativePreview.topo.tsx",
              line: 1,
            },
            exportName: "Default",
            locator: "components/NativePreview.topo.tsx#Default",
          },
        ],
        usedBy: [],
      },
    ];

    let starts = 0;
    let closes = 0;
    const manager = createComponentPreviewRuntimeManager({
      rootDir: "C:/workspace",
      configuredBaseUrls: {
        storybook: "http://127.0.0.1:6006",
      },
      startRuntime: async () => {
        starts += 1;
        return {
          baseUrl: "http://127.0.0.1:4600/__topo/capability/",
          close: async () => {
            closes += 1;
          },
        };
      },
    });

    await expect(
      manager.resolveBaseUrls(graph, ["component:components/StoryOnly.tsx"]),
    ).resolves.toEqual({ storybook: "http://127.0.0.1:6006" });
    expect(starts).toBe(0);

    await expect(
      manager.resolveBaseUrls(graph, [
        "component:components/NativePreview.tsx",
      ]),
    ).resolves.toEqual({
      storybook: "http://127.0.0.1:6006",
      topo: "http://127.0.0.1:4600/__topo/capability/",
    });
    await manager.resolveBaseUrls(graph);
    expect(starts).toBe(1);

    await manager.close();
    await manager.close();
    expect(closes).toBe(1);
  });

  it("captures a colocated Topo component preview through the HTTP API", async () => {
    const playgroundRoot = path.resolve(
      process.cwd(),
      "../../apps/playground-next-app",
    );
    const directory = await fs.mkdtemp(
      path.join(playgroundRoot, ".topo-daemon-fixture-"),
    );
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "^16.0.0",
          react: "^19.2.0",
          "react-dom": "^19.2.0",
        },
      }),
    );
    await fs.mkdir(path.join(directory, "app"), { recursive: true });
    await fs.mkdir(path.join(directory, "components"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "components", "Button.tsx"),
      `export function Button({ label }: { label: string }) {
  return <button data-testid="captured-button">{label}</button>;
}
`,
    );
    await fs.writeFile(
      path.join(directory, "components", "Button.topo.tsx"),
      `import { Button } from "./Button";

export function Primary() {
  return <Button label="Captured by Topo" />;
}
`,
    );
    await fs.writeFile(
      path.join(directory, "app", "page.tsx"),
      `import { Button } from "../components/Button";

export default function Page() {
  return <Button label="Home" />;
}
`,
    );

    const daemon = await createDaemon({
      projectRoot: directory,
      port: 0,
      watch: false,
    });
    await daemon.listen();
    try {
      const graph = await daemon.getGraph();
      const component = graph.components.find((item) => item.name === "Button");
      expect(component?.previewSources).toEqual([
        expect.objectContaining({
          adapterId: "topo",
          exportName: "Primary",
          source: {
            filePath: "components/Button.topo.tsx",
            line: 3,
          },
        }),
      ]);

      const captureResponse = await fetch(
        `http://${daemon.host}:${daemon.port}/capture/components`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ componentIds: [component?.id] }),
        },
      );
      expect(captureResponse.status).toBe(200);
      const capture = (await captureResponse.json()) as {
        artifacts: Array<{
          adapterId: string;
          status: string;
          width?: number;
        }>;
        failures: unknown[];
      };
      expect(capture.failures).toEqual([]);
      expect(capture.artifacts).toEqual([
        expect.objectContaining({
          adapterId: "topo",
          status: "captured",
          width: 1440,
        }),
      ]);

      const previewsResponse = await fetch(
        `http://${daemon.host}:${daemon.port}/component-previews`,
      );
      const previews = (await previewsResponse.json()) as {
        previewArtifacts: Array<{ imageUrl?: string }>;
      };
      const imageResponse = await fetch(
        String(previews.previewArtifacts[0]?.imageUrl),
      );
      expect(imageResponse.status).toBe(200);
      expect(
        Buffer.from(await imageResponse.arrayBuffer()).subarray(0, 8),
      ).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } finally {
      await daemon.close();
    }
  }, 30_000);

  it("skips derived rewrites for semantic no-ops and persists real graph changes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-daemon-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.mkdir(path.join(directory, "app"), { recursive: true });
    const homePath = path.join(directory, "app", "page.tsx");
    await fs.writeFile(
      homePath,
      "export default function Page() { return <main>Home</main> }\n",
    );
    const daemon = await createDaemon({
      projectRoot: directory,
      config: defineConfig({ preview: { autoCapture: false } }),
      port: 0,
      watch: false,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();

    try {
      const initial = await daemon.getGraph();
      const initialState = await createProjectStateStore(directory).read();
      await fs.writeFile(
        homePath,
        "export default function Page() { return <main>Home</main> }\n// copy-only edit\n",
      );

      const unchanged = await daemon.refreshChanged(["app/page.tsx"]);
      const unchangedState = await createProjectStateStore(directory).read();
      expect(unchanged.generatedAt).toBe(initial.generatedAt);
      expect(unchangedState.updatedAt).toBe(initialState.updatedAt);
      expect(unchangedState.jobs).toEqual([]);

      await fs.mkdir(path.join(directory, "app", "about"));
      await fs.writeFile(
        path.join(directory, "app", "about", "page.tsx"),
        "export default function About() { return <main>About</main> }\n",
      );
      const changed = await daemon.refreshChanged(["app/about/page.tsx"]);
      expect(changed.screens.map((screen) => screen.routePath)).toEqual([
        "/",
        "/about",
      ]);
      expect(changed.generatedAt).not.toBe(initial.generatedAt);
      const settledContext = await fetch(
        `http://${daemon.host}:${daemon.port}/context?kind=route&q=%2Fabout`,
      );
      expect(settledContext.status).toBe(200);
      expect(
        await fs.readFile(
          path.join(directory, ".topo", "llm", "records", "route.jsonl"),
          "utf8",
        ),
      ).toContain('"routePath":"/about"');
    } finally {
      await daemon.close();
    }
  });

  it("serves a scanned graph over loopback HTTP", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-daemon-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.mkdir(path.join(directory, "app"), { recursive: true });
    await fs.mkdir(path.join(directory, "components"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "components", "Button.tsx"),
      "export function Button() { return <button>Continue</button> }\n",
    );
    await fs.writeFile(
      path.join(directory, "app", "page.tsx"),
      "import { Button } from '../components/Button'\nexport default function Page() { return <Button /> }\n",
    );
    const daemon = await createDaemon({
      projectRoot: directory,
      port: 0,
      watch: false,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();

    const response = await fetch(`http://${daemon.host}:${daemon.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });

    const doctorResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/doctor`,
    );
    expect(doctorResponse.status).toBe(200);
    expect(await doctorResponse.json()).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-08-01T06:30:00.000Z",
      summary: { total: 1, passed: 1 },
      checks: [{ id: "application.source-scan", status: "pass" }],
    });

    const rerunDoctorResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/doctor`,
      { method: "POST" },
    );
    expect(rerunDoctorResponse.status).toBe(200);

    const preflightResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/diagnostics`,
      {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:4173",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      },
    );
    expect(preflightResponse.status).toBe(204);
    expect(
      preflightResponse.headers.get("access-control-allow-methods"),
    ).toContain("POST");
    expect(
      preflightResponse.headers.get("access-control-allow-headers"),
    ).toContain("content-type");

    const scanResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/scan`,
      { method: "POST" },
    );
    expect(scanResponse.status).toBe(200);
    const scannedGraph = await scanResponse.json();
    expect(scannedGraph.screens).toHaveLength(1);

    const atlasSceneResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/atlas/scene?selectedScreenId=${encodeURIComponent(scannedGraph.screens[0].id)}`,
    );
    expect(atlasSceneResponse.status).toBe(200);
    expect(await atlasSceneResponse.json()).toMatchObject({
      version: 4,
      selectedScreenId: scannedGraph.screens[0].id,
      selectedBounds: { x: 0, y: -18, width: 780, height: 706 },
      routeMap: {
        routes: [
          expect.objectContaining({
            primaryScreenId: scannedGraph.screens[0].id,
            routePath: "/",
          }),
        ],
      },
      layout: {
        screens: [
          {
            id: scannedGraph.screens[0].id,
            position: { x: 0, y: 0 },
          },
        ],
      },
    });

    const unknownAtlasSelectionResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/atlas/scene?selectedScreenId=missing`,
    );
    expect(unknownAtlasSelectionResponse.status).toBe(400);

    const componentId = scannedGraph.components[0].id as string;
    const componentSceneResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/atlas/components/scene?selectedComponentId=${encodeURIComponent(componentId)}`,
    );
    expect(componentSceneResponse.status).toBe(200);
    expect(await componentSceneResponse.json()).toMatchObject({
      version: 2,
      selectedComponentId: componentId,
      selectedGroupId: expect.any(String),
      components: [
        expect.objectContaining({ id: componentId, position: { x: 0, y: 0 } }),
      ],
    });

    const stateResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/state`,
    );
    expect(stateResponse.status).toBe(200);
    expect((await stateResponse.json()).graph.framework).toBe("next-app");

    const snapshotDirectory = path.join(directory, ".topo", "snapshots");
    const snapshotPath = path.join(snapshotDirectory, "home.png");
    await fs.mkdir(snapshotDirectory, { recursive: true });
    const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await fs.writeFile(snapshotPath, pngHeader);
    await createProjectStateStore(directory).recordSnapshot({
      id: "snapshot-home",
      screenId: scannedGraph.screens[0].id,
      routePath: "/",
      capturedAt: "2026-07-31T00:00:00.000Z",
      status: "captured",
      artifactPath: ".topo/snapshots/home.png",
      contentHash: "f".repeat(64),
      width: 1440,
      height: 1024,
    });

    const snapshotsResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/snapshots`,
    );
    expect(snapshotsResponse.status).toBe(200);
    expect(await snapshotsResponse.json()).toMatchObject({
      schemaVersion: 1,
      snapshots: [
        {
          id: "snapshot-home",
          imageUrl: `http://${daemon.host}:${daemon.port}/snapshots/snapshot-home/image.png?v=${"f".repeat(64)}`,
        },
      ],
    });

    const snapshotImageResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/snapshots/snapshot-home/image.png`,
    );
    expect(snapshotImageResponse.status).toBe(200);
    expect(snapshotImageResponse.headers.get("content-type")).toBe("image/png");
    expect(
      Buffer.from(await snapshotImageResponse.arrayBuffer()).equals(pngHeader),
    ).toBe(true);
    expect(
      (
        await fetch(
          `http://${daemon.host}:${daemon.port}/snapshots/snapshot-home/image`,
        )
      ).status,
    ).toBe(200);

    const missingSnapshotResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/snapshots/missing/image.png`,
    );
    expect(missingSnapshotResponse.status).toBe(404);

    const unknownBaselineResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/visuals/baseline`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ screenId: "screen:missing" }),
      },
    );
    expect(unknownBaselineResponse.status).toBe(400);

    const baselineResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/visuals/baseline`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ screenId: scannedGraph.screens[0].id }),
      },
    );
    expect(baselineResponse.status).toBe(201);
    const accepted = (await baselineResponse.json()) as {
      baseline: { id: string; contentHash: string };
      comparison: { id: string; status: string; changeRatio: number };
    };
    expect(accepted.baseline.contentHash).toBe("f".repeat(64));
    expect(accepted.comparison).toMatchObject({
      status: "unchanged",
      changeRatio: 0,
    });

    const visualsResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/visuals`,
    );
    expect(visualsResponse.status).toBe(200);
    expect(await visualsResponse.json()).toMatchObject({
      schemaVersion: 1,
      baselines: [
        {
          id: accepted.baseline.id,
          imageUrl: `http://${daemon.host}:${daemon.port}/visuals/baselines/${accepted.baseline.id}/image.png?v=${"f".repeat(64)}`,
        },
      ],
      comparisons: [
        {
          id: accepted.comparison.id,
          status: "unchanged",
        },
      ],
    });

    const baselineImageResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/visuals/baselines/${accepted.baseline.id}/image.png`,
    );
    expect(baselineImageResponse.status).toBe(200);
    expect(
      Buffer.from(await baselineImageResponse.arrayBuffer()).equals(pngHeader),
    ).toBe(true);

    const visualContextResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/context?kind=visual-baseline,visual-comparison&limit=10`,
    );
    expect(visualContextResponse.status).toBe(200);
    expect(await visualContextResponse.json()).toMatchObject({
      manifest: { schemaVersion: 7 },
      total: 2,
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "visual-baseline" }),
        expect.objectContaining({ kind: "visual-comparison" }),
      ]),
    });

    const previewDirectory = path.join(directory, ".topo", "previews");
    const previewPath = path.join(previewDirectory, "button.png");
    await fs.mkdir(previewDirectory, { recursive: true });
    await fs.writeFile(previewPath, pngHeader);
    await createProjectStateStore(directory).recordPreviewArtifact({
      version: 1,
      id: "component-preview-button",
      targetKind: "component",
      targetId: componentId,
      previewId: "storybook:button#Primary",
      adapterId: "storybook",
      title: "Primary",
      source: { filePath: "components/Button.stories.tsx", line: 1 },
      capturedAt: "2026-07-31T00:00:00.000Z",
      status: "captured",
      artifactPath: ".topo/previews/button.png",
      contentHash: "a".repeat(64),
      width: 720,
      height: 480,
    });

    const previewsResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/component-previews`,
    );
    expect(previewsResponse.status).toBe(200);
    expect(await previewsResponse.json()).toMatchObject({
      schemaVersion: 1,
      previewArtifacts: [
        {
          id: "component-preview-button",
          targetId: componentId,
          imageUrl: `http://${daemon.host}:${daemon.port}/component-previews/component-preview-button/image.png?v=${"a".repeat(64)}`,
        },
      ],
    });

    const previewImageResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/component-previews/component-preview-button/image.png`,
    );
    expect(previewImageResponse.status).toBe(200);
    expect(
      Buffer.from(await previewImageResponse.arrayBuffer()).equals(pngHeader),
    ).toBe(true);

    const unknownComponentCaptureResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/capture/components`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ componentIds: ["component:missing"] }),
      },
    );
    expect(unknownComponentCaptureResponse.status).toBe(400);
    expect(await unknownComponentCaptureResponse.json()).toMatchObject({
      error: "Unknown component: component:missing",
    });

    await createProjectStateStore(directory).recordSnapshot({
      id: "snapshot-outside-root",
      screenId: "next-app:/#default",
      routePath: "/",
      capturedAt: "2026-07-31T00:00:00.000Z",
      status: "captured",
      artifactPath: "../outside-root.png",
    });
    const escapedSnapshotResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/snapshots/snapshot-outside-root/image.png`,
    );
    expect(escapedSnapshotResponse.status).toBe(400);
    expect(await escapedSnapshotResponse.json()).toMatchObject({
      error: "Snapshot artifact escapes the project root",
    });

    const diagnosticsResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/diagnostics`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runtime: false }),
      },
    );
    expect(diagnosticsResponse.status).toBe(200);
    expect((await diagnosticsResponse.json()).jobId).toMatch(/^job-/);

    const jobsResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/jobs`,
    );
    expect(jobsResponse.status).toBe(200);
    expect(
      (await jobsResponse.json()).jobs.some(
        (job: { kind: string; status: string }) =>
          job.kind === "diagnostic" && job.status === "completed",
      ),
    ).toBe(true);

    const noteResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/notes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Try the live preview",
          body: "Open this screen in Studio.",
          targetRoute: "/",
        }),
      },
    );
    expect(noteResponse.status).toBe(201);
    expect(await noteResponse.json()).toMatchObject({
      title: "Try the live preview",
      targetRoute: "/",
    });

    const flowResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/flows`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "home-review",
          title: "Home review",
          entryStepId: "home",
          steps: [
            {
              id: "home",
              title: "Open home",
              routePath: "/",
              noteIds: [],
              nextStepIds: [],
            },
          ],
        }),
      },
    );
    expect(flowResponse.status).toBe(201);
    expect(await flowResponse.json()).toMatchObject({
      id: "home-review",
      steps: [{ routePath: "/" }],
    });

    const flowsResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/flows`,
    );
    expect(await flowsResponse.json()).toMatchObject({
      schemaVersion: 1,
      flows: [{ id: "home-review" }],
      issues: [],
    });

    const flowItemResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/flows/home-review`,
    );
    expect(flowItemResponse.status).toBe(200);
    expect(await flowItemResponse.json()).toMatchObject({
      id: "home-review",
      status: "draft",
    });

    const updateFlowResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/flows/home-review`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "verified",
          steps: [
            {
              id: "home",
              title: "Open home",
              routePath: "/",
              noteIds: [],
              nextStepIds: ["review"],
            },
            {
              id: "review",
              title: "Review the screen",
              routePath: "/",
              noteIds: [],
              nextStepIds: [],
            },
          ],
        }),
      },
    );
    expect(updateFlowResponse.status).toBe(200);
    expect(await updateFlowResponse.json()).toMatchObject({
      status: "verified",
      steps: [{ id: "home", nextStepIds: ["review"] }, { id: "review" }],
    });

    const emptyFlowUpdateResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/flows/home-review`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(emptyFlowUpdateResponse.status).toBe(400);

    const flowSceneResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/atlas/flows/scene?selectedFlowId=home-review&selectedStepId=home`,
    );
    expect(flowSceneResponse.status).toBe(200);
    expect(await flowSceneResponse.json()).toMatchObject({
      version: 1,
      selectedFlowId: "home-review",
      selectedStepId: "home",
      steps: expect.arrayContaining([
        expect.objectContaining({
          flowId: "home-review",
          stepId: "home",
          resolution: "resolved",
          position: { x: 0, y: 0 },
        }),
        expect.objectContaining({
          flowId: "home-review",
          stepId: "review",
          resolution: "resolved",
        }),
      ]),
    });

    const unknownFlowSceneResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/atlas/flows/scene?selectedFlowId=missing`,
    );
    expect(unknownFlowSceneResponse.status).toBe(400);

    const contextResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/context?kind=flow,flow-step&route=/&limit=10`,
    );
    expect(contextResponse.status).toBe(200);
    expect(await contextResponse.json()).toMatchObject({
      count: 2,
      items: [{ kind: "flow-step" }, { kind: "flow-step" }],
    });

    const manifestResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/context/manifest`,
    );
    expect(manifestResponse.status).toBe(200);
    expect(await manifestResponse.json()).toMatchObject({
      counts: { note: 1, "doctor-check": 1 },
    });

    const deleteFlowResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/flows/home-review`,
      { method: "DELETE" },
    );
    expect(deleteFlowResponse.status).toBe(204);
    expect(
      (await fetch(`http://${daemon.host}:${daemon.port}/flows/home-review`))
        .status,
    ).toBe(404);
    expect(
      (
        await fetch(`http://${daemon.host}:${daemon.port}/flows/home-review`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);

    const doctorContextResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/context?kind=doctor-check&limit=10`,
    );
    expect(await doctorContextResponse.json()).toMatchObject({
      count: 1,
      items: [
        {
          kind: "doctor-check",
          id: "application.source-scan",
          data: { observedAt: "2026-08-01T06:30:00.000Z" },
        },
      ],
    });

    expect(
      await fs.readFile(
        path.join(directory, ".topo", "llm", "records.jsonl"),
        "utf8",
      ),
    ).toContain('"kind":"doctor-check"');

    const reviewResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/review`,
    );
    expect(reviewResponse.status).toBe(200);
    expect(await reviewResponse.text()).toContain("Try the live preview");

    const sarifResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/review?format=sarif&include=all&snapshots=1`,
    );
    expect(sarifResponse.status).toBe(200);
    expect(sarifResponse.headers.get("content-type")).toContain(
      "application/sarif+json",
    );
    expect(await sarifResponse.json()).toMatchObject({
      version: "2.1.0",
      runs: [
        {
          properties: {
            topo: { notes: [{ title: "Try the live preview" }] },
          },
        },
      ],
    });

    const htmlResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/review?format=html&include=notes`,
    );
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get("content-disposition")).toContain(
      "TOPO_REVIEW.html",
    );
    expect(await htmlResponse.text()).toContain("<!doctype html>");

    expect(
      (await fetch(`http://${daemon.host}:${daemon.port}/review?format=pdf`))
        .status,
    ).toBe(400);

    await daemon.close();
  });

  it("scaffolds a missing component preview and refreshes graph and LLM evidence", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-daemon-preview-scaffold-"),
    );
    temporaryDirectories.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, "app"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "components"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
    await fs.writeFile(
      path.join(projectRoot, "components", "StatusPill.tsx"),
      `export function StatusPill({ label }: { label: string }) {
  return <span>{label}</span>;
}
`,
    );
    await fs.writeFile(
      path.join(projectRoot, "app", "page.tsx"),
      `import { StatusPill } from "../components/StatusPill";

export default function Page() {
  return <StatusPill label="Ready" />;
}
`,
    );

    const daemon = await createDaemon({
      projectRoot,
      config: defineConfig({ preview: { autoCapture: false } }),
      host: "127.0.0.1",
      port: 0,
      watch: false,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();
    try {
      const componentId = "component:components/StatusPill.tsx";
      const untrustedResponse = await fetch(
        `http://${daemon.host}:${daemon.port}/components/previews/scaffold`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://untrusted.example",
          },
          body: JSON.stringify({ componentId }),
        },
      );
      expect(untrustedResponse.status).toBe(403);
      await expect(
        fs.stat(path.join(projectRoot, "components", "StatusPill.topo.tsx")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const response = await fetch(
        `http://${daemon.host}:${daemon.port}/components/previews/scaffold`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ componentId }),
        },
      );
      expect(response.status).toBe(201);
      const payload = (await response.json()) as {
        result: { mode: string; previewSource: string; status: string };
        graph: {
          components: Array<{
            id: string;
            previewStatus: string;
            previewSources: Array<{ exportName?: string }>;
          }>;
          findings: Array<{ id: string; source: { filePath: string } }>;
        };
      };
      expect(payload.result).toMatchObject({
        mode: "fixture-required",
        previewSource: "components/StatusPill.topo.tsx",
        status: "created",
      });
      expect(
        payload.graph.components.find((item) => item.id === componentId),
      ).toMatchObject({
        previewStatus: "missing",
        previewSources: [],
      });
      expect(payload.graph.findings).toContainEqual(
        expect.objectContaining({
          id: `component-preview-draft:${componentId}`,
          source: {
            filePath: "components/StatusPill.topo.tsx",
            line: 1,
          },
        }),
      );
      const generated = await fs.readFile(
        path.join(projectRoot, "components", "StatusPill.topo.tsx"),
        "utf8",
      );
      expect(generated).toContain("satisfies Partial<PreviewProps>");
      expect(generated).not.toMatch(/^export function Default/m);

      const contextResponse = await fetch(
        `http://${daemon.host}:${daemon.port}/context?kind=finding&q=fixture%20required%20StatusPill`,
      );
      const context = (await contextResponse.json()) as {
        items: Array<{
          id: string;
          data: { source?: { filePath?: string } };
        }>;
      };
      expect(context.items).toEqual([
        expect.objectContaining({
          id: `component-preview-draft:${componentId}`,
          data: expect.objectContaining({
            source: expect.objectContaining({
              filePath: "components/StatusPill.topo.tsx",
            }),
          }),
        }),
      ]);

      const conflict = await fetch(
        `http://${daemon.host}:${daemon.port}/components/previews/scaffold`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ componentId }),
        },
      );
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({
        error: expect.stringContaining("already exists"),
      });
    } finally {
      await daemon.close();
    }
  });
});
