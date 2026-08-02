import { describe, expect, it } from "vitest";

import { emptyApplicationGraph } from "@topo/schema";

import {
  applicationGraphContentEqual,
  mergeFindings,
  planSourceChangeImpact,
  reconcileGraph,
} from "./index.js";

describe("graph utilities", () => {
  it("ignores generation time but compares every normalized field", () => {
    const left = emptyApplicationGraph("C:/workspace");
    const right = {
      ...left,
      generatedAt: "2026-08-02T01:00:00.000Z",
    };
    expect(applicationGraphContentEqual(left, right)).toBe(true);
    expect(
      applicationGraphContentEqual(left, { ...right, framework: "next-app" }),
    ).toBe(false);
  });

  it("preserves capture state across a refresh", () => {
    const previous = emptyApplicationGraph("test");
    previous.screens = [
      {
        id: "screen",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx" },
        renderStatus: "captured",
        tags: [],
      },
    ];
    const screen = previous.screens[0];
    if (!screen) throw new Error("Fixture screen missing");
    const next = {
      ...previous,
      screens: [{ ...screen, renderStatus: "unseen" as const }],
    };
    expect(reconcileGraph(previous, next).screens[0]?.renderStatus).toBe(
      "captured",
    );
    expect(
      reconcileGraph(previous, next, ["screen"]).screens[0]?.renderStatus,
    ).toBe("unseen");
    expect(
      reconcileGraph(previous, next, ["screen"], { validate: false }),
    ).toEqual(reconcileGraph(previous, next, ["screen"]));
  });

  it("invalidates capture evidence when a configured preview path changes", () => {
    const previous = emptyApplicationGraph("test");
    previous.screens = [
      {
        id: "screen",
        kind: "screen",
        title: "Customer",
        routePath: "/customers/[customerId]",
        framework: "next-app",
        state: "default",
        group: "/customers",
        source: { filePath: "app/customers/[customerId]/page.tsx" },
        previewRoute: {
          version: 1,
          status: "configured",
          path: "/customers/customer-one",
          source: "topo.config.ts",
        },
        renderStatus: "captured",
        tags: [],
      },
    ];
    const next = {
      ...previous,
      screens: [
        {
          ...previous.screens[0]!,
          previewRoute: {
            version: 1 as const,
            status: "configured" as const,
            path: "/customers/customer-two",
            source: "topo.config.ts" as const,
          },
          renderStatus: "unseen" as const,
        },
      ],
    };

    expect(reconcileGraph(previous, next).screens[0]?.renderStatus).toBe(
      "unseen",
    );
    expect(
      reconcileGraph(previous, {
        ...next,
        screens: [
          {
            ...next.screens[0]!,
            previewRoute: {
              version: 1,
              status: "unresolved",
              reason: "Missing route example",
            },
          },
        ],
      }).screens[0]?.renderStatus,
    ).toBe("blocked");
  });

  it("plans the smallest directly evidenced route and component refresh", () => {
    const graph = emptyApplicationGraph("test");
    graph.screens = [
      {
        id: "screen:home",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx" },
        renderStatus: "captured",
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
        source: { filePath: "app/customers/page.tsx" },
        renderStatus: "captured",
        tags: [],
      },
    ];
    graph.components = [
      {
        id: "component:components/Hero.tsx",
        kind: "component",
        name: "Hero",
        source: { filePath: "components/Hero.tsx" },
        previewStatus: "renderable",
        previewSources: [
          {
            id: "topo.hero:Primary",
            title: "Primary",
            adapterId: "topo.component",
            source: { filePath: "components/Hero.topo.tsx" },
            locator: "components/Hero.topo.tsx#Primary",
          },
        ],
        usedBy: ["screen:home"],
      },
    ];

    expect(
      planSourceChangeImpact(graph, graph, ["components\\Hero.tsx"]),
    ).toEqual({
      strategy: "direct",
      changedPaths: ["components/Hero.tsx"],
      screenIds: ["screen:home"],
      componentIds: ["component:components/Hero.tsx"],
    });
    expect(
      planSourceChangeImpact(graph, graph, ["app/customers/page.tsx"]),
    ).toEqual({
      strategy: "direct",
      changedPaths: ["app/customers/page.tsx"],
      screenIds: ["screen:customers"],
      componentIds: [],
    });
  });

  it("falls back to all visual entities when a rendering dependency is unknown", () => {
    const graph = emptyApplicationGraph("test");
    graph.screens = [
      {
        id: "screen:home",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx" },
        renderStatus: "captured",
        tags: [],
      },
    ];
    graph.components = [
      {
        id: "component:components/Hero.tsx",
        kind: "component",
        name: "Hero",
        source: { filePath: "components/Hero.tsx" },
        previewStatus: "missing",
        previewSources: [],
        usedBy: ["screen:home"],
      },
    ];

    expect(planSourceChangeImpact(graph, graph, ["app/globals.css"])).toEqual({
      strategy: "conservative",
      changedPaths: ["app/globals.css"],
      screenIds: ["screen:home"],
      componentIds: ["component:components/Hero.tsx"],
    });
  });
  it("deduplicates findings by stable id", () => {
    const finding = {
      id: "f",
      severity: "low" as const,
      status: "open" as const,
      title: "Review",
      description: "Evidence",
      confidence: 0.5,
      evidence: [],
    };
    expect(
      mergeFindings([finding], [{ ...finding, description: "Updated" }]),
    ).toHaveLength(1);
  });
});
