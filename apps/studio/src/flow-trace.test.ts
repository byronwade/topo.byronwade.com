import type { ApplicationGraph, Flow } from "@topo/schema";
import { describe, expect, it } from "vitest";
import {
  appendFlowTraceEvents,
  createFlowTraceSession,
  flowTraceToWriteInput,
  resolveFlowTraceRoute,
} from "./flow-trace.js";

const graph: ApplicationGraph = {
  version: 1,
  generatedAt: "2026-08-02T12:00:00.000Z",
  rootDir: "C:/topo-fixture",
  previewBaseUrl: "http://localhost:3000",
  framework: "next-app",
  projectRecognition: {
    version: 1,
    status: "recognized",
    frameworks: [],
    capabilities: [],
    sourceFileCount: 3,
  },
  flowTransitions: [],
  inferredFlows: [],
  screens: [
    {
      id: "screen:jobs",
      kind: "screen",
      title: "Jobs",
      routePath: "/jobs",
      framework: "next-app",
      state: "default",
      group: "Jobs",
      source: { filePath: "app/jobs/page.tsx", line: 1 },
      renderStatus: "live",
      tags: [],
    },
    {
      id: "screen:job",
      kind: "screen",
      title: "Job detail",
      routePath: "/jobs/[jobId]",
      framework: "next-app",
      state: "default",
      group: "Jobs",
      source: { filePath: "app/jobs/[jobId]/page.tsx", line: 1 },
      previewRoute: {
        version: 1,
        status: "configured",
        path: "/jobs/rf-1042",
        source: "topo.config.ts",
      },
      renderStatus: "live",
      tags: [],
    },
    {
      id: "screen:catch-all",
      kind: "screen",
      title: "Knowledge article",
      routePath: "/knowledge/[...slug]",
      framework: "next-app",
      state: "default",
      group: "Knowledge",
      source: { filePath: "app/knowledge/[...slug]/page.tsx", line: 1 },
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

const sourceFlow: Flow = {
  version: 1,
  id: "flow:jobs",
  title: "Dispatch a job",
  description: "",
  status: "verified",
  entryStepId: "open",
  tags: [],
  steps: [
    {
      id: "open",
      title: "Open a job",
      routePath: "/jobs/[jobId]",
      screenId: "screen:job",
      noteIds: [],
      nextStepIds: [],
    },
  ],
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
};

describe("flow trace", () => {
  it("resolves concrete and catch-all preview paths to canonical screens", () => {
    expect(resolveFlowTraceRoute(graph, "/jobs/rf-1042")?.routePath).toBe(
      "/jobs/[jobId]",
    );
    expect(
      resolveFlowTraceRoute(graph, "/knowledge/install/windows")?.routePath,
    ).toBe("/knowledge/[...slug]");
  });

  it("seeds the source flow entry and records only new navigation changes", () => {
    const session = createFlowTraceSession({
      graph,
      sourceFlow,
      now: "2026-08-02T12:00:00.000Z",
      id: "trace-1",
    });
    const traced = appendFlowTraceEvents(
      session,
      [
        {
          type: "topo.navigation",
          timestamp: "2026-08-02T11:59:59.000Z",
          payload: { kind: "load", path: "/ignored" },
        },
        {
          type: "topo.network",
          timestamp: "2026-08-02T12:00:01.000Z",
          payload: { method: "GET", path: "/api/jobs" },
        },
        {
          type: "topo.navigation",
          timestamp: "2026-08-02T12:00:02.000Z",
          payload: { kind: "pushState", path: "/jobs" },
        },
        {
          type: "topo.navigation",
          timestamp: "2026-08-02T12:00:02.000Z",
          payload: { kind: "pushState", path: "/jobs" },
        },
        {
          type: "topo.navigation",
          timestamp: "2026-08-02T12:00:03.000Z",
          payload: { kind: "pushState", path: "/unmapped" },
        },
      ],
      graph,
    );

    expect(traced.routes.map((route) => route.routePath)).toEqual([
      "/jobs/[jobId]",
      "/jobs",
      "/unmapped",
    ]);
    expect(traced.seenEventKeys).toHaveLength(2);
  });

  it("projects a trace into the existing explicit flow contract", () => {
    const session = appendFlowTraceEvents(
      createFlowTraceSession({
        graph,
        selectedScreenId: "screen:jobs",
        now: "2026-08-02T12:00:00.000Z",
        id: "trace-2",
      }),
      [
        {
          type: "topo.navigation",
          timestamp: "2026-08-02T12:00:01.000Z",
          payload: { kind: "pushState", path: "/jobs/rf-1042" },
        },
      ],
      graph,
    );
    const input = flowTraceToWriteInput(session);

    expect(input.tags).toEqual(["recorded", "preview-bridge"]);
    expect(input.entryStepId).toBe("step-1");
    expect(input.steps?.[0]?.nextStepIds).toEqual(["step-2"]);
    expect(input.steps?.[1]).toMatchObject({
      id: "step-2",
      routePath: "/jobs/[jobId]",
      screenId: "screen:job",
      nextStepIds: [],
    });
  });
});
