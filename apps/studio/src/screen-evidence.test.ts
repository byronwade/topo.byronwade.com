import { describe, expect, it } from "vitest";

import type { ApplicationGraph } from "@topo/schema";

import {
  selectComponentScreen,
  selectFindingScreen,
  selectNoteScreen,
  selectScreenEvidence,
} from "./screen-evidence";
import type { StudioNote, StudioSnapshot } from "./studio-model";

const graph: ApplicationGraph = {
  version: 1,
  generatedAt: "2026-08-01T05:00:00.000Z",
  rootDir: "C:/fixture",
  previewBaseUrl: "http://127.0.0.1:3000",
  framework: "next-app",
  projectRecognition: {
    version: 1,
    status: "recognized",
    frameworks: [],
    capabilities: [],
    sourceFileCount: 5,
  },
  flowTransitions: [],
  inferredFlows: [],
  screens: [
    {
      id: "screen-home",
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
    {
      id: "screen-jobs",
      kind: "screen",
      title: "Jobs",
      routePath: "/jobs",
      framework: "next-app",
      state: "default",
      group: "/jobs",
      source: { filePath: "app/jobs/page.tsx", line: 1 },
      renderStatus: "captured",
      tags: [],
    },
  ],
  components: [
    {
      id: "component-home-card",
      kind: "component",
      name: "HomeCard",
      source: { filePath: "components/HomeCard.tsx", line: 1 },
      previewStatus: "renderable",
      previewSources: [],
      usedBy: ["screen-home"],
    },
    {
      id: "component-route-card",
      kind: "component",
      name: "RouteCard",
      source: { filePath: "components/RouteCard.tsx", line: 1 },
      previewStatus: "missing",
      previewSources: [],
      usedBy: ["/"],
    },
    {
      id: "component-jobs-card",
      kind: "component",
      name: "JobsCard",
      source: { filePath: "components/JobsCard.tsx", line: 1 },
      previewStatus: "missing",
      previewSources: [],
      usedBy: ["/jobs"],
    },
  ],
  apiEndpoints: [],
  edges: [],
  findings: [
    {
      id: "finding-home",
      severity: "medium",
      status: "open",
      title: "Home finding",
      description: "Source-backed finding",
      source: { filePath: "app/page.tsx", line: 4 },
      evidence: [],
      confidence: 0.9,
    },
    {
      id: "finding-jobs-card",
      severity: "medium",
      status: "open",
      title: "Jobs component finding",
      description: "Component-backed finding",
      source: { filePath: "components/JobsCard.tsx", line: 8 },
      evidence: [],
      confidence: 0.82,
    },
  ],
  sourceIssues: [],
};

const snapshots: StudioSnapshot[] = [
  {
    id: "old-home",
    screenId: "screen-home",
    routePath: "/",
    capturedAt: "2026-08-01T05:01:00.000Z",
    status: "captured",
  },
  {
    id: "new-home",
    screenId: "screen-home",
    routePath: "/",
    capturedAt: "2026-08-01T05:02:00.000Z",
    status: "captured",
  },
];

const notes: StudioNote[] = [
  {
    version: 1,
    id: "note-route",
    type: "screen",
    title: "Route note",
    body: "Review the home route",
    targetRoute: "/",
    status: "open",
    createdAt: "2026-08-01T05:00:00.000Z",
    updatedAt: "2026-08-01T05:00:00.000Z",
  },
  {
    version: 1,
    id: "note-source",
    type: "element",
    title: "Source note",
    body: "Review this source",
    status: "open",
    anchor: {
      status: "attached",
      source: { filePath: "app/page.tsx", line: 4 },
    },
    createdAt: "2026-08-01T05:00:00.000Z",
    updatedAt: "2026-08-01T05:00:00.000Z",
  },
];

describe("selectScreenEvidence", () => {
  it("returns only explicit evidence for the selected screen", () => {
    const evidence = selectScreenEvidence({
      graph,
      notes,
      snapshots,
      selectedScreenId: "screen-home",
    });

    expect(evidence.screen?.id).toBe("screen-home");
    expect(evidence.snapshot?.id).toBe("new-home");
    expect(evidence.components.map((component) => component.id)).toEqual([
      "component-home-card",
      "component-route-card",
    ]);
    expect(evidence.findings.map((finding) => finding.id)).toEqual([
      "finding-home",
    ]);
    expect(evidence.notes.map((note) => note.id)).toEqual([
      "note-route",
      "note-source",
    ]);
  });

  it("falls back to the first screen and returns empty evidence for no graph", () => {
    expect(
      selectScreenEvidence({ graph, notes: [], snapshots: [] }).screen?.id,
    ).toBe("screen-home");
    expect(
      selectScreenEvidence({
        graph: { ...graph, screens: [] },
        notes: [],
        snapshots: [],
      }),
    ).toEqual({ components: [], findings: [], notes: [] });
  });
});

describe("selectFindingScreen", () => {
  it("uses exact screen source identity before the current selection", () => {
    expect(
      selectFindingScreen(graph, graph.findings[0], "screen-jobs")?.id,
    ).toBe("screen-home");
  });

  it("follows an explicit component usedBy relationship", () => {
    expect(
      selectFindingScreen(graph, graph.findings[1], "screen-home")?.id,
    ).toBe("screen-jobs");
  });

  it("retains the selected screen when a finding has no source mapping", () => {
    expect(
      selectFindingScreen(
        graph,
        {
          id: "finding-global",
          severity: "info",
          status: "open",
          title: "Global finding",
          description: "No source location",
          evidence: [],
          confidence: 0.5,
        },
        "screen-jobs",
      )?.id,
    ).toBe("screen-jobs");
  });
});

describe("selectComponentScreen", () => {
  it("retains a preferred screen only when usedBy explicitly references it", () => {
    expect(
      selectComponentScreen(graph, graph.components[1], "screen-home")?.id,
    ).toBe("screen-home");
    expect(
      selectComponentScreen(graph, graph.components[2], "screen-home")?.id,
    ).toBe("screen-jobs");
  });

  it("resolves id, route, and source identities without copy heuristics", () => {
    expect(selectComponentScreen(graph, graph.components[0])?.id).toBe(
      "screen-home",
    );
    expect(selectComponentScreen(graph, graph.components[1])?.id).toBe(
      "screen-home",
    );
    expect(
      selectComponentScreen(graph, {
        ...graph.components[2]!,
        usedBy: ["app/jobs/page.tsx"],
      })?.id,
    ).toBe("screen-jobs");
  });
});

describe("selectNoteScreen", () => {
  it("prefers an exact screen target over other note evidence", () => {
    expect(
      selectNoteScreen(graph, {
        ...notes[0]!,
        targetKind: "screen",
        targetId: "screen-jobs",
        targetRoute: "/",
      })?.id,
    ).toBe("screen-jobs");
  });

  it("resolves canonical route and source-backed note anchors", () => {
    expect(
      selectNoteScreen(graph, {
        ...notes[0]!,
        targetKind: undefined,
        targetId: undefined,
        targetRoute: "/jobs",
        anchor: undefined,
      })?.id,
    ).toBe("screen-jobs");
    expect(
      selectNoteScreen(graph, {
        ...notes[0]!,
        targetKind: undefined,
        targetId: undefined,
        targetRoute: undefined,
        anchor: {
          status: "attached",
          source: { filePath: "app/jobs/page.tsx", line: 9 },
        },
      })?.id,
    ).toBe("screen-jobs");
  });

  it("follows an explicit component target through usedBy", () => {
    expect(
      selectNoteScreen(graph, {
        ...notes[0]!,
        targetKind: "component",
        targetId: "component-jobs-card",
        targetRoute: undefined,
        anchor: undefined,
      })?.id,
    ).toBe("screen-jobs");
  });

  it("keeps an unbound note unbound", () => {
    expect(
      selectNoteScreen(graph, {
        ...notes[0]!,
        type: "canvas",
        targetKind: undefined,
        targetId: undefined,
        targetRoute: undefined,
        anchor: undefined,
      }),
    ).toBeUndefined();
  });
});
