import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  defineComponentPreviewAdapter,
} from "@topo/preview-adapter";

import { createWorkspaceScanner, scanWorkspace } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-workspace-"));
  temporaryDirectories.push(directory);
  await fs.writeFile(path.join(directory, "package.json"), "{}\n");
  await fs.mkdir(path.join(directory, "views"));
  await fs.writeFile(
    path.join(directory, "views", "home.tsx"),
    "export default null\n",
  );
  return directory;
}

describe("workspace framework adapter composition", () => {
  it("composes Topo's built-in Next.js adapter", async () => {
    const directory = await fixture();
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "latest" } }),
    );
    await fs.mkdir(path.join(directory, "app"));
    await fs.writeFile(
      path.join(directory, "app", "page.tsx"),
      "export default null\n",
    );

    const graph = await scanWorkspace(directory);

    expect(graph.framework).toBe("next-app");
    expect(graph.screens.map((screen) => screen.routePath)).toEqual(["/"]);
  });

  it("merges source and OpenAPI endpoint evidence from one incremental snapshot", async () => {
    const directory = await fixture();
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "latest" } }),
    );
    await fs.mkdir(path.join(directory, "app", "api", "customers"), {
      recursive: true,
    });
    const routeFile = path.join(
      directory,
      "app",
      "api",
      "customers",
      "route.ts",
    );
    await fs.writeFile(
      routeFile,
      "export async function GET() { return Response.json([]) }\n",
    );
    await fs.writeFile(
      path.join(directory, "openapi.json"),
      JSON.stringify({
        openapi: "3.1.0",
        paths: {
          "/api/customers": {
            get: {
              operationId: "listCustomers",
              summary: "List customers",
              responses: { "200": { description: "Customers" } },
            },
            post: {
              operationId: "createCustomer",
              responses: { "201": { description: "Created" } },
            },
          },
        },
      }),
    );
    await fs.writeFile(
      path.join(directory, "swagger-broken.yaml"),
      "paths: []\n",
    );

    const scanner = await createWorkspaceScanner(directory);
    const initial = await scanner.scan();
    expect(initial.apiEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
      "GET /api/customers",
      "POST /api/customers",
    ]);
    expect(initial.apiEndpoints[0]).toMatchObject({
      operationId: "listCustomers",
      adapterIds: ["openapi", "source-api"],
      discoveries: expect.arrayContaining([
        expect.objectContaining({ kind: "openapi" }),
        expect.objectContaining({ kind: "framework-source" }),
      ]),
    });
    expect(initial.sourceIssues[0]).toMatchObject({
      area: "api-endpoint",
      adapterId: "openapi",
      filePath: "swagger-broken.yaml",
    });

    await fs.writeFile(
      routeFile,
      "export async function GET() { return Response.json([]) }\nexport async function DELETE() { return new Response(null, { status: 204 }) }\n",
    );
    const refreshed = await scanner.scan(["app/api/customers/route.ts"]);
    expect(refreshed.apiEndpoints.map((endpoint) => endpoint.method)).toEqual([
      "DELETE",
      "GET",
      "POST",
    ]);
  });

  it("recognizes project capabilities and infers source-backed journeys from imported UI", async () => {
    const directory = await fixture();
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        dependencies: { next: "latest", react: "latest" },
        devDependencies: { typescript: "latest", vitest: "latest" },
      }),
    );
    await fs.mkdir(path.join(directory, "app", "customers", "[customerId]"), {
      recursive: true,
    });
    await fs.mkdir(path.join(directory, "app", "api", "customers"), {
      recursive: true,
    });
    await fs.mkdir(path.join(directory, "components"), { recursive: true });
    const actionsPath = path.join(directory, "components", "HomeActions.tsx");
    await fs.writeFile(
      path.join(directory, "app", "page.tsx"),
      'import { HomeActions } from "../components/HomeActions";\nexport default function Page() { return <HomeActions /> }\n',
    );
    await fs.writeFile(
      path.join(directory, "app", "customers", "page.tsx"),
      "export default function Page() { return <main>Customers</main> }\n",
    );
    await fs.writeFile(
      path.join(directory, "app", "customers", "[customerId]", "page.tsx"),
      "export default function Page() { return <main>Customer</main> }\n",
    );
    await fs.writeFile(
      path.join(directory, "app", "api", "customers", "route.ts"),
      "export async function GET() { return Response.json([]) }\n",
    );
    await fs.writeFile(
      actionsPath,
      'export function HomeActions() { fetch("/api/customers"); return <a href="/customers">Customers</a> }\n',
    );

    const scanner = await createWorkspaceScanner(directory);
    const initial = await scanner.scan();

    expect(initial.projectRecognition).toMatchObject({
      status: "recognized",
      frameworks: [
        expect.objectContaining({
          framework: "next-app",
          adapterIds: ["topo.next"],
        }),
      ],
    });
    expect(
      initial.projectRecognition.capabilities.map((capability) => capability.id),
    ).toEqual(expect.arrayContaining(["api", "routing", "testing", "typescript"]));
    expect(initial.flowTransitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapterId: "source-flow",
          kind: "navigation",
          sourceRoutePath: "/",
          source: expect.objectContaining({ filePath: "components/HomeActions.tsx" }),
          target: expect.objectContaining({
            kind: "screen",
            status: "resolved",
            routePath: "/customers",
          }),
        }),
        expect.objectContaining({
          kind: "request",
          target: expect.objectContaining({
            kind: "api-endpoint",
            status: "resolved",
            method: "GET",
            path: "/api/customers",
          }),
        }),
      ]),
    );
    expect(initial.inferredFlows[0]).toMatchObject({
      truncated: false,
      transitionCount: 2,
      adapterIds: ["source-flow"],
      steps: expect.arrayContaining([
        expect.objectContaining({ kind: "screen", routePath: "/" }),
        expect.objectContaining({ kind: "screen", routePath: "/customers" }),
        expect.objectContaining({ kind: "api-endpoint" }),
      ]),
    });

    await fs.writeFile(
      actionsPath,
      'export function HomeActions() { return <a href="/customers/demo">Customer</a> }\n',
    );
    const refreshed = await scanner.scan(["components/HomeActions.tsx"]);
    expect(refreshed.flowTransitions).toHaveLength(1);
    expect(refreshed.flowTransitions[0]?.target).toMatchObject({
      kind: "screen",
      status: "resolved",
      routePath: "/customers/[customerId]",
    });
    expect(refreshed.inferredFlows[0]?.transitionCount).toBe(1);
  });

  it("scans the permanent Next.js Pages Router playground through the built-in adapter", async () => {
    const playgroundRoot = path.resolve(
      process.cwd(),
      "../../apps/playground-next-pages",
    );

    const graph = await scanWorkspace(playgroundRoot);

    expect(graph.framework).toBe("next-pages");
    expect(
      graph.screens.map((screen) => ({
        routePath: screen.routePath,
        state: screen.state,
        source: screen.source.filePath,
      })),
    ).toEqual([
      { routePath: "/", state: "default", source: "pages/index.tsx" },
      { routePath: "/404", state: "not-found", source: "pages/404.tsx" },
      {
        routePath: "/customers",
        state: "default",
        source: "pages/customers/index.tsx",
      },
      {
        routePath: "/customers/[customerId]",
        state: "default",
        source: "pages/customers/[customerId].tsx",
      },
      {
        routePath: "/settings",
        state: "default",
        source: "pages/settings.tsx",
      },
    ]);
    expect(
      graph.screens.every((screen) => screen.tags.includes("next-pages")),
    ).toBe(true);
    expect(
      graph.screens.some((screen) => screen.source.filePath.includes("/api/")),
    ).toBe(false);
  });

  it("scans the permanent TanStack Router playground through the built-in adapter", async () => {
    const playgroundRoot = path.resolve(
      process.cwd(),
      "../../apps/playground-tanstack-router",
    );

    const graph = await scanWorkspace(playgroundRoot, {
      componentPreviews: {
        "src/components/StatusCard.tsx": [
          {
            source: "src/previews/StatusCard.preview.tsx",
            exportName: "ConfiguredStatusCard",
            title: "Configured status card",
            provenance: "configured",
          },
        ],
      },
    });

    expect(graph.framework).toBe("tanstack-router");
    expect(graph.screens.map((screen) => screen.routePath)).toEqual([
      "/",
      "/jobs",
      "/jobs/:jobId",
      "/settings/profile",
    ]);
    expect(
      graph.screens.every(
        (screen) =>
          screen.source.filePath === "src/routeTree.gen.ts" &&
          screen.tags.includes("tanstack-generated-tree"),
      ),
    ).toBe(true);
    expect(
      graph.components.find((component) => component.name === "StatusCard"),
    ).toMatchObject({
      previewStatus: "renderable",
      previewSources: [
        {
          title: "Configured status card",
          discovery: "configured",
          source: { filePath: "src/previews/StatusCard.preview.tsx" },
          exportName: "ConfiguredStatusCard",
          priority: 300,
        },
      ],
    });
  });

  it("scans the permanent TanStack Start playground through the current package contract", async () => {
    const playgroundRoot = path.resolve(
      process.cwd(),
      "../../apps/playground-tanstack-start",
    );

    const graph = await scanWorkspace(playgroundRoot);

    expect(graph.framework).toBe("tanstack-start");
    expect(graph.screens.map((screen) => screen.routePath)).toEqual([
      "/",
      "/settings/team",
      "/work-orders",
      "/work-orders/:workOrderId",
    ]);
    expect(
      graph.screens.every(
        (screen) =>
          screen.source.filePath === "src/routeTree.gen.ts" &&
          screen.tags.includes("tanstack-generated-tree"),
      ),
    ).toBe(true);
    expect(
      graph.components.some(
        (component) =>
          component.name === "StartRuntimeBadge" &&
          component.previewStatus === "renderable",
      ),
    ).toBe(true);
    expect(
      graph.components.some(
        (component) =>
          component.name === "WorkOrderSummary" &&
          component.previewStatus === "missing",
      ),
    ).toBe(true);
  });

  it.each([
    {
      name: "React Router",
      dependencies: {
        react: "latest",
        "react-router-dom": "latest",
        vite: "latest",
      },
      files: {
        "src/App.tsx":
          '<Route path="/" /><Route path="/customers/:customerId" />',
      },
      framework: "react-router",
      routes: ["/", "/customers/:customerId"],
      component: undefined,
    },
    {
      name: "Vue Router",
      dependencies: { vue: "latest", "vue-router": "latest", vite: "latest" },
      files: {
        "src/router.ts":
          "createRouter({ routes: [{ path: '/', component: Home }, { path: '/projects/:projectId', component: Project }] })",
        "src/components/ProjectCard.vue":
          "<template><article>Project</article></template>",
      },
      framework: "vue-router",
      routes: ["/", "/projects/:projectId"],
      component: "component:src/components/ProjectCard.vue",
    },
    {
      name: "Nuxt",
      dependencies: { nuxt: "latest", vue: "latest" },
      files: {
        "app/app.vue": "<template><NuxtPage /></template>",
        "app/pages/index.vue": "<template>Home</template>",
        "app/pages/customers/[customerId].vue": "<template>Customer</template>",
      },
      framework: "nuxt",
      routes: ["/", "/customers/:customerId"],
      component: undefined,
    },
    {
      name: "SvelteKit",
      dependencies: {
        svelte: "latest",
        "@sveltejs/kit": "latest",
        vite: "latest",
      },
      files: {
        "src/routes/+page.svelte": "<h1>Home</h1>",
        "src/routes/jobs/[jobId]/+page.svelte": "<h1>Job</h1>",
        "src/components/JobCard.svelte": "<article>Job</article>",
      },
      framework: "sveltekit",
      routes: ["/", "/jobs/:jobId"],
      component: "component:src/components/JobCard.svelte",
    },
  ])(
    "scans $name through the shared built-in adapter seam",
    async (fixtureCase) => {
      const directory = await fixture();
      await fs.writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ dependencies: fixtureCase.dependencies }),
      );
      for (const [relativePath, source] of Object.entries(fixtureCase.files)) {
        const filePath = path.join(directory, ...relativePath.split("/"));
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, source);
      }

      const graph = await scanWorkspace(directory);

      expect(graph.framework).toBe(fixtureCase.framework);
      expect(graph.screens.map((screen) => screen.routePath)).toEqual(
        fixtureCase.routes,
      );
      expect(
        graph.screens.every((screen) => screen.adapterId?.startsWith("topo.")),
      ).toBe(true);
      if (fixtureCase.component) {
        expect(graph.components).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: fixtureCase.component,
              previewStatus: "missing",
            }),
          ]),
        );
      }
    },
  );

  it("loads an external-style adapter module without scanner changes", async () => {
    const directory = await fixture();
    await fs.writeFile(
      path.join(directory, "custom-adapter.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.router",
  displayName: "Acme Router",
  detect: ({ files }) => files.some(({ filePath }) => filePath.startsWith("views/"))
    ? [{ framework: "acme-router", confidence: 1, reasons: ["views directory"] }]
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

    const graph = await scanWorkspace(directory, {
      adapterModules: ["./custom-adapter.mjs"],
    });

    expect(graph.framework).toBe("acme-router");
    expect(graph.screens.map((screen) => screen.routePath)).toEqual(["/"]);
  });

  it("loads a project-owned flow discovery adapter without scanner changes", async () => {
    const directory = await fixture();
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "latest" } }),
    );
    await fs.mkdir(path.join(directory, "app", "about"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "app", "page.tsx"),
      "export default function Page() { return <main>Home</main> }\n",
    );
    await fs.writeFile(
      path.join(directory, "app", "about", "page.tsx"),
      "export default function Page() { return <main>About</main> }\n",
    );
    await fs.writeFile(
      path.join(directory, "custom-flow-adapter.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.flow",
  displayName: "Acme flow",
  scan: ({ screens }) => ({
    transitions: screens.filter(({ routePath }) => routePath === "/").map(({ screenId }) => ({
      sourceScreenId: screenId,
      kind: "navigation",
      target: { kind: "route", routePath: "/about" },
      action: "Open about from the project convention",
      source: { filePath: "app/page.tsx", line: 1 },
      confidence: 1
    }))
  })
};
`,
    );

    const graph = await scanWorkspace(directory, {
      flowAdapterModules: ["./custom-flow-adapter.mjs"],
    });

    expect(graph.flowTransitions).toEqual([
      expect.objectContaining({
        adapterId: "acme.flow",
        action: "Open about from the project convention",
        target: expect.objectContaining({
          kind: "screen",
          status: "resolved",
          routePath: "/about",
        }),
      }),
    ]);
    expect(graph.inferredFlows[0]?.adapterIds).toEqual(["acme.flow"]);
  });

  it("retains loaded extension adapters across incremental source refreshes", async () => {
    const directory = await fixture();
    await fs.writeFile(
      path.join(directory, "custom-adapter.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.session-router",
  displayName: "Acme session router",
  detect: ({ files }) => files.some(({ filePath }) => filePath.startsWith("views/"))
    ? [{ framework: "acme-session", confidence: 1, reasons: ["views directory"] }]
    : [],
  scan: ({ files }) => ({
    routes: files.filter(({ filePath }) => filePath.startsWith("views/")).map(({ filePath }) => ({
      framework: "acme-session",
      filePath,
      routePath: "/" + filePath.slice("views/".length).replace(/\\.tsx$/, ""),
      state: "default"
    }))
  })
};
`,
    );
    const scanner = await createWorkspaceScanner(directory, {
      adapterModules: ["./custom-adapter.mjs"],
    });

    expect(
      (await scanner.scan()).screens.map((screen) => screen.routePath),
    ).toEqual(["/home"]);

    await fs.writeFile(
      path.join(directory, "views", "about.tsx"),
      "export default null\n",
    );
    expect(
      (await scanner.scan(["views/about.tsx"])).screens.map(
        (screen) => screen.routePath,
      ),
    ).toEqual(["/about", "/home"]);
  });

  it("resolves project-owned adapters while scanning nested application source", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-workspace-project-"),
    );
    temporaryDirectories.push(projectRoot);
    const sourceRoot = path.join(projectRoot, "apps", "web");
    await fs.mkdir(path.join(sourceRoot, "views"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "package.json"), "{}\n");
    await fs.writeFile(path.join(sourceRoot, "package.json"), "{}\n");
    await fs.writeFile(
      path.join(sourceRoot, "views", "home.tsx"),
      "export default null\n",
    );
    await fs.writeFile(
      path.join(projectRoot, "custom-adapter.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.nested",
  displayName: "Acme Nested Router",
  detect: ({ files }) => files.some(({ filePath }) => filePath === "views/home.tsx")
    ? [{ framework: "acme-nested", confidence: 1, reasons: ["nested view"] }]
    : [],
  scan: () => ({ routes: [{
    framework: "acme-nested",
    filePath: "views/home.tsx",
    routePath: "/",
    state: "default"
  }] })
};
`,
    );

    const graph = await scanWorkspace(sourceRoot, {
      adapterRootDir: projectRoot,
      adapterModules: ["./custom-adapter.mjs"],
    });

    expect(graph.rootDir).toBe(sourceRoot);
    expect(graph.framework).toBe("acme-nested");
  });

  it("composes Storybook component previews without coupling them to a router", async () => {
    const directory = await fixture();
    await fs.mkdir(path.join(directory, "components"));
    await fs.writeFile(
      path.join(directory, "components", "Button.tsx"),
      "export function Button() { return null }\n",
    );
    await fs.writeFile(
      path.join(directory, "components", "Button.stories.tsx"),
      "export const Primary = {};\n",
    );

    const graph = await scanWorkspace(directory);

    expect(graph.components[0]?.previewSources).toEqual([
      expect.objectContaining({
        id: "storybook:components/Button.stories.tsx#Primary",
        adapterId: "storybook",
      }),
      expect.objectContaining({
        id: "topo:components/Button.tsx#Button",
        adapterId: "topo",
      }),
    ]);
  });

  it("composes explicit and safe automatic Topo previews without scanner heuristics", async () => {
    const directory = await fixture();
    await fs.mkdir(path.join(directory, "components"));
    await fs.writeFile(
      path.join(directory, "components", "StatusCard.tsx"),
      "export function StatusCard({ value }: { value: string }) { return <strong>{value}</strong> }\n",
    );
    await fs.writeFile(
      path.join(directory, "components", "StatusCard.topo.tsx"),
      "export function Default() { return <strong>Ready</strong> }\n",
    );
    await fs.writeFile(
      path.join(directory, "components", "HealthBadge.tsx"),
      "export function HealthBadge() { return <span>Healthy</span> }\n",
    );

    const configuredPreviewAdapter = defineComponentPreviewAdapter({
      apiVersion: COMPONENT_PREVIEW_ADAPTER_API_VERSION,
      id: "acme.configured",
      displayName: "Configured previews",
      scan: () => ({
        previews: ["StatusCard", "HealthBadge"].map((name) => ({
          componentFilePath: `components/${name}.tsx`,
          preview: {
            id: `acme.configured:${name}#Configured`,
            title: "Configured",
            adapterId: "acme.configured",
            source: { filePath: `components/${name}.tsx`, line: 1 },
            exportName: name,
            locator: `components/${name}.tsx#${name}`,
          },
        })),
      }),
      resolveCaptureUrl: (_preview, { baseUrl }) => baseUrl,
    });
    const graph = await scanWorkspace(directory, {
      previewAdapters: [configuredPreviewAdapter],
    });
    const byName = new Map(
      graph.components.map((component) => [component.name, component]),
    );

    expect(byName.get("StatusCard")?.previewSources).toEqual([
      expect.objectContaining({
        id: "topo:components/StatusCard.topo.tsx#Default",
        adapterId: "topo",
        priority: 200,
      }),
      expect.objectContaining({
        id: "acme.configured:StatusCard#Configured",
        adapterId: "acme.configured",
      }),
    ]);
    expect(byName.get("HealthBadge")?.previewSources).toEqual([
      expect.objectContaining({
        id: "topo:components/HealthBadge.tsx#HealthBadge",
        adapterId: "topo",
        discovery: "automatic",
        priority: 400,
      }),
      expect.objectContaining({
        id: "acme.configured:HealthBadge#Configured",
        adapterId: "acme.configured",
      }),
    ]);
    expect(
      graph.components.every(
        (component) =>
          component.previewStatus !== "renderable" ||
          component.previewSources.length > 0,
      ),
    ).toBe(true);
  });

  it("composes keyed project previews through the built-in Topo adapter", async () => {
    const directory = await fixture();
    await fs.mkdir(path.join(directory, "components"));
    await fs.mkdir(path.join(directory, "previews"));
    await fs.writeFile(
      path.join(directory, "components", "RequiredCard.tsx"),
      "export function RequiredCard({ value }: { value: string }) { return <strong>{value}</strong> }\n",
    );
    await fs.writeFile(
      path.join(directory, "previews", "RequiredCard.preview.tsx"),
      'export function ReadyCard() { return <strong data-state="ready">Ready</strong> }\n',
    );

    const graph = await scanWorkspace(directory, {
      componentPreviews: {
        "components/RequiredCard.tsx": [
          {
            source: "previews/RequiredCard.preview.tsx",
            exportName: "ReadyCard",
            title: "Ready card",
            provenance: "configured",
          },
        ],
      },
    });

    expect(graph.components[0]).toMatchObject({
      name: "RequiredCard",
      previewStatus: "renderable",
      previewSources: [
        {
          title: "Ready card",
          adapterId: "topo",
          discovery: "configured",
          source: {
            filePath: "previews/RequiredCard.preview.tsx",
            line: 1,
          },
          exportName: "ReadyCard",
          priority: 300,
        },
      ],
    });
  });

  it("loads project-installed component preview adapters without scanner changes", async () => {
    const directory = await fixture();
    await fs.mkdir(path.join(directory, "components"));
    await fs.writeFile(
      path.join(directory, "components", "Badge.tsx"),
      "export function Badge() { return null }\n",
    );
    await fs.writeFile(
      path.join(directory, "preview-adapter.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.preview",
  displayName: "Acme Preview",
  scan: () => ({ previews: [{
    componentFilePath: "components/Badge.tsx",
    preview: {
      id: "acme.preview:badge#Default",
      title: "Default",
      adapterId: "acme.preview",
      source: { filePath: "components/Badge.tsx", line: 1 },
      exportName: "Badge",
      locator: "components/Badge.tsx#Badge"
    }
  }] }),
  resolveCaptureUrl: (_preview, { baseUrl }) => new URL("/badge", baseUrl).toString()
};
`,
    );

    const graph = await scanWorkspace(directory, {
      componentPreviewAdapterModules: ["./preview-adapter.mjs"],
    });

    expect(
      graph.components[0]?.previewSources.some(
        (preview) => preview.adapterId === "acme.preview",
      ),
    ).toBe(true);
  });

  it("discovers executable Topo previews in the permanent Next.js playground", async () => {
    const playgroundRoot = path.resolve(
      process.cwd(),
      "../../apps/playground-next-app",
    );
    const graph = await scanWorkspace(playgroundRoot);
    const previews = graph.components.flatMap((component) =>
      component.previewSources.map((preview) => ({
        component: component.name,
        adapterId: preview.adapterId,
        exportName: preview.exportName,
        source: preview.source.filePath,
      })),
    );

    expect(previews).toEqual(
      expect.arrayContaining([
        {
          component: "StatusCard",
          adapterId: "topo",
          exportName: "Routes",
          source: "components/StatusCard.topo.tsx",
        },
        {
          component: "StatusCard",
          adapterId: "topo",
          exportName: "States",
          source: "components/StatusCard.topo.tsx",
        },
        {
          component: "HealthBadge",
          adapterId: "topo",
          exportName: "HealthBadge",
          source: "components/HealthBadge.tsx",
        },
      ]),
    );
  });
});
