import { describe, expect, it } from "vitest";

import {
  createComponentGroups,
  diffCanvasVisibility,
  fitCanvasBounds,
  createRouteDistricts,
  createRouteSections,
  layoutGraph,
  panCanvasBy,
  selectVisibleCanvasItems,
  zoomCanvasAt,
} from "./index.js";

import { emptyApplicationGraph, type ApplicationGraph } from "@topo/schema";

const graph: ApplicationGraph = {
  ...emptyApplicationGraph("C:/fixture"),
  version: 1,
  generatedAt: "2026-07-31T00:00:00.000Z",
  rootDir: "C:/fixture",
  previewBaseUrl: "http://localhost:3000",
  framework: "next-app",
  screens: [
    {
      id: "screen:/dashboard",
      kind: "screen",
      title: "Dashboard",
      routePath: "/dashboard",
      framework: "next-app",
      state: "default",
      group: "/dashboard",
      source: { filePath: "app/dashboard/page.tsx", line: 1 },
      renderStatus: "unseen",
      tags: [],
    },
  ],
  components: [],
  apiEndpoints: [],
  edges: [],
  findings: [],
  sourceIssues: [],
};

describe("layoutGraph", () => {
  it("is deterministic for the same graph", () => {
    expect(layoutGraph(graph)).toEqual(layoutGraph(graph));
    expect(layoutGraph(graph).screens[0]?.position).toEqual({ x: 96, y: 138 });
  });

  it("wraps large route groups into deterministic columns when requested", () => {
    const repeated = {
      ...graph,
      screens: Array.from({ length: 5 }, (_, index) => ({
        ...graph.screens[0]!,
        id: `screen:${index}`,
        routePath: `/dashboard/${index}`,
      })),
    };
    const layout = layoutGraph(repeated, {
      columnGap: 20,
      maxRowsPerColumn: 2,
      nodeGap: 10,
      nodeHeight: 50,
      nodeWidth: 100,
      padding: 10,
    });

    expect(layout.screens.map((screen) => screen.position)).toEqual([
      { x: 20, y: 62 },
      { x: 20, y: 122 },
      { x: 140, y: 62 },
      { x: 140, y: 122 },
      { x: 260, y: 62 },
    ]);
  });

  it("wraps route groups into deterministic rows when requested", () => {
    const grouped = {
      ...graph,
      screens: Array.from({ length: 3 }, (_, index) => ({
        ...graph.screens[0]!,
        id: `grouped:${index}`,
        group: `/group-${index}`,
        routePath: `/group-${index}`,
      })),
    };
    const layout = layoutGraph(grouped, {
      groupGap: 20,
      maxGroupsPerRow: 2,
      nodeHeight: 50,
      nodeWidth: 100,
      padding: 10,
    });

    expect(layout.groups[2]?.position.x).toBe(10);
    expect(layout.groups[2]?.position.y).toBeGreaterThan(
      layout.groups[0]!.position.y + layout.groups[0]!.height,
    );
  });

  it("packs districts by world-space width without splitting a district", () => {
    const grouped = {
      ...graph,
      screens: Array.from({ length: 3 }, (_, index) => ({
        ...graph.screens[0]!,
        id: `width-group:${index}`,
        group: `/group-${index}`,
        routePath: `/group-${index}`,
      })),
    };
    const layout = layoutGraph(grouped, {
      groupGap: 20,
      nodeHeight: 50,
      nodeWidth: 100,
      padding: 10,
      targetRowWidth: 260,
    });

    expect(layout.groups[0]?.position.y).toBe(layout.groups[1]?.position.y);
    expect(layout.groups[2]?.position.x).toBe(10);
    expect(layout.groups[2]?.position.y).toBeGreaterThan(
      layout.groups[0]!.position.y,
    );
  });
});

describe("createRouteDistricts", () => {
  it("keeps route families adjacent, puts static siblings first, and exposes exact metadata", () => {
    const screens = [
      {
        ...graph.screens[0]!,
        id: "dynamic",
        group: "/customers",
        routePath: "/customers/[id]",
      },
      {
        ...graph.screens[0]!,
        id: "new",
        group: "/customers",
        routePath: "/customers/new",
      },
      {
        ...graph.screens[0]!,
        id: "index",
        group: "/customers",
        routePath: "/customers",
      },
      {
        ...graph.screens[0]!,
        id: "loading",
        group: "/customers",
        routePath: "/customers/[id]",
        state: "loading" as const,
      },
    ];

    expect(createRouteDistricts(screens)).toEqual([
      expect.objectContaining({
        id: "/customers",
        label: "Customers",
        routePrefix: "/customers",
        routeCount: 3,
        screenCount: 4,
        stateCount: 1,
        dynamicRouteCount: 1,
        maxDepth: 2,
        renderStatusCounts: {
          blocked: 0,
          captured: 0,
          live: 0,
          unseen: 4,
        },
        routes: expect.arrayContaining([
          expect.objectContaining({
            id: "route:/customers/[id]",
            routePath: "/customers/[id]",
            dynamic: true,
            primaryScreenId: "dynamic",
            screenIds: ["dynamic", "loading"],
            states: ["default", "loading"],
          }),
        ]),
        screens: expect.arrayContaining(screens),
      }),
    ]);
    expect(
      createRouteDistricts(screens)[0]?.screens.map((screen) => screen.id),
    ).toEqual(["index", "new", "dynamic", "loading"]);
  });

  it("retains natural numeric route ordering through the shared atlas sorter", () => {
    const screens = [
      {
        ...graph.screens[0]!,
        id: "report-10",
        group: "/reports",
        routePath: "/reports/item-10",
      },
      {
        ...graph.screens[0]!,
        id: "report-2",
        group: "/reports",
        routePath: "/reports/item-2",
      },
    ];

    expect(
      createRouteDistricts(screens)[0]?.routes.map((route) => route.routePath),
    ).toEqual(["/reports/item-2", "/reports/item-10"]);
  });

  it("publishes the exact route ancestry used by the atlas", () => {
    const screens = [
      {
        ...graph.screens[0]!,
        id: "jobs",
        group: "/jobs",
        routePath: "/jobs",
      },
      {
        ...graph.screens[0]!,
        id: "jobs-new",
        group: "/jobs",
        routePath: "/jobs/new",
      },
      {
        ...graph.screens[0]!,
        id: "job",
        group: "/jobs",
        routePath: "/jobs/[id]",
      },
      {
        ...graph.screens[0]!,
        id: "job-edit",
        group: "/jobs",
        routePath: "/jobs/[id]/edit",
      },
    ];

    expect(
      createRouteDistricts(screens)[0]?.routes.map((route) => ({
        id: route.id,
        parentRouteId: route.parentRouteId,
        childRouteIds: route.childRouteIds,
        hierarchyLevel: route.hierarchyLevel,
      })),
    ).toEqual([
      {
        id: "route:/jobs",
        parentRouteId: undefined,
        childRouteIds: ["route:/jobs/new", "route:/jobs/[id]"],
        hierarchyLevel: 0,
      },
      {
        id: "route:/jobs/new",
        parentRouteId: "route:/jobs",
        childRouteIds: [],
        hierarchyLevel: 1,
      },
      {
        id: "route:/jobs/[id]",
        parentRouteId: "route:/jobs",
        childRouteIds: ["route:/jobs/[id]/edit"],
        hierarchyLevel: 1,
      },
      {
        id: "route:/jobs/[id]/edit",
        parentRouteId: "route:/jobs/[id]",
        childRouteIds: [],
        hierarchyLevel: 2,
      },
    ]);
  });

  it("uses keyed prefix rules as deterministic atlas districts", () => {
    const screens = [
      {
        ...graph.screens[0]!,
        id: "home",
        title: "Home",
        group: "/",
        routePath: "/",
      },
      {
        ...graph.screens[0]!,
        id: "jobs",
        title: "Jobs",
        group: "/jobs",
        routePath: "/jobs",
      },
      {
        ...graph.screens[0]!,
        id: "job",
        title: "Job",
        group: "/jobs",
        routePath: "/jobs/:jobId",
      },
      {
        ...graph.screens[0]!,
        id: "profile",
        title: "Profile",
        group: "/settings",
        routePath: "/settings/profile",
      },
      {
        ...graph.screens[0]!,
        id: "users",
        title: "Users",
        group: "/admin",
        routePath: "/admin/users",
      },
    ];
    const createOrganizedDistricts = createRouteDistricts as unknown as (
      input: typeof screens,
      organization: {
        version: 1;
        routeGroups: Record<
          string,
          { label: string; order: number; prefixes: string[] }
        >;
        componentGroups: Record<
          string,
          { label: string; order: number; prefixes: string[] }
        >;
      },
    ) => ReturnType<typeof createRouteDistricts>;

    const districts = createOrganizedDistricts(screens, {
      version: 1,
      routeGroups: {
        workspace: {
          label: "Workspace",
          order: 20,
          prefixes: ["/jobs", "/settings"],
        },
        administration: {
          label: "Administration",
          order: 10,
          prefixes: ["/admin"],
        },
      },
      componentGroups: {},
    });

    expect(
      districts.map((district) => {
        const readableDistrict = district as typeof district & {
          source?: "automatic" | "configured";
          routePrefixes?: string[];
        };
        return {
          id: district.id,
          label: district.label,
          source: readableDistrict.source,
          prefixes: readableDistrict.routePrefixes,
          routes: district.routes.map((route) => route.routePath),
        };
      }),
    ).toEqual([
      {
        id: "/",
        label: "Entry",
        source: "automatic",
        prefixes: ["/"],
        routes: ["/"],
      },
      {
        id: "administration",
        label: "Administration",
        source: "configured",
        prefixes: ["/admin"],
        routes: ["/admin/users"],
      },
      {
        id: "workspace",
        label: "Workspace",
        source: "configured",
        prefixes: ["/jobs", "/settings"],
        routes: ["/jobs", "/jobs/:jobId", "/settings/profile"],
      },
    ]);
  });

  it("keeps every state in one route family when adapter groups disagree", () => {
    const screens = [
      {
        ...graph.screens[0]!,
        id: "customer",
        adapterId: "fixture.router",
        group: "/customers",
        routePath: "/customers/[id]",
      },
      {
        ...graph.screens[0]!,
        id: "customer-loading",
        adapterId: "fixture.states",
        group: "/admin",
        routePath: "/customers/[id]",
        state: "loading" as const,
      },
    ];

    expect(
      createRouteDistricts(screens).map((district) => ({
        id: district.id,
        routes: district.routes.map((route) => ({
          id: route.id,
          screenIds: route.screenIds,
          adapterIds: route.adapterIds,
        })),
      })),
    ).toEqual([
      {
        id: "/customers",
        routes: [
          {
            id: "route:/customers/[id]",
            screenIds: ["customer", "customer-loading"],
            adapterIds: ["fixture.router", "fixture.states"],
          },
        ],
      },
    ]);
  });

  it("uses the longest configured prefix for nested route domains", () => {
    const screens = [
      {
        ...graph.screens[0]!,
        id: "jobs",
        group: "/jobs",
        routePath: "/jobs",
      },
      {
        ...graph.screens[0]!,
        id: "job-admin",
        group: "/jobs",
        routePath: "/jobs/admin/users",
      },
    ];

    const districts = createRouteDistricts(screens, {
      version: 1,
      routeGroups: {
        workspace: {
          label: "Workspace",
          order: 10,
          prefixes: ["/jobs"],
        },
        administration: {
          label: "Administration",
          order: 20,
          prefixes: ["/jobs/admin"],
        },
      },
      componentGroups: {},
    });

    expect(
      districts.map((district) => ({
        id: district.id,
        routes: district.routes.map((route) => route.routePath),
      })),
    ).toEqual([
      { id: "workspace", routes: ["/jobs"] },
      { id: "administration", routes: ["/jobs/admin/users"] },
    ]);
  });

  it("splits oversized automatic domains into stable nested districts", () => {
    const screens = [
      {
        ...graph.screens[0]!,
        id: "workspace",
        group: "/workspace",
        routePath: "/workspace",
      },
      ...["jobs", "customers", "reports"].flatMap((area) =>
        ["", "new", "[id]", "history"].map((leaf, index) => ({
          ...graph.screens[0]!,
          id: `${area}-${index}`,
          group: "/workspace",
          routePath: `/workspace/${area}${leaf ? `/${leaf}` : ""}`,
        })),
      ),
    ];

    expect(
      createRouteDistricts(screens).map((district) => ({
        id: district.id,
        label: district.label,
        routePrefix: district.routePrefix,
        routes: district.routes.map((route) => route.routePath),
      })),
    ).toEqual([
      {
        id: "/workspace",
        label: "Workspace",
        routePrefix: "/workspace",
        routes: ["/workspace"],
      },
      {
        id: "automatic:/workspace/customers",
        label: "Customers",
        routePrefix: "/workspace/customers",
        routes: [
          "/workspace/customers",
          "/workspace/customers/history",
          "/workspace/customers/new",
          "/workspace/customers/[id]",
        ],
      },
      {
        id: "automatic:/workspace/jobs",
        label: "Jobs",
        routePrefix: "/workspace/jobs",
        routes: [
          "/workspace/jobs",
          "/workspace/jobs/history",
          "/workspace/jobs/new",
          "/workspace/jobs/[id]",
        ],
      },
      {
        id: "automatic:/workspace/reports",
        label: "Reports",
        routePrefix: "/workspace/reports",
        routes: [
          "/workspace/reports",
          "/workspace/reports/history",
          "/workspace/reports/new",
          "/workspace/reports/[id]",
        ],
      },
    ]);
  });

  it("nests split domains into regions while consolidating loose top-level areas", () => {
    const screens = [
      {
        ...graph.screens[0]!,
        id: "home",
        title: "Home",
        group: "/",
        routePath: "/",
      },
      {
        ...graph.screens[0]!,
        id: "pricing",
        title: "Pricing",
        group: "/pricing",
        routePath: "/pricing",
      },
      {
        ...graph.screens[0]!,
        id: "workspace",
        group: "/workspace",
        routePath: "/workspace",
      },
      ...["jobs", "customers", "reports"].flatMap((area) =>
        ["", "new", "[id]", "history"].map((leaf, index) => ({
          ...graph.screens[0]!,
          id: `${area}-${index}`,
          group: "/workspace",
          routePath: `/workspace/${area}${leaf ? `/${leaf}` : ""}`,
        })),
      ),
    ];

    const sections = createRouteSections(createRouteDistricts(screens));

    expect(
      sections.map((section) => ({
        id: section.id,
        label: section.label,
        districts: section.districtIds,
        routeCount: section.routeCount,
      })),
    ).toEqual([
      {
        id: "section:top-level",
        label: "Top level",
        districts: ["/", "/pricing"],
        routeCount: 2,
      },
      {
        id: "section:/workspace",
        label: "Workspace",
        districts: [
          "/workspace",
          "automatic:/workspace/customers",
          "automatic:/workspace/jobs",
          "automatic:/workspace/reports",
        ],
        routeCount: 13,
      },
    ]);
    expect(sections.flatMap((section) => section.screenIds)).toHaveLength(
      screens.length,
    );
  });
});

describe("createComponentGroups", () => {
  const component = (
    id: string,
    filePath: string,
    previewStatus: "renderable" | "missing" | "blocked" | "unknown",
  ) => ({
    id,
    kind: "component" as const,
    name: id.split(":").at(-1) ?? id,
    source: { filePath },
    previewStatus,
    previewSources: [],
    usedBy: [`screen:${id}`],
  });

  it("discovers source domains and puts coverage gaps first within each group", () => {
    const groups = createComponentGroups([
      component(
        "component:button",
        "src/components/ui/Button.tsx",
        "renderable",
      ),
      component("component:dialog", "src/components/ui/Dialog.tsx", "missing"),
      component(
        "component:customer-card",
        "src/features/customers/components/CustomerCard.tsx",
        "blocked",
      ),
      component(
        "component:job-card",
        "src/features/jobs/components/JobCard.tsx",
        "renderable",
      ),
    ]);

    expect(
      groups.map((group) => ({
        id: group.id,
        label: group.label,
        sourcePrefix: group.sourcePrefix,
        componentIds: group.componentIds,
      })),
    ).toEqual([
      {
        id: "component-source:src/features/customers",
        label: "Customers",
        sourcePrefix: "src/features/customers",
        componentIds: ["component:customer-card"],
      },
      {
        id: "component-source:src/features/jobs",
        label: "Jobs",
        sourcePrefix: "src/features/jobs",
        componentIds: ["component:job-card"],
      },
      {
        id: "component-source:src/components/ui",
        label: "UI",
        sourcePrefix: "src/components/ui",
        componentIds: ["component:dialog", "component:button"],
      },
    ]);
  });

  it("uses longest configured prefixes and retains complete group evidence", () => {
    const groups = createComponentGroups(
      [
        component(
          "component:customer-card",
          "src/features/customers/CustomerCard.tsx",
          "missing",
        ),
        {
          ...component(
            "component:customer-form",
            "src/features/customers/forms/CustomerForm.tsx",
            "renderable",
          ),
          previewSources: [
            {
              id: "storybook:customer-form",
              title: "Default",
              adapterId: "storybook",
              source: { filePath: "CustomerForm.stories.tsx" },
              locator: "CustomerForm.stories.tsx#Default",
              priority: 100,
              discovery: "storybook" as const,
            },
          ],
          usedBy: ["screen:customers", "screen:new-customer"],
        },
      ],
      {
        version: 1,
        routeGroups: {},
        componentGroups: {
          customers: {
            label: "Customer domain",
            order: 20,
            prefixes: ["src/features/customers"],
          },
          forms: {
            label: "Forms",
            order: 10,
            prefixes: ["src/features/customers/forms"],
          },
        },
      },
    );

    expect(groups).toEqual([
      expect.objectContaining({
        id: "component-group:forms",
        label: "Forms",
        source: "configured",
        order: 0,
        componentIds: ["component:customer-form"],
        routeUsageCount: 2,
        previewCount: 1,
        previewStatusCounts: {
          renderable: 1,
          missing: 0,
          blocked: 0,
          unknown: 0,
        },
      }),
      expect.objectContaining({
        id: "component-group:customers",
        label: "Customer domain",
        order: 1,
        componentIds: ["component:customer-card"],
      }),
    ]);
  });
});

describe("canvas camera", () => {
  it("keeps the world point beneath the zoom anchor stationary", () => {
    const camera = { x: 40, y: 20, zoom: 1 };
    const anchor = { x: 240, y: 120 };
    const worldBefore = {
      x: (anchor.x - camera.x) / camera.zoom,
      y: (anchor.y - camera.y) / camera.zoom,
    };
    const zoomed = zoomCanvasAt(camera, 2, anchor);

    expect({
      x: (anchor.x - zoomed.x) / zoomed.zoom,
      y: (anchor.y - zoomed.y) / zoomed.zoom,
    }).toEqual(worldBefore);
  });

  it("centers fitted bounds and respects the requested maximum zoom", () => {
    expect(
      fitCanvasBounds(
        { x: 0, y: 0, width: 780, height: 706 },
        { width: 928, height: 778 },
        { maxZoom: 1, padding: 24 },
      ),
    ).toEqual({ x: 74, y: 36, zoom: 1 });
  });

  it("can align fitted bounds without changing their deterministic scale", () => {
    expect(
      fitCanvasBounds(
        { x: 100, y: 200, width: 400, height: 200 },
        { width: 1_000, height: 800 },
        {
          alignX: "end",
          alignY: "start",
          maxZoom: 1,
          padding: 40,
        },
      ),
    ).toEqual({ x: 460, y: -160, zoom: 1 });
  });

  it("applies screen-pixel pan deltas without changing zoom", () => {
    expect(panCanvasBy({ x: 10, y: 20, zoom: 0.75 }, { x: -4, y: 8 })).toEqual({
      x: 6,
      y: 28,
      zoom: 0.75,
    });
  });
});

describe("selectVisibleCanvasItems", () => {
  it("selects viewport and overscan intersections while preserving pinned items", () => {
    const items = [
      { id: "inside", x: 100, y: 60, width: 80, height: 40 },
      { id: "overscan-edge", x: 49, y: 20, width: 1, height: 20 },
      { id: "outside", x: 48, y: 20, width: 1, height: 20 },
      {
        id: "pinned",
        x: 5_000,
        y: 5_000,
        width: 80,
        height: 40,
        alwaysVisible: true,
      },
    ];

    expect(
      selectVisibleCanvasItems(
        items,
        { x: -200, y: -100, zoom: 2 },
        { width: 800, height: 600 },
        { overscan: 100 },
      ).map((item) => item.id),
    ).toEqual(["inside", "overscan-edge", "pinned"]);
  });

  it("treats overscan as screen pixels at every zoom level", () => {
    const candidate = {
      id: "candidate",
      x: -99,
      y: 0,
      width: 1,
      height: 1,
    };

    expect(
      selectVisibleCanvasItems(
        [candidate],
        { x: 0, y: 0, zoom: 0.5 },
        { width: 800, height: 600 },
        { overscan: 50 },
      ),
    ).toHaveLength(1);
    expect(
      selectVisibleCanvasItems(
        [{ ...candidate, x: -102 }],
        { x: 0, y: 0, zoom: 0.5 },
        { width: 800, height: 600 },
        { overscan: 50 },
      ),
    ).toHaveLength(0);
  });
});

describe("diffCanvasVisibility", () => {
  it("returns stable enter and exit deltas without touching retained items", () => {
    const result = diffCanvasVisibility(new Set(["screen-a", "screen-b"]), [
      { id: "screen-b" },
      { id: "screen-c" },
      { id: "screen-d" },
    ]);

    expect(result.entered).toEqual(["screen-c", "screen-d"]);
    expect(result.exited).toEqual(["screen-a"]);
    expect([...result.visible]).toEqual(["screen-b", "screen-c", "screen-d"]);
  });
});
