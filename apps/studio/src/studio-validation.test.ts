import { describe, expect, it } from "vitest";

import { emptyApplicationGraph } from "@topo/schema";

import {
  parseApplicationGraph,
  parseComponentPreviewScaffoldResponse,
  parseComponentPreviewsResponse,
  parseFlowRecord,
  parseFlowsResponse,
  parseInteractionProbesResponse,
  parseNoteRecord,
  parseNotesResponse,
  parseProjectSettings,
  parseSnapshotsResponse,
} from "./studio-validation";

describe("Studio daemon validation boundary", () => {
  const timestamp = "2026-08-01T02:00:00.000Z";

  it("accepts only canonical graph and collection envelopes", () => {
    const graph = emptyApplicationGraph("C:/work/topo");
    expect(parseApplicationGraph(graph)).toMatchObject({
      version: 1,
      screens: [],
      components: [],
    });
    expect(
      parseNotesResponse({ schemaVersion: 1, notes: [], issues: [] }).notes,
    ).toEqual([]);
    expect(
      parseFlowsResponse({ schemaVersion: 1, flows: [], issues: [] }).flows,
    ).toEqual([]);
    expect(
      parseSnapshotsResponse({ schemaVersion: 1, snapshots: [] }).snapshots,
    ).toEqual([]);
    expect(
      parseComponentPreviewsResponse({
        schemaVersion: 1,
        previewArtifacts: [],
      }).previewArtifacts,
    ).toEqual([]);
    expect(
      parseInteractionProbesResponse({
        schemaVersion: 1,
        interactionProbes: [],
      }).interactionProbes,
    ).toEqual([]);
    expect(
      parseComponentPreviewScaffoldResponse({
        schemaVersion: 1,
        result: {
          schemaVersion: 1,
          componentId: "component:src/Card.tsx",
          componentName: "Card",
          componentSource: "src/Card.tsx",
          previewSource: "src/Card.topo.tsx",
          exportName: "Card",
          exportKind: "function",
          requiredProps: 1,
          mode: "fixture-required",
          canApply: true,
          sourceHash: "a".repeat(64),
          templateHash: "b".repeat(64),
          bytes: 240,
          conflicts: [],
          status: "created",
          createdAt: timestamp,
        },
        graph,
      }).result.previewSource,
    ).toBe("src/Card.topo.tsx");
    expect(
      parseProjectSettings({
        schemaVersion: 1,
        name: "@acme/web",
        projectRoot: "C:/work/acme",
        sourceRoot: "C:/work/acme/apps/web",
        configPath: "C:/work/acme/topo.config.ts",
        capture: {
          version: 1,
          autoCapture: true,
          headless: true,
          viewport: { width: 1440, height: 1000 },
        },
      }).name,
    ).toBe("@acme/web");
  });

  it("rejects malformed hydration and mutation records before state updates", () => {
    expect(() =>
      parseApplicationGraph({
        ...emptyApplicationGraph("C:/work/topo"),
        generatedAt: "not-a-date",
      }),
    ).toThrow();
    expect(() =>
      parseNotesResponse({ schemaVersion: 1, notes: [{}], issues: [] }),
    ).toThrow();
    expect(() =>
      parseFlowsResponse({ schemaVersion: 1, flows: [{}], issues: [] }),
    ).toThrow();
    expect(() =>
      parseSnapshotsResponse({
        schemaVersion: 1,
        snapshots: [{ id: "partial" }],
      }),
    ).toThrow();
    expect(() =>
      parseComponentPreviewsResponse({
        schemaVersion: 1,
        previewArtifacts: [{ id: "partial" }],
      }),
    ).toThrow();
    expect(() =>
      parseInteractionProbesResponse({
        schemaVersion: 1,
        interactionProbes: [{ id: "partial" }],
      }),
    ).toThrow();
    expect(() =>
      parseComponentPreviewScaffoldResponse({
        schemaVersion: 1,
        result: { status: "created" },
        graph: emptyApplicationGraph("C:/work/topo"),
      }),
    ).toThrow();
    expect(() =>
      parseProjectSettings({
        schemaVersion: 1,
        name: "partial",
        capture: {},
      }),
    ).toThrow();
    expect(() => parseNoteRecord({ id: "partial" })).toThrow();
    expect(() =>
      parseFlowRecord({
        version: 1,
        id: "flow",
        title: "Flow",
        entryStepId: "missing",
        steps: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toThrow(/does not exist/);
  });
});
