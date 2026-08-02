import { buildLlmContext } from "@topo/llm-context";
import { emptyApplicationGraph } from "@topo/schema";

const GENERATED_AT = "2026-07-31T12:00:00.000Z";

export function createMcpEvaluationContext() {
  const graph = emptyApplicationGraph("C:/topo-evaluation-fixture");
  graph.generatedAt = GENERATED_AT;
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
      tags: ["public"],
    },
    {
      id: "screen:dashboard",
      kind: "screen",
      title: "Dashboard",
      routePath: "/dashboard",
      framework: "next-app",
      state: "default",
      group: "/dashboard",
      source: { filePath: "app/dashboard/page.tsx", line: 1 },
      renderStatus: "captured",
      tags: ["authenticated"],
    },
    {
      id: "screen:dashboard-loading",
      kind: "screen",
      title: "Dashboard loading",
      routePath: "/dashboard",
      framework: "next-app",
      state: "loading",
      group: "/dashboard",
      source: { filePath: "app/dashboard/loading.tsx", line: 1 },
      renderStatus: "unseen",
      tags: ["authenticated"],
    },
    {
      id: "screen:customers",
      kind: "screen",
      title: "Customers",
      routePath: "/dashboard/customers",
      framework: "next-app",
      state: "default",
      group: "/dashboard",
      source: { filePath: "app/dashboard/customers/page.tsx", line: 1 },
      renderStatus: "captured",
      tags: ["authenticated", "customer-management"],
    },
    {
      id: "screen:settings",
      kind: "screen",
      title: "Settings",
      routePath: "/settings",
      framework: "next-app",
      state: "default",
      group: "/settings",
      source: { filePath: "app/settings/page.tsx", line: 1 },
      renderStatus: "unseen",
      tags: ["authenticated"],
    },
  ];
  graph.components = [
    {
      id: "component:status-card",
      kind: "component",
      name: "StatusCard",
      source: { filePath: "components/StatusCard.tsx", line: 3 },
      previewStatus: "renderable",
      previewSources: [
        {
          id: "storybook:components/StatusCard.stories.tsx#Default",
          title: "Default",
          adapterId: "storybook",
          source: {
            filePath: "components/StatusCard.stories.tsx",
            line: 1,
          },
          exportName: "Default",
          locator: "components/StatusCard.stories.tsx#Default",
        },
      ],
      usedBy: ["screen:home", "screen:dashboard", "screen:settings"],
    },
    {
      id: "component:customer-table",
      kind: "component",
      name: "CustomerTable",
      source: { filePath: "components/CustomerTable.tsx", line: 8 },
      previewStatus: "missing",
      previewSources: [],
      usedBy: ["screen:customers"],
    },
  ];
  graph.edges = [
    {
      id: "edge:home-dashboard",
      source: "screen:home",
      target: "screen:dashboard",
      kind: "navigation",
      confidence: 1,
    },
    {
      id: "edge:dashboard-customers",
      source: "screen:dashboard",
      target: "screen:customers",
      kind: "navigation",
      confidence: 0.98,
    },
  ];
  graph.findings = [
    {
      id: "finding:add-customer-inert",
      severity: "medium",
      status: "open",
      title: "Possibly inert Add customer control",
      description:
        "The control produced no recognized effect during an isolated probe.",
      source: { filePath: "app/dashboard/customers/page.tsx", line: 24 },
      evidence: [
        "No URL, network, DOM, focus, storage, or application event change",
      ],
      confidence: 0.86,
    },
    {
      id: "finding:settings-link-resolved",
      severity: "low",
      status: "resolved",
      title: "Settings help link restored",
      description: "The previously empty help destination now resolves.",
      source: { filePath: "app/settings/page.tsx", line: 18 },
      evidence: ["href resolves to /help"],
      confidence: 0.99,
    },
  ];

  return buildLlmContext({
    graph,
    generatedAt: GENERATED_AT,
    project: {
      name: "Topo MCP evaluation fixture",
      profileNames: ["Owner"],
      atlas: {
        version: 1,
        routeGroups: {
          workspace: {
            label: "Workspace",
            order: 10,
            prefixes: ["/dashboard", "/settings"],
          },
        },
        componentGroups: {},
      },
    },
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
    ],
    adapterIssues: [
      {
        filePath: "topo/adapters/malformed/adapter.json",
        message: "Malformed adapter manifest fixture",
      },
    ],
    notes: [
      {
        version: 1,
        id: "note:customer-table-fixture",
        type: "element",
        title: "Customer table fixture needed",
        body: "Add deterministic customer rows before promoting this component preview.",
        targetKind: "component",
        targetId: "component:customer-table",
        targetRoute: "/dashboard/customers",
        status: "resolved",
        author: "byron",
        anchor: {
          status: "drifted",
          source: {
            filePath: "app/dashboard/customers/page.tsx",
            line: 24,
          },
          role: "row",
          accessibleName: "Customer table row",
          testLocator: "customer-table-row",
          domFingerprint: "fixture-row-a91c",
          driftPixels: 12,
          verifiedAt: GENERATED_AT,
        },
        createdAt: GENERATED_AT,
        updatedAt: GENERATED_AT,
      },
    ],
    flows: [
      {
        version: 1,
        id: "flow:create-customer",
        title: "Create customer",
        description: "Move from the dashboard to the customer form.",
        status: "verified",
        entryStepId: "open-dashboard",
        tags: ["critical-path"],
        steps: [
          {
            id: "open-dashboard",
            title: "Open dashboard",
            routePath: "/dashboard",
            screenId: "screen:dashboard",
            action: "Open the dashboard",
            expected: "Dashboard appears",
            noteIds: [],
            nextStepIds: ["open-customers"],
          },
          {
            id: "open-customers",
            title: "Open customers",
            routePath: "/dashboard/customers",
            screenId: "screen:customers",
            action: "Choose Customers",
            expected: "Customer list appears",
            noteIds: ["note:customer-table-fixture"],
            nextStepIds: ["select-add"],
          },
          {
            id: "select-add",
            title: "Select Add customer",
            routePath: "/dashboard/customers",
            screenId: "screen:customers",
            action: "Activate Add customer",
            expected: "Customer form opens",
            noteIds: [],
            nextStepIds: [],
          },
        ],
        createdAt: GENERATED_AT,
        updatedAt: GENERATED_AT,
      },
    ],
    state: {
      version: 1,
      updatedAt: GENERATED_AT,
      graph,
      snapshots: [
        {
          id: "snapshot:dashboard",
          screenId: "screen:dashboard",
          routePath: "/dashboard",
          capturedAt: GENERATED_AT,
          status: "captured",
          contentHash: "sha256:evaluation-dashboard",
          width: 1440,
          height: 900,
        },
      ],
      visualBaselines: [],
      visualComparisons: [],
      previewArtifacts: [
        {
          version: 1,
          id: "component-preview:status-card:default",
          targetKind: "component",
          targetId: "component:status-card",
          previewId: "storybook:components/StatusCard.stories.tsx#Default",
          adapterId: "storybook",
          title: "Default",
          source: {
            filePath: "components/StatusCard.stories.tsx",
            line: 1,
          },
          capturedAt: GENERATED_AT,
          status: "captured",
          artifactPath: ".topo/previews/status-card-default.png",
          contentHash: "a".repeat(64),
          width: 720,
          height: 480,
        },
      ],
      interactionProbes: [
        {
          version: 1,
          id: "interaction-probe:dashboard-delete",
          routePath: "/dashboard",
          screenId: "screen:dashboard",
          control: {
            index: 4,
            id: "control:dashboard-delete",
            label: "Delete customer",
            tagName: "button",
            role: "button",
            locator: 'role=button[name="Delete customer"]',
          },
          status: "skipped",
          effects: [],
          evidence: ["Matched destructive-action safety policy"],
          observedAt: GENERATED_AT,
        },
      ],
      findings: [],
      jobs: [
        {
          id: "job:context-export",
          kind: "export",
          status: "completed",
          createdAt: GENERATED_AT,
          updatedAt: GENERATED_AT,
          progress: 1,
          message: "LLM context exported",
        },
      ],
      jobHistory: {
        terminalLimit: 100,
        retained: 1,
        pruned: 0,
      },
    },
  });
}
