import { describe, expect, it } from "vitest";

import { emptyApplicationGraph, type ApplicationGraph } from "@topo/schema";

import {
  createAtlasScene,
  createComponentScene,
  createFlowScene,
  createLayoutEngine,
} from "./index.js";
import {
  AtlasSceneSchema,
  ComponentSceneSchema,
  FlowSceneSchema,
} from "./schema.js";

describe("layout engine", () => {
  it("returns a stable empty canvas", () => {
    expect(
      createLayoutEngine().layout(emptyApplicationGraph("test")).width,
    ).toBeGreaterThan(0);
  });
});

describe("createAtlasScene", () => {
  const graph: ApplicationGraph = {
    ...emptyApplicationGraph("C:/fixture"),
    version: 1,
    generatedAt: "2026-07-31T00:00:00.000Z",
    rootDir: "C:/fixture",
    previewBaseUrl: "http://localhost:3000",
    framework: "next-app",
    screens: [
      {
        id: "home",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "next-app",
        adapterId: "topo.next",
        state: "default",
        group: "/",
        source: { filePath: "app/page.tsx" },
        renderStatus: "captured",
        tags: [],
      },
      {
        id: "jobs",
        kind: "screen",
        title: "Jobs",
        routePath: "/jobs",
        framework: "next-app",
        adapterId: "topo.next",
        state: "default",
        group: "/jobs",
        source: { filePath: "app/jobs/page.tsx" },
        renderStatus: "captured",
        tags: [],
      },
    ],
    components: [],
    apiEndpoints: [],
    edges: [
      {
        id: "home-to-jobs",
        source: "home",
        target: "jobs",
        kind: "navigation",
        confidence: 1,
      },
    ],
    findings: [],
    sourceIssues: [],
  };

  it("anchors the selected screen at the world origin without losing the whole-atlas bounds", () => {
    const scene = createAtlasScene(graph, "jobs");

    expect(AtlasSceneSchema.parse(scene).version).toBe(4);
    expect(
      scene.layout.screens.find((screen) => screen.id === "jobs")?.position,
    ).toEqual({
      x: 0,
      y: 0,
    });
    expect(scene.selectedBounds).toEqual({
      x: 0,
      y: -18,
      width: 780,
      height: 706,
    });
    expect(scene.selectedGroupBounds.width).toBeGreaterThan(360);
    expect(scene.selectedSectionBounds.width).toBeGreaterThan(
      scene.selectedGroupBounds.width,
    );
    expect(scene.routeMap.sections).toMatchObject([
      {
        id: "section:top-level",
        label: "Top level",
        groupIds: ["/", "/jobs"],
        routeCount: 2,
        screenCount: 2,
      },
    ]);
    expect(
      scene.layout.groups.find((group) => group.id === "/jobs"),
    ).toMatchObject({
      label: "Jobs",
      routePrefix: "/jobs",
      order: 1,
      screenIds: ["jobs"],
      routeCount: 1,
      screenCount: 1,
    });
    expect(scene.bounds.x).toBeLessThan(0);
    expect(scene.bounds.width).toBeGreaterThan(780);
    expect(scene.routeMap.routes).toMatchObject([
      {
        id: "route:/",
        routePath: "/",
        primaryScreenId: "home",
        screenIds: ["home"],
        adapterIds: ["topo.next"],
      },
      {
        id: "route:/jobs",
        routePath: "/jobs",
        primaryScreenId: "jobs",
        screenIds: ["jobs"],
        adapterIds: ["topo.next"],
      },
    ]);
  });

  it("projects graph edges into deterministic world-space connection points", () => {
    const scene = createAtlasScene(graph, "home");

    expect(scene.connections).toHaveLength(1);
    expect(scene.connections[0]).toMatchObject({
      id: "home-to-jobs",
      source: "home",
      sourceRouteId: "route:/",
      target: "jobs",
      targetRouteId: "route:/jobs",
      kind: "navigation",
      confidence: 1,
    });
    expect(scene.connections[0]?.sourcePoint.x).toBeLessThan(
      scene.connections[0]!.targetPoint.x,
    );
  });

  it("balances large route districts into bounded, deterministic overview cards", () => {
    const largeGraph: ApplicationGraph = {
      ...graph,
      screens: Array.from({ length: 33 }, (_, index) => ({
        ...graph.screens[1]!,
        id: `workspace-${index}`,
        group: "/workspace",
        routePath: `/workspace/route-${String(index + 1).padStart(2, "0")}`,
        source: { filePath: `app/workspace/route-${index + 1}/page.tsx` },
      })),
      edges: [],
    };

    const scene = createAtlasScene(largeGraph, "workspace-0");
    const district = scene.routeMap.groups[0];

    expect(district).toMatchObject({
      label: "Workspace",
      routeCount: 33,
      screenCount: 33,
      width: 2344,
      height: 1672,
    });
    expect(scene.routeMap.routes).toHaveLength(33);
    expect(
      new Set(
        scene.routeMap.routes.map(
          (route) => `${route.position.x}:${route.position.y}`,
        ),
      ).size,
    ).toBe(33);
    expect(scene.routeMap.bounds.width).toBeLessThan(scene.layout.width);
  });

  it("packs discovered regions into a centered landscape atlas", () => {
    const topLevelRoutes = [
      "/",
      "/billing",
      "/customers",
      "/customers/[id]",
      "/docs",
      "/docs/[slug]",
      "/jobs",
      "/jobs/new",
      "/jobs/[id]",
      "/onboarding",
      "/pricing",
      "/settings",
      "/signup",
      "/signup/verify",
    ];
    const workspaceRoutes = [
      "/workspace",
      ...[
        "customers",
        "dispatch",
        "estimates",
        "inventory",
        "invoices",
        "jobs",
        "reports",
        "settings",
        "technicians",
      ].flatMap((area) => [
        `/workspace/${area}`,
        `/workspace/${area}/new`,
        `/workspace/${area}/[id]`,
      ]),
    ];
    const routes = [...topLevelRoutes, ...workspaceRoutes];
    const landscapeGraph: ApplicationGraph = {
      ...graph,
      screens: routes.map((routePath, index) => ({
        ...graph.screens[1]!,
        id: `screen-${index}`,
        title: routePath === "/" ? "Home" : routePath.split("/").at(-1)!,
        group: routePath.startsWith("/workspace")
          ? "/workspace"
          : routePath === "/"
            ? "/"
            : `/${routePath.split("/")[1]}`,
        routePath,
        source: {
          filePath: `app${routePath === "/" ? "" : routePath}/page.tsx`,
        },
      })),
      edges: [],
    };

    const scene = createAtlasScene(landscapeGraph, "screen-0");
    const topLevel = scene.routeMap.sections.find(
      (section) => section.id === "section:top-level",
    )!;
    const workspace = scene.routeMap.sections.find(
      (section) => section.id === "section:/workspace",
    )!;

    expect(scene.routeMap.sections).toHaveLength(2);
    expect(topLevel.position.x).toBeGreaterThan(workspace.position.x);
    expect(workspace.position.y).toBeGreaterThan(
      topLevel.position.y + topLevel.height,
    );
    expect(
      scene.routeMap.bounds.width / scene.routeMap.bounds.height,
    ).toBeGreaterThan(1);
  });

  it("lays route families out as readable hierarchy lanes with explicit edges", () => {
    const hierarchicalGraph: ApplicationGraph = {
      ...graph,
      screens: [
        {
          ...graph.screens[1]!,
          id: "jobs-index",
          routePath: "/jobs",
        },
        {
          ...graph.screens[1]!,
          id: "jobs-new",
          routePath: "/jobs/new",
          source: { filePath: "app/jobs/new/page.tsx" },
        },
        {
          ...graph.screens[1]!,
          id: "job-detail",
          routePath: "/jobs/[id]",
          source: { filePath: "app/jobs/[id]/page.tsx" },
        },
        {
          ...graph.screens[1]!,
          id: "job-edit",
          routePath: "/jobs/[id]/edit",
          source: { filePath: "app/jobs/[id]/edit/page.tsx" },
        },
      ],
      edges: [],
    };

    const scene = createAtlasScene(hierarchicalGraph, "job-detail");
    const routeById = new Map(
      scene.routeMap.routes.map((route) => [route.id, route]),
    );

    expect(scene.routeMap.groups[0]).toMatchObject({
      layoutMode: "hierarchy",
    });
    expect(routeById.get("route:/jobs")?.position.x).toBeLessThan(
      routeById.get("route:/jobs/[id]")!.position.x,
    );
    expect(routeById.get("route:/jobs/[id]")?.position.x).toBeLessThan(
      routeById.get("route:/jobs/[id]/edit")!.position.x,
    );
    expect(scene.routeMap.hierarchyConnections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parentRouteId: "route:/jobs",
          childRouteId: "route:/jobs/[id]",
        }),
        expect.objectContaining({
          parentRouteId: "route:/jobs/[id]",
          childRouteId: "route:/jobs/[id]/edit",
        }),
      ]),
    );
  });

  it("uses one route organization for overview and selected-screen layouts", () => {
    const organizedGraph: ApplicationGraph = {
      ...graph,
      screens: [
        ...graph.screens,
        {
          ...graph.screens[1]!,
          id: "profile",
          title: "Profile",
          group: "/settings",
          routePath: "/settings/profile",
          source: { filePath: "app/settings/profile/page.tsx" },
        },
      ],
    };
    const createOrganizedScene = createAtlasScene as unknown as (
      input: ApplicationGraph,
      selectedScreenId: string,
      options: {
        routeOrganization: {
          version: 1;
          routeGroups: Record<
            string,
            { label: string; order: number; prefixes: string[] }
          >;
          componentGroups: Record<
            string,
            { label: string; order: number; prefixes: string[] }
          >;
        };
      },
    ) => ReturnType<typeof createAtlasScene>;

    const scene = createOrganizedScene(organizedGraph, "jobs", {
      routeOrganization: {
        version: 1,
        routeGroups: {
          workspace: {
            label: "Workspace",
            order: 10,
            prefixes: ["/jobs", "/settings"],
          },
        },
        componentGroups: {},
      },
    });

    expect(
      scene.routeMap.groups.map((group) => ({
        id: group.id,
        label: group.label,
        screenIds: group.screenIds,
      })),
    ).toEqual([
      { id: "/", label: "Entry", screenIds: ["home"] },
      {
        id: "workspace",
        label: "Workspace",
        screenIds: ["jobs", "profile"],
      },
    ]);
    expect(scene.layout.groups.map((group) => group.id)).toEqual([
      "/",
      "workspace",
    ]);
    expect(scene.routeMap.sections.map((section) => section.id)).toEqual([
      "section:top-level",
      "section:configured:workspace",
    ]);
  });
});

describe("createComponentScene", () => {
  const graph: ApplicationGraph = {
    ...emptyApplicationGraph("C:/fixture"),
    version: 1,
    generatedAt: "2026-07-31T00:00:00.000Z",
    rootDir: "C:/fixture",
    previewBaseUrl: "http://localhost:3000",
    framework: "next-app",
    screens: [
      {
        id: "screen:jobs",
        kind: "screen",
        title: "Jobs",
        routePath: "/jobs",
        framework: "next-app",
        state: "default",
        group: "/jobs",
        source: { filePath: "app/jobs/page.tsx" },
        renderStatus: "captured",
        tags: [],
      },
    ],
    components: [
      {
        id: "component:button",
        kind: "component",
        name: "Button",
        source: { filePath: "components/ui/Button.tsx" },
        previewStatus: "renderable",
        previewSources: [],
        usedBy: ["screen:jobs"],
      },
      {
        id: "component:summary",
        kind: "component",
        name: "CustomerSummaryCard",
        source: {
          filePath: "features/customers/CustomerSummaryCard.tsx",
        },
        previewStatus: "missing",
        previewSources: [],
        usedBy: ["screen:jobs", "screen:removed"],
      },
    ],
    apiEndpoints: [],
    edges: [],
    findings: [],
    sourceIssues: [],
  };

  it("anchors selection while preserving coverage groups and exact usage evidence", () => {
    const scene = createComponentScene(graph, "component:summary");

    expect(ComponentSceneSchema.parse(scene).version).toBe(2);
    expect(scene.selectedComponentId).toBe("component:summary");
    expect(
      scene.components.find((component) => component.id === "component:summary")
        ?.position,
    ).toEqual({ x: 0, y: 0 });
    expect(
      scene.groups.map((group) => [
        group.label,
        group.componentCount,
        group.previewStatusCounts,
      ]),
    ).toEqual([
      ["Customers", 1, { renderable: 0, missing: 1, blocked: 0, unknown: 0 }],
      ["UI", 1, { renderable: 1, missing: 0, blocked: 0, unknown: 0 }],
    ]);
    expect(scene.selectedGroupId).toBe("component-source:features/customers");
    expect(scene.selectedGroupBounds.width).toBeGreaterThan(
      scene.selectedBounds.width / 2,
    );
    expect(scene.routeNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          screenId: "screen:jobs",
          routePath: "/jobs",
          resolution: "resolved",
        }),
        expect.objectContaining({
          screenId: "screen:removed",
          resolution: "unresolved",
        }),
      ]),
    );
    expect(scene.connections).toHaveLength(2);
    expect(scene.components[0]?.height).toBeGreaterThanOrEqual(140);
    expect(scene.bounds.width).toBeGreaterThan(scene.selectedBounds.width);
  });

  it("lays configured component domains into stable bounded rows", () => {
    const components = Array.from({ length: 18 }, (_, index) => ({
      ...graph.components[index % graph.components.length]!,
      id: `component:${index}`,
      name: `Component ${index}`,
      source: {
        filePath:
          index < 9
            ? `features/jobs/Component${index}.tsx`
            : `components/ui/Component${index}.tsx`,
      },
    }));
    const scene = createComponentScene(
      { ...graph, components },
      "component:10",
      {
        organization: {
          version: 1,
          routeGroups: {},
          componentGroups: {
            workspace: {
              label: "Workspace",
              order: 20,
              prefixes: ["features/jobs"],
            },
            design: {
              label: "Design system",
              order: 10,
              prefixes: ["components/ui"],
            },
          },
        },
      },
    );

    expect(scene.groups.map((group) => group.label)).toEqual([
      "Design system",
      "Workspace",
    ]);
    expect(scene.groups[1]!.position.y).toBeGreaterThan(
      scene.groups[0]!.position.y,
    );
    expect(scene.selectedGroupId).toBe("component-group:design");
    expect(scene.components.every((component) => component.groupId)).toBe(true);
  });

  it("packs a large component catalog into centered landscape rows", () => {
    const components = Array.from({ length: 130 }, (_, index) => {
      const domain = Math.floor(index / 13);
      return {
        ...graph.components[index % graph.components.length]!,
        id: `component:domain-${domain}:${index}`,
        name: `Domain ${domain} Component ${index}`,
        source: {
          filePath: `features/domain-${domain}/components/Component${index}.tsx`,
        },
        usedBy: [],
      };
    });
    const scene = createComponentScene(
      { ...graph, components },
      "component:domain-0:0",
    );
    const rows = new Map<number, typeof scene.groups>();
    for (const group of scene.groups) {
      const row = rows.get(group.position.y) ?? [];
      row.push(group);
      rows.set(group.position.y, row);
    }
    const groupLeft = Math.min(
      ...scene.groups.map((group) => group.position.x),
    );
    const groupRight = Math.max(
      ...scene.groups.map((group) => group.position.x + group.width),
    );
    const atlasCenter = (groupLeft + groupRight) / 2;

    expect(scene.groups).toHaveLength(10);
    expect(rows.size).toBeGreaterThan(1);
    expect(rows.size).toBeLessThan(scene.groups.length);
    expect(scene.bounds.width / scene.bounds.height).toBeGreaterThan(1.4);
    for (const row of rows.values()) {
      const rowLeft = Math.min(...row.map((group) => group.position.x));
      const rowRight = Math.max(
        ...row.map((group) => group.position.x + group.width),
      );
      expect((rowLeft + rowRight) / 2).toBeCloseTo(atlasCenter, 5);
    }
    expect(new Set(scene.components.map((component) => component.id))).toEqual(
      new Set(components.map((component) => component.id)),
    );
  });
});

describe("createFlowScene", () => {
  const graph: ApplicationGraph = {
    ...emptyApplicationGraph("C:/fixture"),
    version: 1,
    generatedAt: "2026-07-31T00:00:00.000Z",
    rootDir: "C:/fixture",
    previewBaseUrl: "http://localhost:3000",
    framework: "next-app",
    screens: [
      {
        id: "screen:start",
        kind: "screen",
        title: "Start",
        routePath: "/start",
        framework: "next-app",
        state: "default",
        group: "/start",
        source: { filePath: "app/start/page.tsx" },
        renderStatus: "captured",
        tags: [],
      },
      {
        id: "screen:done",
        kind: "screen",
        title: "Done",
        routePath: "/done",
        framework: "next-app",
        state: "default",
        group: "/done",
        source: { filePath: "app/done/page.tsx" },
        renderStatus: "captured",
        tags: [],
      },
    ],
    components: [],
    apiEndpoints: [],
    edges: [],
    findings: [],
    sourceIssues: [],
  };
  const timestamp = "2026-07-31T00:00:00.000Z";
  const flows = [
    {
      version: 1 as const,
      id: "branched",
      title: "Branched checkout",
      description: "A flow with an explicit branch.",
      status: "verified" as const,
      entryStepId: "start",
      tags: [],
      steps: [
        {
          id: "start",
          title: "Start",
          routePath: "/start",
          action: "choose",
          noteIds: [],
          nextStepIds: ["success", "failure"],
        },
        {
          id: "success",
          title: "Success",
          routePath: "/done",
          noteIds: [],
          nextStepIds: [],
        },
        {
          id: "failure",
          title: "Failure",
          routePath: "/missing",
          noteIds: [],
          nextStepIds: [],
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];

  it("lays out explicit branches and records route resolution without inference", () => {
    const scene = createFlowScene(graph, flows, "branched", "failure");

    expect(FlowSceneSchema.parse(scene).version).toBe(1);
    expect(scene.selectedFlowId).toBe("branched");
    expect(scene.selectedStepId).toBe("failure");
    expect(
      scene.connections.map((connection) => connection.targetStepId),
    ).toEqual(["success", "failure"]);
    expect(
      scene.steps.find((step) => step.stepId === "failure")?.resolution,
    ).toBe("unresolved");
    const branchTargets = scene.steps.filter((step) =>
      ["success", "failure"].includes(step.stepId),
    );
    expect(new Set(branchTargets.map((step) => step.position.x)).size).toBe(1);
    expect(new Set(branchTargets.map((step) => step.position.y)).size).toBe(2);
    expect(scene.lanes[0]?.breakCount).toBe(1);
  });

  it("packs a flow catalog into centered landscape rows without changing explicit edges", () => {
    const catalog = Array.from({ length: 12 }, (_, index) => ({
      ...flows[0]!,
      id: `flow-${index}`,
      title: `Flow ${index}`,
      steps: flows[0]!.steps.map((step) => ({ ...step })),
    }));
    const scene = createFlowScene(graph, catalog, "flow-5", "failure");
    const rows = new Map<number, typeof scene.lanes>();
    for (const lane of scene.lanes) {
      const row = rows.get(lane.position.y) ?? [];
      row.push(lane);
      rows.set(lane.position.y, row);
    }
    const laneLeft = Math.min(...scene.lanes.map((lane) => lane.position.x));
    const laneRight = Math.max(
      ...scene.lanes.map((lane) => lane.position.x + lane.width),
    );
    const atlasCenter = (laneLeft + laneRight) / 2;

    expect(scene.lanes).toHaveLength(12);
    expect(rows.size).toBeGreaterThan(1);
    expect(rows.size).toBeLessThan(scene.lanes.length);
    expect(
      new Set(scene.lanes.map((lane) => lane.position.x)).size,
    ).toBeGreaterThan(1);
    expect(scene.bounds.width / scene.bounds.height).toBeGreaterThan(1.4);
    for (const row of rows.values()) {
      const rowLeft = Math.min(...row.map((lane) => lane.position.x));
      const rowRight = Math.max(
        ...row.map((lane) => lane.position.x + lane.width),
      );
      expect((rowLeft + rowRight) / 2).toBeCloseTo(atlasCenter, 5);
    }
    expect(scene.connections).toHaveLength(24);
    expect(scene.focusFlowIds).toContain("flow-5");
    expect(scene.focusFlowIds).toHaveLength(2);
    expect(scene.selectedBounds.width).toBe(
      scene.lanes.find((lane) => lane.id === "flow-5")!.width + 48,
    );
    expect(scene.selectedBounds.height).toBe(
      scene.lanes.find((lane) => lane.id === "flow-5")!.height + 328,
    );
    expect(
      scene.steps.find((step) => step.nodeId === "flow-5:failure")?.position,
    ).toEqual({ x: 0, y: 0 });
    const stepByNodeId = new Map(
      scene.steps.map((step) => [step.nodeId, step]),
    );
    for (const connection of scene.connections) {
      const source = stepByNodeId.get(connection.sourceNodeId)!;
      const target = stepByNodeId.get(connection.targetNodeId)!;
      expect(connection.sourcePoint).toEqual({
        x: source.position.x + source.width,
        y: source.position.y + source.height / 2,
      });
      expect(connection.targetPoint).toEqual({
        x: target.position.x,
        y: target.position.y + target.height / 2,
      });
    }
  });

  it("handles a 10,000-step scene without recursive layout or spread limits", () => {
    const steps = Array.from({ length: 10_000 }, (_, index) => ({
      id: `step-${index}`,
      title: `Step ${index}`,
      noteIds: [],
      nextStepIds: index < 9_999 ? [`step-${index + 1}`] : [],
    }));
    const scene = createFlowScene(graph, [
      {
        version: 1,
        id: "large-flow",
        title: "Large flow",
        description: "Layout stress fixture",
        status: "draft",
        entryStepId: "step-0",
        tags: [],
        steps,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    expect(scene.steps).toHaveLength(10_000);
    expect(scene.connections).toHaveLength(9_999);
    expect(scene.steps.at(-1)?.position.x).toBeGreaterThan(1_000_000);
  });
});
