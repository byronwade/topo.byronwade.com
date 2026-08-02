import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAdapterInventory } from "@topo/adapter-inventory";
import {
  applyAdapterScaffold,
  planAdapterScaffold,
} from "@topo/adapter-scaffold";
import { emptyApplicationGraph } from "@topo/schema";
import { createProjectStateStore } from "@topo/storage";

import {
  buildLlmContext,
  buildLlmContextFromValidatedGraph,
  exportLlmContext,
  getLlmContextRecord,
  LlmContextManifestSchema,
  LlmContextRecordSchema,
  LLM_CONTEXT_JSON_SCHEMA,
  LLM_CONTEXT_VERSION,
  loadLlmContext,
  queryLlmContext,
  readComponentPreviewArtifact,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

function fixtureContext() {
  const graph = emptyApplicationGraph("C:/project/apps/web");
  graph.framework = "next-app";
  graph.screens = [
    {
      id: "next-app:/customers:default:app/customers/page.tsx",
      kind: "screen",
      title: "Customers",
      routePath: "/customers",
      framework: "next-app",
      state: "default",
      group: "/customers",
      source: { filePath: "app/customers/page.tsx", line: 1 },
      renderStatus: "captured",
      tags: [],
    },
    {
      id: "next-app:/customers:loading:app/customers/loading.tsx",
      kind: "screen",
      title: "Customers loading",
      routePath: "/customers",
      framework: "next-app",
      state: "loading",
      group: "/customers",
      source: { filePath: "app/customers/loading.tsx", line: 1 },
      renderStatus: "unseen",
      tags: [],
    },
  ];
  graph.components = [
    {
      id: "component:customer-summary-card",
      kind: "component",
      name: "CustomerSummaryCard",
      source: {
        filePath: "src/features/customers/components/CustomerSummaryCard.tsx",
        line: 1,
      },
      previewStatus: "missing",
      previewSources: [],
      usedBy: ["next-app:/customers:default:app/customers/page.tsx"],
    },
  ];
  graph.apiEndpoints = [
    {
      version: 1,
      id: "api:http:GET:/api/customers",
      kind: "api-endpoint",
      protocol: "http",
      method: "GET",
      path: "/api/customers",
      title: "List customers",
      operationId: "listCustomers",
      summary: "List customers",
      frameworks: ["next-app", "openapi"],
      adapterIds: ["openapi", "source-api"],
      tags: ["Customers"],
      parameters: [],
      requestContentTypes: [],
      responses: [
        {
          status: "200",
          description: "Customers",
          contentTypes: ["application/json"],
        },
      ],
      security: { status: "declared", schemes: ["previewSession"] },
      discoveries: [
        {
          adapterId: "source-api",
          kind: "framework-source",
          framework: "next-app",
          source: { filePath: "app/api/customers/route.ts", line: 2 },
          confidence: 1,
        },
        {
          adapterId: "openapi",
          kind: "openapi",
          framework: "openapi",
          source: { filePath: "openapi.yaml", line: 8 },
          confidence: 1,
        },
      ],
    },
  ];
  graph.projectRecognition = {
    version: 1,
    status: "recognized",
    frameworks: [
      {
        framework: "next-app",
        confidence: 1,
        adapterIds: ["topo.next"],
        reasons: ["Next.js App Router source conventions were found."],
      },
    ],
    capabilities: [
      {
        id: "routing",
        confidence: 1,
        reasons: ["Two canonical screens were discovered."],
        sources: [{ filePath: "app/customers/page.tsx", line: 1 }],
      },
    ],
    sourceFileCount: 4,
  };
  graph.flowTransitions = [
    {
      version: 1,
      id: "flow-transition:customers-request",
      adapterId: "source-flow",
      kind: "request",
      sourceScreenId: "next-app:/customers:default:app/customers/page.tsx",
      sourceRoutePath: "/customers",
      target: {
        kind: "api-endpoint",
        status: "resolved",
        method: "GET",
        path: "/api/customers",
        endpointId: "api:http:GET:/api/customers",
      },
      action: "Request GET /api/customers",
      source: { filePath: "app/customers/page.tsx", line: 8 },
      confidence: 0.9,
    },
  ];
  graph.inferredFlows = [
    {
      version: 1,
      id: "inferred-flow:customers",
      title: "Customers inferred journey",
      description: "Read-only source-derived candidate.",
      entryStepId: "inferred-step:customers",
      confidence: 0.9,
      adapterIds: ["source-flow"],
      transitionCount: 1,
      truncated: false,
      steps: [
        {
          id: "inferred-step:customers",
          kind: "screen",
          title: "Customers",
          routePath: "/customers",
          screenId: "next-app:/customers:default:app/customers/page.tsx",
          transitionIds: [],
          sources: [{ filePath: "app/customers/page.tsx", line: 1 }],
          nextStepIds: ["inferred-step:customers-api"],
        },
        {
          id: "inferred-step:customers-api",
          kind: "api-endpoint",
          title: "GET /api/customers",
          endpointId: "api:http:GET:/api/customers",
          action: "Request GET /api/customers",
          transitionIds: ["flow-transition:customers-request"],
          sources: [{ filePath: "app/customers/page.tsx", line: 8 }],
          nextStepIds: [],
        },
      ],
    },
  ];
  graph.sourceIssues = [
    {
      version: 1,
      id: "api-endpoint:computed-path",
      area: "api-endpoint",
      adapterId: "source-api",
      filePath: "src/api.ts",
      message: "Computed API path could not be normalized.",
    },
  ];
  return buildLlmContext({
    graph,
    generatedAt: "2026-07-31T00:00:00.000Z",
    project: {
      name: "Fixture",
      projectRoot: "C:/project",
      sourceRoot: "C:/project/apps/web",
      profileNames: ["Owner"],
      atlas: {
        version: 1,
        routeGroups: {
          customers: {
            label: "Customer workspace",
            order: 10,
            prefixes: ["/customers"],
          },
        },
        componentGroups: {
          customers: {
            label: "Customer components",
            order: 10,
            prefixes: ["src/features/customers"],
          },
        },
      },
    },
    notes: [
      {
        version: 1,
        id: "note-1",
        type: "screen",
        title: "Review empty state",
        body: "Explain what the owner should do next.",
        targetRoute: "/customers",
        status: "resolved",
        author: "byron",
        anchor: {
          status: "drifted",
          source: { filePath: "app/customers/page.tsx", line: 18 },
          role: "heading",
          accessibleName: "Customers",
          testLocator: "hero-headline",
          domFingerprint: "a91c",
          driftPixels: 14,
          verifiedAt: "2026-07-31T00:00:00.000Z",
        },
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    ],
    flows: [
      {
        version: 1,
        id: "onboarding",
        title: "Onboarding",
        description: "Create a customer.",
        status: "draft",
        entryStepId: "customers",
        tags: [],
        steps: [
          {
            id: "customers",
            title: "Open customers",
            routePath: "/customers",
            action: "Select Add customer",
            expected: "The form opens",
            noteIds: ["note-1"],
            nextStepIds: [],
          },
        ],
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    ],
    doctorReport: {
      schemaVersion: 1,
      generatedAt: "2026-07-31T00:00:00.000Z",
      projectRoot: "C:/project",
      sourceRoot: "C:/project/apps/web",
      ok: true,
      summary: { total: 1, passed: 1, warnings: 0, errors: 0 },
      checks: [
        {
          id: "runtime.node-version",
          scope: "environment",
          title: "Node.js runtime",
          status: "pass",
          severity: "info",
          detail: "Node.js 24.14.0 satisfies Topo's runtime requirement.",
          evidence: { version: "24.14.0", requiredMajor: 24 },
        },
      ],
    },
  });
}

describe("LLM context", () => {
  it("keeps strict graph validation at the boundary and a parity-safe validated hot path", () => {
    const graph = emptyApplicationGraph("C:/project");
    const input = {
      graph,
      generatedAt: "2026-08-02T00:00:00.000Z",
      project: { name: "Validation fixture" },
    };

    expect(buildLlmContextFromValidatedGraph(input)).toEqual(
      buildLlmContext(input),
    );
    expect(() =>
      buildLlmContext({
        ...input,
        graph: { ...graph, generatedAt: "not-a-date" },
      }),
    ).toThrow();
  });

  it("keeps every projected envelope equivalent to the exported runtime schemas", () => {
    const context = fixtureContext();

    expect(LlmContextManifestSchema.parse(context.manifest)).toEqual(
      context.manifest,
    );
    expect(
      context.records.map((item) => LlmContextRecordSchema.parse(item)),
    ).toEqual(context.records);
  });

  it("represents routes, screens, notes, flows, steps, and sanitized profiles", () => {
    const context = fixtureContext();

    expect(context.manifest.counts.route).toBe(1);
    expect(context.manifest.counts["flow-step"]).toBe(1);
    expect(context.manifest.counts["doctor-check"]).toBe(1);
    expect(context.manifest.schemaVersion).toBe(7);
    expect(context.manifest.counts["api-endpoint"]).toBe(1);
    expect(context.manifest.counts["flow-transition"]).toBe(1);
    expect(context.manifest.counts["inferred-flow"]).toBe(1);
    expect(context.manifest.counts["inferred-flow-step"]).toBe(2);
    expect(LLM_CONTEXT_JSON_SCHEMA.$id).toBe(
      `https://topo.local/schemas/llm-context-v${LLM_CONTEXT_VERSION}.json`,
    );
    expect(context.manifest.project).toMatchObject({
      projectRoot: "C:/project",
      sourceRoot: "C:/project/apps/web",
      rootDir: "C:/project/apps/web",
    });
    expect(
      getLlmContextRecord(context, "preview-profile", "preview-profile:Owner")
        ?.data.secretsIncluded,
    ).toBe(false);
    expect(
      getLlmContextRecord(
        context,
        "flow-step",
        "flow-step:onboarding:customers",
      )?.relationships.some(
        (item) => item.targetKind === "note" && item.targetId === "note-1",
      ),
    ).toBe(true);
    expect(
      getLlmContextRecord(
        context,
        "flow-step",
        "flow-step:onboarding:customers",
      )?.relationships.filter((item) => item.type === "visits-route"),
    ).toHaveLength(1);
    expect(
      getLlmContextRecord(context, "doctor-check", "runtime.node-version"),
    ).toMatchObject({
      summary:
        "pass environment check. Node.js 24.14.0 satisfies Topo's runtime requirement.",
      data: { observedAt: "2026-07-31T00:00:00.000Z" },
    });
    expect(
      getLlmContextRecord(context, "project", "project:current"),
    ).toMatchObject({
      source: { filePath: "topo.config.ts", line: 1 },
      relationships: expect.arrayContaining([
        {
          type: "has-inferred-flow",
          targetKind: "inferred-flow",
          targetId: "inferred-flow:customers",
        },
        {
          type: "organizes-route",
          targetKind: "route",
          targetId: "route:next-app:/customers",
        },
        {
          type: "organizes-component",
          targetKind: "component",
          targetId: "component:customer-summary-card",
        },
      ]),
      data: {
        recognition: {
          status: "recognized",
          frameworks: [expect.objectContaining({ framework: "next-app" })],
        },
      },
    });
    expect(
      getLlmContextRecord(context, "route", "route:next-app:/customers")?.data
        .atlas,
    ).toMatchObject({
      section: {
        id: "section:configured:customers",
        label: "Customer workspace",
        source: "configured",
      },
      district: {
        id: "customers",
        label: "Customer workspace",
      },
      hierarchy: { level: 0 },
    });
    expect(
      queryLlmContext(context, {
        query: "Customer workspace /customers",
        kinds: ["project"],
      }).items,
    ).toHaveLength(1);
    expect(
      queryLlmContext(context, {
        query: "listCustomers GET /api/customers application/json",
        kinds: ["api-endpoint"],
      }).items,
    ).toHaveLength(1);
    expect(
      getLlmContextRecord(
        context,
        "api-endpoint",
        "api:http:GET:/api/customers",
      ),
    ).toMatchObject({
      source: { filePath: "app/api/customers/route.ts", line: 2 },
      data: {
        version: 1,
        operationId: "listCustomers",
        security: { status: "declared", schemes: ["previewSession"] },
      },
    });
    expect(
      context.records.find(
        (record) =>
          record.kind === "issue" &&
          record.source?.filePath === "src/api.ts",
      ),
    ).toMatchObject({ summary: "Computed API path could not be normalized." });
    expect(
      queryLlmContext(context, {
        query: "section:configured:customers",
        kinds: ["route"],
      }).items,
    ).toHaveLength(1);
    expect(
      getLlmContextRecord(
        context,
        "component",
        "component:customer-summary-card",
      )?.data.atlas,
    ).toMatchObject({
      group: {
        id: "component-group:customers",
        label: "Customer components",
        source: "configured",
        order: 0,
        sourcePrefix: "src/features/customers",
      },
      coverage: {
        componentCount: 1,
        routeUsageCount: 1,
        previewCount: 0,
        previewStatusCounts: { missing: 1 },
      },
    });
    expect(
      queryLlmContext(context, {
        query: "Customer components component-group:customers",
        kinds: ["component"],
      }).items,
    ).toHaveLength(1);
  });

  it("surfaces dangling relationships as issue records", () => {
    const base = fixtureContext();
    const graph = base.graph;
    const context = buildLlmContext({
      graph,
      generatedAt: "2026-07-31T00:00:00.000Z",
      flows: [
        {
          version: 1,
          id: "broken-flow",
          title: "Broken reference fixture",
          description: "",
          status: "draft",
          entryStepId: "step",
          tags: [],
          steps: [
            {
              id: "step",
              title: "Reference absent note",
              noteIds: ["note-that-does-not-exist"],
              nextStepIds: [],
            },
          ],
          createdAt: "2026-07-31T00:00:00.000Z",
          updatedAt: "2026-07-31T00:00:00.000Z",
        },
      ],
    });

    expect(context.manifest.counts.issue).toBe(2);
    expect(context.manifest.warnings[0]).toContain("missing note");
  });

  it("uses canonical context identities for traversable route hierarchy", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-route-hierarchy-context-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.framework = "next-app";
    graph.screens = [
      ["screen:home", "Home", "/", "app/page.tsx"],
      ["screen:dashboard", "Dashboard", "/dashboard", "app/dashboard/page.tsx"],
      [
        "screen:customers",
        "Customers",
        "/dashboard/customers",
        "app/dashboard/customers/page.tsx",
      ],
    ].map(([id, title, routePath, filePath]) => ({
      id: id!,
      kind: "screen" as const,
      title: title!,
      routePath: routePath!,
      framework: "next-app" as const,
      state: "default" as const,
      group: routePath!,
      source: { filePath: filePath!, line: 1 },
      renderStatus: "unseen" as const,
      tags: [],
    }));
    const context = buildLlmContext({
      graph,
      generatedAt: "2026-08-02T00:00:00.000Z",
      project: {
        atlas: {
          version: 1,
          routeGroups: {
            workspace: {
              label: "Workspace",
              order: 10,
              prefixes: ["/dashboard"],
            },
          },
          componentGroups: {},
        },
      },
    });
    const dashboard = getLlmContextRecord(
      context,
      "route",
      "route:next-app:/dashboard",
    );
    const customers = getLlmContextRecord(
      context,
      "route",
      "route:next-app:/dashboard/customers",
    );

    expect(dashboard).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "child-route",
          targetKind: "route",
          targetId: "route:next-app:/dashboard/customers",
        },
      ]),
      data: {
        atlas: {
          hierarchy: {
            level: 0,
            childRouteIds: ["route:next-app:/dashboard/customers"],
          },
        },
      },
    });
    expect(customers).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "parent-route",
          targetKind: "route",
          targetId: "route:next-app:/dashboard",
        },
      ]),
      data: {
        atlas: {
          hierarchy: {
            level: 1,
            parentRouteId: "route:next-app:/dashboard",
            childRouteIds: [],
          },
        },
      },
    });
    expect(context.manifest.counts.issue).toBe(0);

    const exported = await exportLlmContext(directory, context);
    const exportedRoutes = (
      await fs.readFile(
        path.join(exported.directory, "records", "route.jsonl"),
        "utf8",
      )
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(
      exportedRoutes.find(
        (route) => route.id === "route:next-app:/dashboard/customers",
      ),
    ).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "parent-route",
          targetKind: "route",
          targetId: "route:next-app:/dashboard",
        },
      ]),
    });
  });

  it("supports bounded, paginated semantic text reads", () => {
    const result = queryLlmContext(fixtureContext(), {
      query: "customers",
      limit: 2,
    });

    expect(result.count).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(2);
  });

  it("makes lifecycle and exact anchor evidence searchable with screen relationships", () => {
    const result = queryLlmContext(fixtureContext(), {
      query: "resolved drifted hero-headline a91c",
      kinds: ["note"],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        kind: "note",
        id: "note-1",
        summary: expect.stringContaining("resolved drifted"),
        relationships: expect.arrayContaining([
          {
            type: "anchored-to-screen",
            targetKind: "screen",
            targetId: "next-app:/customers:default:app/customers/page.tsx",
          },
        ]),
        data: expect.objectContaining({
          status: "resolved",
          author: "byron",
          anchor: expect.objectContaining({
            status: "drifted",
            testLocator: "hero-headline",
            domFingerprint: "a91c",
          }),
        }),
      }),
    ]);
  });

  it("links component preview metadata to its component and binary resource", () => {
    const graph = emptyApplicationGraph("C:/project");
    graph.components = [
      {
        id: "component:button",
        kind: "component",
        name: "Button",
        source: { filePath: "components/Button.tsx", line: 1 },
        previewStatus: "renderable",
        previewSources: [
          {
            id: "storybook:button#Primary",
            title: "Primary",
            adapterId: "storybook",
            source: { filePath: "components/Button.stories.tsx", line: 1 },
            exportName: "Primary",
            locator: "components/Button.stories.tsx#Primary",
          },
        ],
        usedBy: [],
      },
    ];
    const context = buildLlmContext({
      graph,
      generatedAt: "2026-07-31T00:00:00.000Z",
      state: {
        version: 1,
        updatedAt: "2026-07-31T00:00:00.000Z",
        graph,
        snapshots: [],
        visualBaselines: [],
        visualComparisons: [],
        previewArtifacts: [
          {
            version: 1,
            id: "component-preview-button-primary",
            targetKind: "component",
            targetId: "component:button",
            previewId: "storybook:button#Primary",
            adapterId: "storybook",
            title: "Primary",
            source: { filePath: "components/Button.stories.tsx", line: 1 },
            capturedAt: "2026-07-31T00:00:00.000Z",
            status: "captured",
            artifactPath: ".topo/previews/button-primary.png",
            contentHash: "a".repeat(64),
            width: 720,
            height: 480,
          },
        ],
        interactionProbes: [],
        findings: [],
        jobs: [],
        jobHistory: { terminalLimit: 100, retained: 0, pruned: 4 },
      },
    });

    expect(
      getLlmContextRecord(context, "project", "project:current"),
    ).toMatchObject({
      data: {
        jobHistory: { terminalLimit: 100, retained: 0, pruned: 4 },
      },
    });

    const preview = getLlmContextRecord(
      context,
      "component-preview",
      "component-preview-button-primary",
    );
    expect(preview).toMatchObject({
      relationships: [
        {
          type: "captures-component",
          targetKind: "component",
          targetId: "component:button",
        },
      ],
      data: {
        previewId: "storybook:button#Primary",
        resourceUri:
          "topo://component-preview/component-preview-button-primary/image",
      },
    });
  });

  it("links accepted baselines and pixel comparisons to screens and image resources", () => {
    const graph = emptyApplicationGraph("C:/project");
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
        renderStatus: "captured",
        tags: [],
      },
    ];
    const baselineHash = "a".repeat(64);
    const currentHash = "b".repeat(64);
    const context = buildLlmContext({
      graph,
      generatedAt: "2026-08-01T07:00:00.000Z",
      state: {
        version: 1,
        updatedAt: "2026-08-01T07:00:00.000Z",
        graph,
        snapshots: [
          {
            id: "snapshot-home",
            screenId: "screen:home",
            routePath: "/",
            capturedAt: "2026-08-01T07:00:00.000Z",
            status: "captured",
            artifactPath: ".topo/snapshots/home-current.png",
            contentHash: currentHash,
            width: 2,
            height: 2,
          },
        ],
        visualBaselines: [
          {
            version: 1,
            id: "visual-baseline-home",
            screenId: "screen:home",
            routePath: "/",
            sourceSnapshotId: "snapshot-home",
            acceptedAt: "2026-08-01T06:00:00.000Z",
            artifactPath: ".topo/snapshots/home-baseline.png",
            contentHash: baselineHash,
            width: 2,
            height: 2,
          },
        ],
        visualComparisons: [
          {
            version: 1,
            id: "visual-comparison-home",
            screenId: "screen:home",
            routePath: "/",
            baselineId: "visual-baseline-home",
            baselineHash,
            currentSnapshotId: "snapshot-home",
            currentHash,
            comparedAt: "2026-08-01T07:00:00.000Z",
            status: "changed",
            threshold: 0.1,
            changedPixels: 1,
            totalPixels: 4,
            changeRatio: 0.25,
            baselineSize: { width: 2, height: 2 },
            currentSize: { width: 2, height: 2 },
            artifactPath: ".topo/comparisons/home.png",
          },
        ],
        previewArtifacts: [],
        interactionProbes: [],
        findings: [],
        jobs: [],
        jobHistory: { terminalLimit: 100, retained: 0, pruned: 0 },
      },
    });

    expect(
      getLlmContextRecord(context, "visual-baseline", "visual-baseline-home"),
    ).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "baselines-screen",
          targetKind: "screen",
          targetId: "screen:home",
        },
      ]),
      data: {
        resourceUri: "topo://visual-baseline/visual-baseline-home/image",
      },
    });
    expect(
      getLlmContextRecord(
        context,
        "visual-comparison",
        "visual-comparison-home",
      ),
    ).toMatchObject({
      summary: expect.stringContaining("25.000% of pixels changed"),
      data: {
        resourceUri: "topo://visual-comparison/visual-comparison-home/image",
      },
    });
  });

  it("keeps project-owned Studio composition readable in the manifest and project record", () => {
    const graph = emptyApplicationGraph("C:/project");
    const context = buildLlmContext({
      graph,
      generatedAt: "2026-08-01T00:00:00.000Z",
      project: {
        studio: {
          remove: { destinations: ["editor"], commands: ["capture"] },
          destinations: {
            atlas: { label: "Map" },
            reviews: {
              url: "http://127.0.0.1:4400/reviews",
              statusBar: true,
            },
          },
          commands: {
            doctor: { label: "Run checks" },
            openReviews: { to: "reviews" },
          },
        },
      },
    });

    expect(context.manifest.project.studio).toMatchObject({
      remove: { destinations: ["editor"], commands: ["capture"] },
      destinations: {
        atlas: { label: "Map" },
        reviews: { url: "http://127.0.0.1:4400/reviews" },
      },
    });
    expect(
      getLlmContextRecord(context, "project", "project:current")?.data?.studio,
    ).toEqual(context.manifest.project.studio);
  });

  it("keeps sanitized capture policy readable through a bounded project query", () => {
    const context = buildLlmContext({
      graph: emptyApplicationGraph("C:/project/apps/web"),
      generatedAt: "2026-08-02T00:00:00.000Z",
      project: {
        projectRoot: "C:/project",
        sourceRoot: "C:/project/apps/web",
        capture: {
          version: 1,
          autoCapture: false,
          headless: true,
          viewport: { width: 1280, height: 800 },
        },
      },
    });

    const result = queryLlmContext(context, {
      kinds: ["project"],
      query: "1280",
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source: { filePath: "topo.config.ts", line: 1 },
      data: {
        capture: {
          version: 1,
          autoCapture: false,
          headless: true,
          viewport: { width: 1280, height: 800 },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("cookies");
    expect(JSON.stringify(result)).not.toContain("localStorage");
  });

  it("projects configured route examples without replacing canonical route identity", () => {
    const graph = emptyApplicationGraph("C:/project");
    graph.framework = "next-app";
    graph.screens = [
      {
        id: "screen:customer",
        kind: "screen",
        title: "Customer",
        routePath: "/customers/[customerId]",
        framework: "next-app",
        state: "default",
        group: "/customers",
        source: { filePath: "app/customers/[customerId]/page.tsx", line: 1 },
        previewRoute: {
          version: 1,
          status: "configured",
          path: "/customers/customer-demo",
          source: "topo.config.ts",
        },
        renderStatus: "captured",
        tags: [],
      },
    ];
    const context = buildLlmContext({
      graph,
      generatedAt: "2026-08-01T00:00:00.000Z",
      project: {
        previewRoutes: {
          "/customers/[customerId]": "/customers/customer-demo",
        },
      },
    });
    const project = getLlmContextRecord(context, "project", "project:current");
    const route = getLlmContextRecord(
      context,
      "route",
      "route:next-app:/customers/[customerId]",
    );

    expect(context.manifest.project.previewRoutes).toEqual({
      "/customers/[customerId]": "/customers/customer-demo",
    });
    expect(project).toMatchObject({
      source: { filePath: "topo.config.ts" },
      relationships: [
        {
          type: "configures-preview",
          targetKind: "route",
          targetId: "route:next-app:/customers/[customerId]",
        },
      ],
    });
    expect(route).toMatchObject({
      routePath: "/customers/[customerId]",
      data: {
        routePath: "/customers/[customerId]",
        previewRoute: {
          status: "configured",
          path: "/customers/customer-demo",
        },
      },
    });
  });

  it("projects complete interaction-probe evidence into deterministic records", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-interaction-probe-context-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
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
        renderStatus: "captured",
        tags: [],
      },
    ];
    const makeProbe = (
      suffix: string,
      status:
        "effect-observed" | "possibly-inert" | "skipped" | "activation-error",
    ) => ({
      version: 1 as const,
      id: `interaction-probe:${suffix}`,
      routePath: "/",
      screenId: "screen:home",
      control: {
        index: 0,
        id: `control:${suffix}`,
        label: suffix === "skipped" ? "Delete customer" : `Control ${suffix}`,
        tagName: "button",
        role: "button",
        locator: `#${suffix}`,
      },
      status,
      effects:
        status === "effect-observed"
          ? [{ kind: "dom" as const, summary: "Toast appeared" }]
          : [],
      evidence:
        status === "skipped"
          ? ["Matched destructive-action safety policy"]
          : [`Observed ${status}`],
      observedAt: "2026-08-01T01:00:00.000Z",
      ...(status === "activation-error"
        ? { error: "Control detached before activation" }
        : {}),
    });
    const context = buildLlmContext({
      graph,
      generatedAt: "2026-08-01T01:00:00.000Z",
      state: {
        version: 1,
        updatedAt: "2026-08-01T01:00:00.000Z",
        graph,
        snapshots: [],
        visualBaselines: [],
        visualComparisons: [],
        previewArtifacts: [],
        interactionProbes: [
          makeProbe("effect", "effect-observed"),
          makeProbe("inert", "possibly-inert"),
          makeProbe("skipped", "skipped"),
          makeProbe("error", "activation-error"),
        ],
        findings: [],
        jobs: [],
        jobHistory: { terminalLimit: 100, retained: 0, pruned: 0 },
      },
    });

    expect(context.manifest.counts["interaction-probe"]).toBe(4);
    expect(
      getLlmContextRecord(
        context,
        "interaction-probe",
        "interaction-probe:effect",
      ),
    ).toMatchObject({
      routePath: "/",
      relationships: expect.arrayContaining([
        {
          type: "probes-screen",
          targetKind: "screen",
          targetId: "screen:home",
        },
      ]),
      data: {
        status: "effect-observed",
        effects: [{ kind: "dom", summary: "Toast appeared" }],
      },
    });
    expect(
      queryLlmContext(context, {
        query: "delete destructive",
        kinds: ["interaction-probe"],
      }).items[0],
    ).toMatchObject({
      id: "interaction-probe:skipped",
      data: { status: "skipped" },
    });

    const exported = await exportLlmContext(directory, context);
    const lines = (
      await fs.readFile(
        path.join(exported.directory, "records", "interaction-probe.jsonl"),
        "utf8",
      )
    )
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "interaction-probe",
      id: "interaction-probe:effect",
    });
  });

  it("reads component preview images only from inside the project root", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-component-preview-artifact-"),
    );
    temporaryDirectories.push(directory);
    const previewDirectory = path.join(directory, ".topo", "previews");
    await fs.mkdir(previewDirectory, { recursive: true });
    await fs.writeFile(
      path.join(previewDirectory, "button.png"),
      Buffer.from("preview-png"),
    );
    await createProjectStateStore(directory).recordPreviewArtifact({
      version: 1,
      id: "component-preview-button",
      targetKind: "component",
      targetId: "component:button",
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

    const artifact = await readComponentPreviewArtifact(
      directory,
      "component-preview-button",
    );
    expect(artifact?.data.toString()).toBe("preview-png");
  });

  it("exports deterministic JSONL collections and Markdown discovery files", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-llm-context-"),
    );
    temporaryDirectories.push(directory);
    const result = await exportLlmContext(directory, fixtureContext());

    expect(
      JSON.parse(await fs.readFile(result.manifestPath, "utf8")).counts.flow,
    ).toBe(1);
    expect(
      (
        await fs.readFile(
          path.join(result.directory, "records", "route.jsonl"),
          "utf8",
        )
      )
        .split("\n")
        .filter(Boolean),
    ).toHaveLength(1);
    expect(await fs.readFile(result.markdownPath, "utf8")).toContain(
      "## Reading the complete context",
    );
  });
});

describe("adapter ownership context", () => {
  it("projects exact bidirectional route and preview ownership", () => {
    const graph = emptyApplicationGraph("C:/project");
    graph.framework = "acme-router";
    graph.screens = [
      {
        id: "screen:customers",
        kind: "screen",
        title: "Customers",
        routePath: "/customers",
        framework: "acme-router",
        adapterId: "acme.routes",
        state: "default",
        group: "/customers",
        source: { filePath: "views/customers.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
    ];
    graph.components = [
      {
        id: "component:customer-card",
        kind: "component",
        name: "CustomerCard",
        source: { filePath: "components/CustomerCard.tsx", line: 1 },
        previewStatus: "renderable",
        previewSources: [
          {
            id: "acme.preview:customer-card#Default",
            title: "Default",
            adapterId: "acme.preview",
            source: { filePath: "previews/CustomerCard.tsx", line: 1 },
            exportName: "Default",
            locator: "previews/CustomerCard.tsx#Default",
          },
        ],
        usedBy: ["screen:customers"],
      },
    ];
    const adapterInventory = buildAdapterInventory({
      graph,
      inspection: { adapters: [], issues: [] },
    });
    const context = buildLlmContext({
      graph,
      adapterInventory,
      generatedAt: "2026-08-02T00:00:00.000Z",
    });
    const routeAdapterId = "adapter:observed:framework:acme.routes";
    const previewAdapterId = "adapter:observed:component-preview:acme.preview";

    expect(
      getLlmContextRecord(context, "route", "route:acme-router:/customers"),
    ).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "discovered-by",
          targetKind: "adapter",
          targetId: routeAdapterId,
        },
      ]),
      data: { adapterIds: ["acme.routes"] },
    });
    expect(
      getLlmContextRecord(context, "screen", "screen:customers"),
    ).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "discovered-by",
          targetKind: "adapter",
          targetId: routeAdapterId,
        },
      ]),
      data: { adapterId: "acme.routes" },
    });
    expect(
      getLlmContextRecord(context, "adapter", routeAdapterId),
    ).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "discovers-route",
          targetKind: "route",
          targetId: "route:acme-router:/customers",
        },
      ]),
      data: {
        routeCount: 1,
        screenIds: ["screen:customers"],
      },
    });
    expect(
      getLlmContextRecord(context, "component", "component:customer-card"),
    ).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "previewed-by",
          targetKind: "adapter",
          targetId: previewAdapterId,
        },
      ]),
    });
    expect(
      getLlmContextRecord(context, "adapter", previewAdapterId),
    ).toMatchObject({
      relationships: expect.arrayContaining([
        {
          type: "provides-preview",
          targetKind: "component",
          targetId: "component:customer-card",
        },
      ]),
      data: {
        previewCount: 1,
        componentIds: ["component:customer-card"],
      },
    });
    expect(context.manifest.counts.issue).toBe(0);
  });
});

describe("adapter manifest context", () => {
  it("projects valid manifests and exposes malformed manifests as issues", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-llm-adapters-"),
    );
    temporaryDirectories.push(projectRoot);
    await applyAdapterScaffold(
      await planAdapterScaffold({
        projectRoot,
        kind: "framework",
        id: "acme.routes",
        displayName: "Acme routes",
      }),
    );
    const malformedDirectory = path.join(
      projectRoot,
      "topo",
      "adapters",
      "malformed",
    );
    await fs.mkdir(malformedDirectory, { recursive: true });
    await fs.writeFile(
      path.join(malformedDirectory, "adapter.json"),
      '{"schemaVersion":1,"kind":"framework"}\n',
    );
    const graph = emptyApplicationGraph(path.join(projectRoot, "app"));

    const context = await loadLlmContext(projectRoot, graph, {
      projectRoot,
      sourceRoot: graph.rootDir,
      extensions: {
        frameworkAdapters: ["./topo/adapters/acme-routes/index.mjs"],
      },
    });

    expect(context.manifest.counts.adapter).toBe(17);
    expect(
      getLlmContextRecord(context, "adapter", "adapter:acme.routes"),
    ).toMatchObject({
      title: "Acme routes",
      summary:
        "framework adapter Acme routes is registered with 0 routes, 0 component previews, 0 API endpoints, 0 flow transitions, and 0 inferred journeys.",
      source: { filePath: "topo/adapters/acme-routes/adapter.json" },
      relationships: [
        {
          type: "extends-project",
          targetKind: "project",
          targetId: "project:current",
        },
      ],
      data: {
        id: "scaffold:framework:acme.routes",
        adapterId: "acme.routes",
        kind: "framework",
        provenance: "scaffold",
        status: "registered",
        active: false,
        registered: true,
        registration: {
          configKey: "frameworkAdapters",
          moduleSpecifier: "./topo/adapters/acme-routes/index.mjs",
        },
      },
    });
    expect(
      queryLlmContext(context, { kinds: ["adapter"], query: "acme.routes" }),
    ).toMatchObject({ total: 1, count: 1, hasMore: false });
    expect(
      getLlmContextRecord(
        context,
        "adapter",
        "adapter:builtin:framework:topo.next",
      ),
    ).toMatchObject({
      title: "Next.js",
      data: { provenance: "built-in", status: "available" },
    });
    expect(
      context.records.find(
        (record) =>
          record.kind === "issue" &&
          record.source?.filePath === "topo/adapters/malformed/adapter.json",
      ),
    ).toMatchObject({
      title: "Unreadable source record: topo/adapters/malformed/adapter.json",
    });
  });
});

describe("project lifecycle context", () => {
  it("projects sanitized install metadata and exposes unsupported manifests as issues", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-llm-lifecycle-"),
    );
    temporaryDirectories.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, ".topo"), { recursive: true });
    const manifestPath = path.join(projectRoot, ".topo", "install.json");
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 3,
          installedAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T13:00:00.000Z",
          topoVersion: "0.2.0",
          packageName: "@topo/cli",
          packageSpec: "^0.2.0",
          packageManager: "pnpm",
          sourceRoot: "apps/web",
          detection: {},
          files: [],
          createdDirectories: [],
        },
        null,
        2,
      )}\n`,
    );
    const graph = emptyApplicationGraph(path.join(projectRoot, "apps", "web"));

    const context = await loadLlmContext(projectRoot, graph, {
      projectRoot,
      sourceRoot: graph.rootDir,
    });
    expect(context.manifest.project.lifecycle).toMatchObject({
      schemaVersion: 3,
      topoVersion: "0.2.0",
      packageName: "@topo/cli",
      packageSpec: "^0.2.0",
      packageManager: "pnpm",
      sourceRoot: "apps/web",
      sourceFile: ".topo/install.json",
    });
    expect(
      getLlmContextRecord(context, "project", "project:current")?.data
        .lifecycle,
    ).toEqual(context.manifest.project.lifecycle);
    expect(context.manifest.project.lifecycle).not.toHaveProperty("files");

    await fs.writeFile(manifestPath, '{"schemaVersion":2}\n');
    const unsupported = await loadLlmContext(projectRoot, graph, {
      projectRoot,
      sourceRoot: graph.rootDir,
    });
    expect(
      unsupported.records.find(
        (record) =>
          record.kind === "issue" &&
          record.source?.filePath === ".topo/install.json",
      ),
    ).toMatchObject({
      title: "Unreadable source record: .topo/install.json",
      summary: expect.stringContaining("version 3"),
    });
  });
});
