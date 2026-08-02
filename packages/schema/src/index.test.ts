import { describe, expect, it } from "vitest";

import {
  AtlasOrganizationSchema,
  NoteRecordSchema,
  PreviewCapturePolicySchema,
  PreviewRouteExamplesSchema,
  RouteSnapshotSchema,
  UpdateFlowInputSchema,
  emptyApplicationGraph,
  isParameterizedRoutePath,
  parseApplicationGraph,
  parseFlow,
  parseInteractionProbeArtifact,
  resolveScreenPreviewRoute,
} from "./index.js";

describe("framework route parameters", () => {
  it("recognizes parameters emitted by every built-in adapter family", () => {
    expect(
      [
        "/customers/[customerId]",
        "/jobs/:jobId",
        "/users-:group/:id",
        "/docs/:slug(.*)*",
        "/reports/:year?",
        "/legacy/$routeId",
      ].every(isParameterizedRoutePath),
    ).toBe(true);
    expect(isParameterizedRoutePath("/customers/settings")).toBe(false);
  });
});

describe("preview capture policy schema", () => {
  it("keeps only bounded, non-secret capture behavior machine-readable", () => {
    expect(
      PreviewCapturePolicySchema.parse({
        version: 1,
        autoCapture: true,
        headless: true,
        viewport: { width: 1440, height: 1000 },
      }),
    ).toEqual({
      version: 1,
      autoCapture: true,
      headless: true,
      viewport: { width: 1440, height: 1000 },
    });
    expect(() =>
      PreviewCapturePolicySchema.parse({
        version: 1,
        autoCapture: true,
        headless: true,
        viewport: { width: 0, height: 1000 },
      }),
    ).toThrow();
  });
});

describe("review evidence schemas", () => {
  it("keeps note and snapshot records browser-safe and canonical", () => {
    const timestamp = "2026-08-01T02:00:00.000Z";
    expect(
      NoteRecordSchema.parse({
        version: 1,
        id: "review-home",
        type: "element",
        title: "Review home",
        body: "Check the primary action.",
        status: "open",
        anchor: {
          status: "attached",
          source: { filePath: "app/page.tsx", line: 12 },
          coordinates: { x: 0.5, y: 0.25 },
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }).anchor?.source?.filePath,
    ).toBe("app/page.tsx");
    expect(
      RouteSnapshotSchema.parse({
        id: "snapshot-home",
        screenId: "screen-home",
        routePath: "/",
        previewPath: "/?profile=owner",
        capturedAt: timestamp,
        status: "captured",
        contentHash: "a".repeat(64),
      }).previewPath,
    ).toBe("/?profile=owner");
  });

  it("rejects malformed note anchors and snapshot evidence", () => {
    const timestamp = "2026-08-01T02:00:00.000Z";
    expect(() =>
      NoteRecordSchema.parse({
        version: 1,
        id: "review-home",
        type: "element",
        title: "Review home",
        body: "Check it.",
        status: "open",
        anchor: { status: "attached", coordinates: { x: 2, y: 0 } },
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toThrow();
    expect(() =>
      RouteSnapshotSchema.parse({
        id: "snapshot-home",
        screenId: "screen-home",
        routePath: "https://example.com",
        capturedAt: timestamp,
        status: "captured",
        contentHash: "not-a-hash",
      }),
    ).toThrow();
  });
});

describe("atlas organization schema", () => {
  it("rejects a route prefix claimed by two configured districts", () => {
    expect(() =>
      AtlasOrganizationSchema.parse({
        routeGroups: {
          workspace: { label: "Workspace", prefixes: ["/jobs"] },
          operations: { label: "Operations", prefixes: ["/jobs"] },
        },
      }),
    ).toThrow(/already owned/);
  });

  it("normalizes component groups and rejects duplicate source ownership", () => {
    expect(
      AtlasOrganizationSchema.parse({
        componentGroups: {
          design: { label: "Design system", prefixes: ["components/ui"] },
        },
      }),
    ).toEqual({
      version: 1,
      routeGroups: {},
      componentGroups: {
        design: {
          label: "Design system",
          order: 100,
          prefixes: ["components/ui"],
        },
      },
    });
    expect(() =>
      AtlasOrganizationSchema.parse({
        componentGroups: {
          design: { label: "Design system", prefixes: ["components/ui"] },
          shared: { label: "Shared", prefixes: ["components/ui"] },
        },
      }),
    ).toThrow(/already owned/);
  });
});

describe("application graph schema", () => {
  it("creates a valid empty graph at the seam", () => {
    const graph = emptyApplicationGraph("C:/example");

    expect(parseApplicationGraph(graph)).toMatchObject({
      version: 1,
      rootDir: "C:/example",
      screens: [],
      components: [],
    });
  });

  it("rejects a graph with an invalid confidence value", () => {
    expect(() =>
      parseApplicationGraph({
        ...emptyApplicationGraph("C:/example"),
        findings: [
          {
            id: "finding-1",
            severity: "low",
            status: "open",
            title: "Possible inert control",
            description: "No observable effect was recorded.",
            confidence: 2,
            evidence: [],
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts namespaced framework ids from external adapters", () => {
    const graph = emptyApplicationGraph("C:/example");
    graph.framework = "acme-router";
    graph.screens = [
      {
        id: "acme-router:/:default:views/home.tsx",
        kind: "screen",
        title: "Home",
        routePath: "/",
        framework: "acme-router",
        adapterId: "acme.routes",
        state: "default",
        group: "/",
        source: { filePath: "views/home.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
    ];

    expect(parseApplicationGraph(graph)).toMatchObject({
      framework: "acme-router",
      screens: [{ adapterId: "acme.routes" }],
    });
    graph.screens[0]!.adapterId = "Invalid adapter";
    expect(() => parseApplicationGraph(graph)).toThrow();
  });

  it("preserves adapter-owned component preview sources as readable graph data", () => {
    const graph = emptyApplicationGraph("C:/example");
    graph.components = [
      {
        id: "component:components/Button.tsx",
        kind: "component",
        name: "Button",
        source: { filePath: "components/Button.tsx", line: 1 },
        previewStatus: "renderable",
        previewSources: [
          {
            id: "storybook:components/Button.stories.tsx#Primary",
            title: "Primary",
            adapterId: "storybook",
            source: {
              filePath: "components/Button.stories.tsx",
              line: 1,
            },
            exportName: "Primary",
            locator: "components/Button.stories.tsx#Primary",
            priority: 100,
            readiness: {
              readySelector: 'html[data-topo-preview-status="ready"]',
              errorSelector: 'html[data-topo-preview-status="error"]',
              timeoutMs: 10_000,
            },
          },
        ],
        usedBy: [],
      },
    ];

    expect(
      parseApplicationGraph(graph).components[0]?.previewSources[0],
    ).toMatchObject({
      adapterId: "storybook",
      exportName: "Primary",
      priority: 100,
      readiness: {
        readySelector: 'html[data-topo-preview-status="ready"]',
        errorSelector: 'html[data-topo-preview-status="error"]',
        timeoutMs: 10_000,
      },
    });
  });

  it("validates branching flows and their step references", () => {
    const flow = parseFlow({
      version: 1,
      id: "customer-onboarding",
      title: "Customer onboarding",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
      entryStepId: "start",
      steps: [
        {
          id: "start",
          title: "Open form",
          routePath: "/customers/new",
          nextStepIds: ["saved"],
        },
        { id: "saved", title: "Confirm customer", routePath: "/customers/:id" },
      ],
    });

    expect(flow.steps[0]?.nextStepIds).toEqual(["saved"]);
    expect(() => parseFlow({ ...flow, entryStepId: "missing" })).toThrow();
    expect(() => parseFlow({ ...flow, id: "../checkout" })).toThrow("Flow id");
    expect(() => UpdateFlowInputSchema.parse({})).toThrow(
      "A flow update must include at least one field",
    );
  });

  it("preserves a versioned interaction probe as structured evidence", () => {
    const artifact = parseInteractionProbeArtifact({
      version: 1,
      id: "interaction-probe:home:watch-tour",
      routePath: "/",
      screenId: "next-app:/:default:app/page.tsx",
      control: {
        index: 3,
        id: "control:watch-tour",
        label: "Watch the tour",
        tagName: "button",
        role: "button",
        locator: 'role=button[name="Watch the tour"]',
      },
      status: "possibly-inert",
      effects: [],
      evidence: [
        'Activated role=button[name="Watch the tour"] on /',
        "Observed no recognized effect after 200ms",
      ],
      observedAt: "2026-08-01T01:00:00.000Z",
    });

    expect(artifact).toMatchObject({
      routePath: "/",
      status: "possibly-inert",
      control: { role: "button", label: "Watch the tour" },
    });
    expect(() =>
      parseInteractionProbeArtifact({
        ...artifact,
        effects: [{ kind: "guess", summary: "Unknown effect" }],
      }),
    ).toThrow();
  });
});

describe("preview route examples", () => {
  it("resolves Next.js and TanStack parameters without changing route identity", () => {
    const routes = PreviewRouteExamplesSchema.parse({
      "/customers/[customerId]": "/customers/customer-demo?tab=activity",
      "/jobs/:jobId": "/jobs/job-1042",
      "/docs/$slug": "/docs/getting-started",
    });

    expect(
      resolveScreenPreviewRoute("/customers/[customerId]", routes),
    ).toEqual({
      version: 1,
      status: "configured",
      path: "/customers/customer-demo?tab=activity",
      source: "topo.config.ts",
    });
    expect(resolveScreenPreviewRoute("/settings", routes)).toEqual({
      version: 1,
      status: "identity",
      path: "/settings",
    });
    expect(
      resolveScreenPreviewRoute("/orders/[orderId]", routes),
    ).toMatchObject({
      version: 1,
      status: "unresolved",
    });
  });

  it("rejects external and still-parameterized preview destinations", () => {
    expect(() =>
      PreviewRouteExamplesSchema.parse({
        "/customers/[customerId]": "https://example.com/customers/1",
      }),
    ).toThrow(/absolute application paths/);
    expect(() =>
      PreviewRouteExamplesSchema.parse({
        "/customers/[customerId]": "/customers/[customerId]",
      }),
    ).toThrow(/replace every route parameter/);
  });
});
