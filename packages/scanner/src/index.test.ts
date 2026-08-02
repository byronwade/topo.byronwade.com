import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
} from "@topo/framework-adapter";
import {
  COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  defineComponentPreviewAdapter,
} from "@topo/preview-adapter";
import { afterEach, describe, expect, it } from "vitest";

import { createScannerSession, scanWorkspace } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-scanner-"));
  temporaryDirectories.push(directory);
  await fs.writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ dependencies: { next: "latest", react: "latest" } }),
  );
  await fs.mkdir(path.join(directory, "app", "(marketing)", "pricing"), {
    recursive: true,
  });
  await fs.mkdir(path.join(directory, "app", "dashboard"), { recursive: true });
  await fs.mkdir(path.join(directory, "src", "components"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(directory, "app", "page.tsx"),
    "export default function Page() { return null }\n",
  );
  await fs.writeFile(
    path.join(directory, "app", "(marketing)", "pricing", "page.tsx"),
    "export default function Page() { return null }\n",
  );
  await fs.writeFile(
    path.join(directory, "app", "dashboard", "loading.tsx"),
    "export default function Loading() { return null }\n",
  );
  await fs.writeFile(
    path.join(directory, "src", "components", "CustomerCard.tsx"),
    "export function CustomerCard() { return null }\n",
  );
  return directory;
}

describe("scanWorkspace", () => {
  it("reuses one source snapshot for reported changes and full explicit rescans", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-scanner-session-"),
    );
    temporaryDirectories.push(directory);
    await fs.mkdir(path.join(directory, "views"));
    await fs.writeFile(path.join(directory, "package.json"), "{}\n");
    await fs.writeFile(
      path.join(directory, "views", "home.tsx"),
      'export const version = "home-v1";\n',
    );
    await fs.writeFile(
      path.join(directory, "views", "about.tsx"),
      'export const version = "about-v1";\n',
    );
    const adapter = defineFrameworkAdapter({
      apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
      id: "fixture.session-router",
      displayName: "Session Router",
      detect: ({ files }) =>
        files.some((file) => file.filePath.startsWith("views/"))
          ? [
              {
                framework: "session-router",
                confidence: 1,
                reasons: ["views source"],
              },
            ]
          : [],
      async scan(context) {
        const routes = await Promise.all(
          context.files
            .filter((file) => file.filePath.startsWith("views/"))
            .map(async (file) => ({
              framework: "session-router",
              filePath: file.filePath,
              routePath: `/${path.posix.basename(file.filePath, ".tsx")}`,
              state: "default" as const,
              title: (await context.readFile(file.filePath)).match(
                /"([^"]+)"/,
              )?.[1],
            })),
        );
        return { routes };
      },
    });
    const session = createScannerSession(directory, { adapters: [adapter] });

    const initial = await session.scan();
    expect(initial.screens.map((screen) => screen.title)).toEqual([
      "about-v1",
      "home-v1",
    ]);

    await fs.writeFile(
      path.join(directory, "views", "home.tsx"),
      'export const version = "home-v2";\n',
    );
    await fs.writeFile(
      path.join(directory, "views", "about.tsx"),
      'export const version = "about-v2";\n',
    );
    const incremental = await session.scan(["views/home.tsx"]);
    expect(incremental.screens.map((screen) => screen.title)).toEqual([
      "about-v1",
      "home-v2",
    ]);

    const complete = await session.scan();
    expect(complete.screens.map((screen) => screen.title)).toEqual([
      "about-v2",
      "home-v2",
    ]);

    await fs.writeFile(
      path.join(directory, "views", "contact.tsx"),
      'export const version = "contact-v1";\n',
    );
    expect(
      (await session.scan(["views/contact.tsx"])).screens.map(
        (screen) => screen.routePath,
      ),
    ).toEqual(["/about", "/contact", "/home"]);

    await fs.rm(path.join(directory, "views", "contact.tsx"));
    expect(
      (await session.scan(["views/contact.tsx"])).screens.map(
        (screen) => screen.routePath,
      ),
    ).toEqual(["/about", "/home"]);

    await fs.mkdir(path.join(directory, "views", "account"));
    await fs.writeFile(
      path.join(directory, "views", "account", "settings.tsx"),
      'export const version = "settings-v1";\n',
    );
    expect(
      (await session.scan(["views/account"])).screens.map(
        (screen) => screen.routePath,
      ),
    ).toEqual(["/about", "/home", "/settings"]);
  });

  it("normalizes routes from an injected adapter without knowing its framework", async () => {
    const adapter = defineFrameworkAdapter({
      apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
      id: "fixture.router",
      displayName: "Fixture Router",
      detect: () => [
        {
          framework: "fixture-router",
          confidence: 1,
          reasons: ["test fixture"],
        },
      ],
      scan: (context) => ({
        routes: context.files
          .filter(
            (file) =>
              file.filePath.endsWith("page.tsx") ||
              file.filePath.endsWith("loading.tsx"),
          )
          .map((file) => ({
            framework: "fixture-router",
            filePath: file.filePath,
            routePath: file.filePath.includes("pricing")
              ? "/pricing"
              : file.filePath.includes("dashboard")
                ? "/dashboard"
                : "/",
            state: file.filePath.endsWith("loading.tsx")
              ? ("loading" as const)
              : ("default" as const),
          })),
      }),
    });
    const graph = await scanWorkspace(await createFixture(), {
      adapters: [adapter],
    });

    expect(graph.framework).toBe("fixture-router");
    expect(
      graph.screens.every((screen) => screen.adapterId === "fixture.router"),
    ).toBe(true);
    expect(
      graph.screens.map((screen) => [screen.routePath, screen.state]),
    ).toEqual([
      ["/", "default"],
      ["/dashboard", "loading"],
      ["/pricing", "default"],
    ]);
    expect(graph.components.map((component) => component.name)).toEqual([
      "CustomerCard",
    ]);
    expect(graph.components[0]).toMatchObject({
      previewStatus: "missing",
      previewSources: [],
    });
  });

  it("materializes concrete preview paths and blocks unresolved dynamic routes", async () => {
    const adapter = defineFrameworkAdapter({
      apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
      id: "fixture.router",
      displayName: "Fixture Router",
      detect: () => [
        {
          framework: "fixture-router",
          confidence: 1,
          reasons: ["test fixture"],
        },
      ],
      scan: () => ({
        routes: [
          {
            framework: "fixture-router",
            filePath: "app/page.tsx",
            routePath: "/customers/[customerId]",
            state: "default",
          },
          {
            framework: "fixture-router",
            filePath: "app/(marketing)/pricing/page.tsx",
            routePath: "/jobs/:jobId",
            state: "default",
          },
        ],
      }),
    });

    const graph = await scanWorkspace(await createFixture(), {
      adapters: [adapter],
      previewRoutes: {
        "/customers/[customerId]": "/customers/customer-demo",
      },
    });

    expect(graph.screens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routePath: "/customers/[customerId]",
          previewRoute: {
            version: 1,
            status: "configured",
            path: "/customers/customer-demo",
            source: "topo.config.ts",
          },
          renderStatus: "unseen",
        }),
        expect.objectContaining({
          routePath: "/jobs/:jobId",
          previewRoute: expect.objectContaining({ status: "unresolved" }),
          renderStatus: "blocked",
        }),
      ]),
    );
  });

  it("attaches preview contributions by exact component source path", async () => {
    const frameworkAdapter = defineFrameworkAdapter({
      apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
      id: "fixture.router",
      displayName: "Fixture Router",
      detect: () => [
        {
          framework: "fixture-router",
          confidence: 1,
          reasons: ["test fixture"],
        },
      ],
      scan: () => ({ routes: [] }),
    });
    const previewAdapter = defineComponentPreviewAdapter({
      apiVersion: COMPONENT_PREVIEW_ADAPTER_API_VERSION,
      id: "fixture.preview",
      displayName: "Fixture Preview",
      scan: () => ({
        previews: [
          {
            componentFilePath: "src/components/CustomerCard.tsx",
            preview: {
              id: "fixture.preview:customer-card#Default",
              title: "Default",
              adapterId: "fixture.preview",
              source: {
                filePath: "src/components/CustomerCard.preview.tsx",
                line: 1,
              },
              exportName: "Default",
              locator: "src/components/CustomerCard.preview.tsx#Default",
            },
          },
        ],
      }),
      resolveCaptureUrl: () => "http://127.0.0.1:6100/customer-card",
    });

    const graph = await scanWorkspace(await createFixture(), {
      adapters: [frameworkAdapter],
      previewAdapters: [previewAdapter],
    });

    expect(graph.components[0]).toMatchObject({
      previewStatus: "renderable",
      previewSources: [
        {
          id: "fixture.preview:customer-card#Default",
          adapterId: "fixture.preview",
        },
      ],
    });
  });

  it("reports inactive colocated preview drafts as LLM-readable coverage findings", async () => {
    const directory = await createFixture();
    await fs.writeFile(
      path.join(directory, "src", "components", "CustomerCard.topo.tsx"),
      `import type { ComponentProps } from "react";
import { CustomerCard } from "./CustomerCard";

type PreviewProps = ComponentProps<typeof CustomerCard>;
const fixture = {} satisfies Partial<PreviewProps>;
void fixture;
`,
    );
    const frameworkAdapter = defineFrameworkAdapter({
      apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
      id: "fixture.router",
      displayName: "Fixture Router",
      detect: () => [
        {
          framework: "fixture-router",
          confidence: 1,
          reasons: ["test fixture"],
        },
      ],
      scan: () => ({ routes: [] }),
    });

    const graph = await scanWorkspace(directory, {
      adapters: [frameworkAdapter],
    });

    expect(graph.components[0]).toMatchObject({
      id: "component:src/components/CustomerCard.tsx",
      previewStatus: "missing",
      previewSources: [],
    });
    expect(graph.findings).toContainEqual(
      expect.objectContaining({
        id: "component-preview-draft:component:src/components/CustomerCard.tsx",
        title: "Component preview fixture required",
        source: {
          filePath: "src/components/CustomerCard.topo.tsx",
          line: 1,
        },
        evidence: expect.arrayContaining([
          "Component: component:src/components/CustomerCard.tsx",
        ]),
      }),
    );
  });

  it("derives transitive component coverage from Oxc module relationships", async () => {
    const directory = await createFixture();
    await fs.mkdir(path.join(directory, "src", "features"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(directory, "src", "components", "TypeOnlyCard.tsx"),
      "export interface TypeOnlyCard { value: string }\n",
    );
    await fs.writeFile(
      path.join(directory, "src", "features", "Dashboard.tsx"),
      [
        'import { CustomerCard as Card } from "../components/CustomerCard";',
        'import type { TypeOnlyCard } from "../components/TypeOnlyCard";',
        "export function Dashboard() { return <Card /> }",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(directory, "app", "page.tsx"),
      'import { Dashboard } from "../src/features/Dashboard";\nexport default function Page() { return <Dashboard /> }\n',
    );
    const adapter = defineFrameworkAdapter({
      apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
      id: "fixture.router",
      displayName: "Fixture Router",
      detect: () => [
        {
          framework: "fixture-router",
          confidence: 1,
          reasons: ["test fixture"],
        },
      ],
      scan: () => ({
        routes: [
          {
            framework: "fixture-router",
            filePath: "app/page.tsx",
            routePath: "/",
            state: "default",
          },
        ],
      }),
    });

    const graph = await scanWorkspace(directory, { adapters: [adapter] });
    const home = graph.screens[0]!;
    const byName = new Map(
      graph.components.map((component) => [component.name, component]),
    );

    expect(byName.get("CustomerCard")?.usedBy).toEqual([home.id]);
    expect(byName.get("TypeOnlyCard")?.usedBy).toEqual([]);
  });

  it("keeps source parse failures visible as blocked coverage and findings", async () => {
    const directory = await createFixture();
    await fs.writeFile(
      path.join(directory, "src", "components", "BrokenCard.tsx"),
      "export function BrokenCard( {\n  return null\n}\n",
    );
    const adapter = defineFrameworkAdapter({
      apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
      id: "fixture.router",
      displayName: "Fixture Router",
      detect: () => [
        {
          framework: "fixture-router",
          confidence: 1,
          reasons: ["test fixture"],
        },
      ],
      scan: () => ({ routes: [] }),
    });

    const graph = await scanWorkspace(directory, { adapters: [adapter] });

    expect(
      graph.components.find((component) => component.name === "BrokenCard"),
    ).toMatchObject({ previewStatus: "blocked" });
    expect(graph.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Source parse error",
          severity: "high",
          source: expect.objectContaining({
            filePath: "src/components/BrokenCard.tsx",
          }),
          evidence: expect.arrayContaining(["Parser: oxc"]),
        }),
      ]),
    );
  });
});
