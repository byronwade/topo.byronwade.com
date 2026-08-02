import { createAtlasScene } from "@topo/layout";
import { describe, expect, it } from "vitest";

import { createAtlasLiveFrames } from "./live-frames";
import { fixtureGraph } from "./studio-model";

describe("createAtlasLiveFrames", () => {
  it("promotes a captured selection, hover target, and nearby live routes up to the configured cap", () => {
    const selected = fixtureGraph.screens[5]!;
    const hovered = fixtureGraph.screens[8]!;
    const scene = createAtlasScene(fixtureGraph, selected.id);

    const frames = createAtlasLiveFrames({
      baseUrl: fixtureGraph.previewBaseUrl,
      connected: true,
      graph: fixtureGraph,
      hoveredScreenId: hovered.id,
      maxFrames: 4,
      promoteOnHover: true,
      scene,
      selectedScreenId: selected.id,
    });

    expect(frames).toHaveLength(4);
    expect(frames[0]).toMatchObject({
      id: selected.id,
      reason: "selected",
      interactive: true,
    });
    expect(frames[1]).toMatchObject({
      id: hovered.id,
      reason: "hover",
      interactive: true,
    });
    expect(frames.slice(2).every((frame) => frame.reason === "live")).toBe(
      true,
    );
  });

  it("never constructs application frames for a disconnected demo", () => {
    expect(
      createAtlasLiveFrames({
        baseUrl: fixtureGraph.previewBaseUrl,
        connected: false,
        graph: fixtureGraph,
        maxFrames: 4,
        promoteOnHover: true,
        scene: createAtlasScene(fixtureGraph),
        selectedScreenId: fixtureGraph.screens[0]?.id,
      }),
    ).toEqual([]);
  });

  it("skips unresolved routes and uses configured preview examples", () => {
    const selected = fixtureGraph.screens[0]!;
    const graph = {
      ...fixtureGraph,
      screens: fixtureGraph.screens.map((screen) =>
        screen.id === selected.id
          ? {
              ...screen,
              routePath: "/customers/[customerId]",
              previewRoute: {
                version: 1 as const,
                status: "configured" as const,
                path: "/customers/customer-demo",
                source: "topo.config.ts" as const,
              },
            }
          : screen,
      ),
    };
    const scene = createAtlasScene(graph, selected.id);
    const frames = createAtlasLiveFrames({
      baseUrl: graph.previewBaseUrl,
      connected: true,
      graph,
      maxFrames: 1,
      promoteOnHover: false,
      scene,
      selectedScreenId: selected.id,
    });

    expect(frames[0]).toMatchObject({
      routePath: "/customers/[customerId]",
      previewPath: "/customers/customer-demo",
      src: expect.stringContaining("/customers/customer-demo"),
    });

    const unresolved = {
      ...graph,
      screens: graph.screens.map((screen) =>
        screen.id === selected.id
          ? {
              ...screen,
              previewRoute: {
                version: 1 as const,
                status: "unresolved" as const,
                reason: "Missing example",
              },
            }
          : screen,
      ),
    };
    const unresolvedFrames = createAtlasLiveFrames({
        baseUrl: unresolved.previewBaseUrl,
        connected: true,
        graph: unresolved,
        maxFrames: 1,
        promoteOnHover: false,
        scene: createAtlasScene(unresolved, selected.id),
        selectedScreenId: selected.id,
      });
    expect(
      unresolvedFrames.some((frame) => frame.id === selected.id),
    ).toBe(false);
  });
});
