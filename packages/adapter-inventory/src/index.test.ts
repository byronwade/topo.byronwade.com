import { describe, expect, it } from "vitest";

import type { AdapterScaffoldInspection } from "@topo/adapter-scaffold";
import { emptyApplicationGraph } from "@topo/schema";

import { buildAdapterInventory } from "./index.js";

function fixtureInspection(): AdapterScaffoldInspection {
  return {
    adapters: [
      {
        filePath: "topo/adapters/acme-routes/adapter.json",
        manifest: {
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
        },
      },
      {
        filePath: "topo/adapters/acme-preview/adapter.json",
        manifest: {
          schemaVersion: 1,
          kind: "component-preview",
          id: "acme.preview",
          displayName: "Acme previews",
          source: "local",
          entry: "index.mjs",
          test: "index.test.mjs",
          registration: {
            configKey: "componentPreviewAdapters",
            moduleSpecifier: "./topo/adapters/acme-preview/index.mjs",
          },
          generatedBy: "topo adapters create",
        },
      },
      {
        filePath: "topo/adapters/acme-runtime/adapter.json",
        manifest: {
          schemaVersion: 1,
          kind: "application-runtime",
          id: "acme.runtime",
          displayName: "Acme runtime",
          source: "local",
          entry: "index.mjs",
          test: "index.test.mjs",
          registration: {
            configKey: "applicationRuntimeAdapters",
            moduleSpecifier: "./topo/adapters/acme-runtime/index.mjs",
          },
          generatedBy: "topo adapters create",
        },
      },
    ],
    issues: [
      {
        filePath: "topo/adapters/broken/adapter.json",
        message: "Invalid adapter manifest",
      },
    ],
  };
}

describe("adapter inventory", () => {
  it("merges built-ins, configured modules, local scaffolds, observations, and manifest issues", () => {
    const graph = emptyApplicationGraph("C:/project/apps/web");
    graph.framework = "next-app";
    graph.screens = [
      {
        id: "screen:home",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
      {
        id: "screen:customers",
        kind: "screen",
        title: "Customers",
        routePath: "/customers",
        framework: "next-app",
        state: "default",
        group: "/customers",
        source: { filePath: "app/customers/page.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
    ];
    graph.components = [
      {
        id: "component:card",
        kind: "component",
        name: "Card",
        source: { filePath: "components/Card.tsx", line: 1 },
        previewStatus: "renderable",
        usedBy: ["screen:home"],
        previewSources: [
          {
            id: "storybook:card#Default",
            title: "Storybook",
            adapterId: "storybook",
            source: { filePath: "components/Card.stories.tsx", line: 1 },
            exportName: "Default",
            locator: "components/Card.stories.tsx#Default",
          },
          {
            id: "topo:card#Default",
            title: "Topo",
            adapterId: "topo",
            source: { filePath: "components/Card.topo.tsx", line: 1 },
            exportName: "Default",
            locator: "components/Card.topo.tsx#Default",
          },
          {
            id: "acme.preview:card#Default",
            title: "Acme",
            adapterId: "acme.preview",
            source: { filePath: "components/Card.preview.tsx", line: 1 },
            exportName: "Default",
            locator: "components/Card.preview.tsx#Default",
          },
          {
            id: "observed.preview:card#Default",
            title: "Observed",
            adapterId: "observed.preview",
            source: { filePath: "components/Card.observed.tsx", line: 1 },
            exportName: "Default",
            locator: "components/Card.observed.tsx#Default",
          },
        ],
      },
    ];
    graph.apiEndpoints = [
      {
        version: 1,
        id: "api:http:GET:/api/health",
        kind: "api-endpoint",
        protocol: "http",
        method: "GET",
        path: "/api/health",
        title: "Health",
        frameworks: ["next-app", "openapi"],
        adapterIds: ["source-api", "openapi"],
        tags: [],
        parameters: [],
        requestContentTypes: [],
        responses: [],
        security: { status: "unknown", schemes: [] },
        discoveries: [
          {
            adapterId: "source-api",
            kind: "framework-source",
            framework: "next-app",
            source: { filePath: "app/api/health/route.ts", line: 1 },
            confidence: 1,
          },
          {
            adapterId: "openapi",
            kind: "openapi",
            framework: "openapi",
            source: { filePath: "openapi.json", line: 1 },
            confidence: 1,
          },
        ],
      },
    ];
    graph.flowTransitions = [
      {
        version: 1,
        id: "flow-transition:home-customers",
        adapterId: "source-flow",
        kind: "navigation",
        sourceScreenId: "screen:home",
        sourceRoutePath: "/",
        target: {
          kind: "screen",
          status: "resolved",
          routePath: "/customers",
          screenId: "screen:customers",
        },
        action: "Navigate to /customers",
        source: { filePath: "app/page.tsx", line: 8 },
        confidence: 1,
      },
    ];
    graph.inferredFlows = [
      {
        version: 1,
        id: "inferred-flow:home",
        title: "Home inferred journey",
        description: "Read-only source-derived candidate.",
        entryStepId: "inferred-step:home",
        confidence: 1,
        adapterIds: ["source-flow"],
        transitionCount: 1,
        truncated: false,
        steps: [
          {
            id: "inferred-step:home",
            kind: "screen",
            title: "Home",
            routePath: "/",
            screenId: "screen:home",
            transitionIds: [],
            sources: [{ filePath: "app/page.tsx", line: 1 }],
            nextStepIds: ["inferred-step:customers"],
          },
          {
            id: "inferred-step:customers",
            kind: "screen",
            title: "Customers",
            routePath: "/customers",
            screenId: "screen:customers",
            action: "Navigate to /customers",
            transitionIds: ["flow-transition:home-customers"],
            sources: [{ filePath: "app/page.tsx", line: 8 }],
            nextStepIds: [],
          },
        ],
      },
    ];

    const inventory = buildAdapterInventory({
      graph,
      inspection: fixtureInspection(),
      extensions: {
        frameworkAdapters: [
          "./topo/adapters/acme-routes/index.mjs",
          "@vendor/routes",
        ],
        componentPreviewAdapters: [
          "./topo/adapters/acme-preview/index.mjs",
          "@vendor/previews",
        ],
        applicationRuntimeAdapters: ["@vendor/runtime"],
      },
    });

    expect(inventory).toMatchObject({
      schemaVersion: 1,
      summary: {
        total: 23,
        active: 8,
        registered: 5,
        declared: 1,
        issues: 1,
      },
      issues: [
        {
          filePath: "topo/adapters/broken/adapter.json",
          message: "Invalid adapter manifest",
        },
      ],
    });
    expect(inventory.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "builtin:framework:topo.next",
          adapterId: "topo.next",
          kind: "framework",
          provenance: "built-in",
          status: "active",
          active: true,
          routeCount: 2,
        }),
        expect.objectContaining({
          id: "builtin:framework:topo.tanstack",
          status: "available",
          active: false,
        }),
        expect.objectContaining({
          id: "builtin:api-endpoint:source-api",
          status: "active",
          endpointCount: 1,
          endpointIds: ["api:http:GET:/api/health"],
        }),
        expect.objectContaining({
          id: "builtin:flow-discovery:source-flow",
          status: "active",
          transitionCount: 1,
          inferredFlowCount: 1,
          flowTransitionIds: ["flow-transition:home-customers"],
          inferredFlowIds: ["inferred-flow:home"],
        }),
        expect.objectContaining({
          id: "scaffold:framework:acme.routes",
          adapterId: "acme.routes",
          status: "registered",
          registered: true,
          manifestPath: "topo/adapters/acme-routes/adapter.json",
        }),
        expect.objectContaining({
          id: "scaffold:component-preview:acme.preview",
          status: "active",
          active: true,
          registered: true,
          previewCount: 1,
          componentIds: ["component:card"],
        }),
        expect.objectContaining({
          id: "scaffold:application-runtime:acme.runtime",
          status: "declared",
          registered: false,
        }),
        expect.objectContaining({
          id: "configured:framework:@vendor/routes",
          provenance: "configured",
          status: "registered",
          moduleSpecifier: "@vendor/routes",
        }),
        expect.objectContaining({
          id: "observed:component-preview:observed.preview",
          provenance: "observed",
          status: "active",
          previewCount: 1,
          componentIds: ["component:card"],
        }),
      ]),
    );
    expect(inventory.adapters.map((adapter) => adapter.id)).toEqual(
      [...inventory.adapters.map((adapter) => adapter.id)].sort(),
    );
  });

  it("retains exact route ownership for scaffolded and observed framework adapters", () => {
    const graph = emptyApplicationGraph("C:/project/apps/web");
    graph.framework = "mixed";
    graph.screens = [
      {
        id: "screen:next",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        adapterId: "topo.next",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
      ...["/customers", "/customers/:id"].map((routePath, index) => ({
        id: `screen:acme:${index}`,
        kind: "screen" as const,
        title: `Customer ${index}`,
        routePath,
        framework: "acme-router",
        adapterId: "acme.routes",
        state: "default" as const,
        group: "/customers",
        source: { filePath: `views/customer-${index}.tsx`, line: 1 },
        renderStatus: "unseen" as const,
        tags: [],
      })),
      {
        id: "screen:vendor",
        kind: "screen",
        title: "Reports",
        routePath: "/reports",
        framework: "vendor-router",
        adapterId: "vendor.routes",
        state: "default",
        group: "/reports",
        source: { filePath: "views/reports.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
    ];
    const frameworkScaffold = fixtureInspection().adapters[0]!;

    const inventory = buildAdapterInventory({
      graph,
      inspection: { adapters: [frameworkScaffold], issues: [] },
      extensions: {
        frameworkAdapters: [
          "./topo/adapters/acme-routes/index.mjs",
          "@vendor/routes",
        ],
      },
    });

    expect(inventory.summary).toMatchObject({
      total: 19,
      active: 3,
      registered: 2,
      issues: 0,
    });
    expect(inventory.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "builtin:framework:topo.next",
          routeCount: 1,
          screenIds: ["screen:next"],
        }),
        expect.objectContaining({
          id: "scaffold:framework:acme.routes",
          status: "active",
          registered: true,
          routeCount: 2,
          screenIds: ["screen:acme:0", "screen:acme:1"],
        }),
        expect.objectContaining({
          id: "observed:framework:vendor.routes",
          status: "active",
          routeCount: 1,
          screenIds: ["screen:vendor"],
        }),
        expect.objectContaining({
          id: "configured:framework:@vendor/routes",
          status: "registered",
          active: false,
          screenIds: [],
        }),
      ]),
    );
  });
});
