import { describe, expect, it, vi } from "vitest";

import { createStudioSearchIndex } from "@topo/studio-api";

import {
  fixtureDoctorReport,
  fixtureFlows,
  fixtureGraph,
  fixtureInteractionProbes,
  fixtureNotes,
} from "./studio-model";
import {
  activateStudioSearchResult,
  createStudioProjectSearchRecords,
  type StudioSearchActions,
} from "./studio-search";

describe("Studio project search", () => {
  const records = createStudioProjectSearchRecords({
    graph: fixtureGraph,
    notes: fixtureNotes,
    flows: fixtureFlows,
    interactionProbes: fixtureInteractionProbes,
    doctorReport: fixtureDoctorReport,
  });
  const index = createStudioSearchIndex(records);

  it("projects every searchable concept with a stable nonvisual target", () => {
    expect(new Set(records.map((record) => record.kind))).toEqual(
      new Set([
        "route",
        "component",
        "api-endpoint",
        "flow",
        "flow-step",
        "note",
        "finding",
        "interaction",
        "doctor-check",
      ]),
    );
    expect(new Set(records.map((record) => record.id)).size).toBe(
      records.length,
    );
    expect(
      records.find((record) => record.id === "search:route:fixture:screen:1"),
    ).toMatchObject({
      title: "/customers",
      target: {
        destinationId: "atlas",
        view: "routes",
        selection: { kind: "screen", id: "fixture:screen:1" },
      },
    });
    expect(
      records.find(
        (record) => record.id === "search:finding:fixture:finding:2",
      ),
    ).toMatchObject({
      target: {
        destinationId: "doctor",
        view: "findings",
        selection: { kind: "finding", id: "fixture:finding:2" },
      },
    });
    expect(
      records.find(
        (record) =>
          record.id ===
          "search:interaction:fixture-interaction-probe-watch-tour",
      ),
    ).toMatchObject({
      target: {
        destinationId: "atlas",
        view: "probe",
        selection: {
          kind: "interaction-probe",
          id: "fixture-interaction-probe-watch-tour",
          parentId: "fixture:screen:0",
        },
      },
    });
  });

  it("finds source evidence, note bodies, flow steps, and runtime effects", () => {
    expect(index.search("app customers page")[0]?.kind).toBe("route");
    expect(index.search("book a job billing")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "flow-step" })]),
    );
    expect(index.search("watch the tour")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "interaction" }),
      ]),
    );
    expect(index.search("listCustomers application/json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "api-endpoint",
          target: expect.objectContaining({ view: "apis" }),
        }),
      ]),
    );
  });

  it("activates exact selections before navigating through the normal Studio seam", () => {
    const calls: string[] = [];
    const actions: StudioSearchActions = {
      go: (destination, view) => calls.push(`go:${destination}:${view}`),
      selectScreen: (id) => calls.push(`screen:${id}`),
      selectComponent: (id) => calls.push(`component:${id}`),
      selectApiEndpoint: (id) => calls.push(`api-endpoint:${id}`),
      selectFlow: (id) => calls.push(`flow:${id}`),
      selectFlowStep: (id) => calls.push(`flow-step:${id}`),
      selectNote: (id) => calls.push(`note:${id}`),
      selectFinding: (id) => calls.push(`finding:${id}`),
      selectProbe: (id) => calls.push(`probe:${id}`),
    };
    const flowStep = index
      .search("book a job billing")
      .find((result) => result.kind === "flow-step");
    expect(flowStep).toBeDefined();

    activateStudioSearchResult(flowStep!, actions);

    expect(calls).toEqual([
      `flow:${flowStep!.target.selection?.parentId}`,
      `flow-step:${flowStep!.target.selection?.id}`,
      "go:atlas:flows",
    ]);

    calls.length = 0;
    const finding = index
      .search("unresolved route")
      .find((result) => result.kind === "finding");
    expect(finding).toBeDefined();
    activateStudioSearchResult(finding!, actions);
    expect(calls).toEqual([
      `finding:${finding!.target.selection?.id}`,
      "go:doctor:findings",
    ]);

    calls.length = 0;
    const probe = index
      .search("watch the tour")
      .find((result) => result.kind === "interaction");
    expect(probe).toBeDefined();
    activateStudioSearchResult(probe!, actions);
    expect(calls).toEqual([
      `screen:${probe!.target.selection?.parentId}`,
      `probe:${probe!.target.selection?.id}`,
      "go:atlas:probe",
    ]);
  });

  it("does not require browser or daemon adapters", () => {
    const actions = {
      go: vi.fn(),
      selectScreen: vi.fn(),
      selectComponent: vi.fn(),
      selectApiEndpoint: vi.fn(),
      selectFlow: vi.fn(),
      selectFlowStep: vi.fn(),
      selectNote: vi.fn(),
      selectFinding: vi.fn(),
      selectProbe: vi.fn(),
    };
    const route = index.search("/customers")[0]!;
    activateStudioSearchResult(route, actions);
    expect(actions.selectScreen).toHaveBeenCalledWith("fixture:screen:1");
    expect(actions.go).toHaveBeenCalledWith("atlas", "routes");
  });
});
