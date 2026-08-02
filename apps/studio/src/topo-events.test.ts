import { describe, expect, it } from "vitest";

import { emptyApplicationGraph } from "@topo/schema";

import { parseGraphUpdate, parseResourceUpdate } from "./topo-events";

describe("Topo Studio event parsing", () => {
  it("accepts every artifact family that requires a Studio rehydrate", async () => {
    for (const resource of [
      "adapters",
      "notes",
      "flows",
      "snapshots",
      "visuals",
      "component-previews",
      "interaction-probes",
      "doctor",
      "cache",
    ]) {
      expect(
        await parseResourceUpdate(
          JSON.stringify({
            type: "resource.updated",
            resource,
            occurredAt: "2026-08-01T05:00:00.000Z",
          }),
        ),
      ).toBe(resource);
    }
  });

  it("rejects malformed resource and graph events without replacing local state", async () => {
    expect(
      await parseResourceUpdate('{"resource":"snapshots"}'),
    ).toBeUndefined();
    expect(await parseResourceUpdate("not-json")).toBeUndefined();
    expect(await parseGraphUpdate('{"type":"graph.updated"}')).toBeUndefined();

    const graph = emptyApplicationGraph("fixture");
    expect(
      await parseGraphUpdate(JSON.stringify({ type: "graph.updated", graph })),
    ).toEqual(graph);
  });
});
