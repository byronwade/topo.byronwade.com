import { createAtlasScene } from "@topo/layout";
import { describe, expect, it } from "vitest";

import { selectRouteMapTextureCandidates } from "./route-map-textures";
import { fixtureGraph, fixtureSnapshots } from "./studio-model";

describe("selectRouteMapTextureCandidates", () => {
  it("maps visible route families to primary-screen snapshots", () => {
    const scene = createAtlasScene(fixtureGraph, fixtureGraph.screens[0]?.id);
    const candidates = selectRouteMapTextureCandidates({
      camera: { x: 40, y: 40, zoom: 0.25 },
      limit: 8,
      scene,
      snapshots: fixtureSnapshots,
      viewport: { width: 1600, height: 900 },
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(8);
    expect(candidates[0]).toMatchObject({
      routeId: "route:/",
      screenId: fixtureGraph.screens[0]?.id,
      snapshotId: fixtureSnapshots[0]?.id,
    });
    expect(candidates.every((candidate) => candidate.imageUrl.length > 0)).toBe(
      true,
    );
  });

  it("skips failed or imageless snapshots", () => {
    const scene = createAtlasScene(fixtureGraph, fixtureGraph.screens[0]?.id);
    expect(
      selectRouteMapTextureCandidates({
        camera: { x: 0, y: 0, zoom: 1 },
        limit: 8,
        scene,
        snapshots: fixtureSnapshots.map((snapshot) => ({
          ...snapshot,
          imageUrl: undefined,
          status: "failed",
        })),
        viewport: { width: 1600, height: 900 },
      }),
    ).toEqual([]);
  });
});
