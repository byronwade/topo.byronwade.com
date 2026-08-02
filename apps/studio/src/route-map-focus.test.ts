import { createAtlasScene } from "@topo/layout";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROUTE_MAP_FOCUS,
  describeSelectedRouteLocation,
  selectRouteMapFocusTarget,
} from "./route-map-focus";
import { fixtureGraph } from "./studio-model";

describe("route map focus", () => {
  const selected = fixtureGraph.screens[0]!;
  const scene = createAtlasScene(fixtureGraph, selected.id);

  it("defaults to a readable selected-region overview", () => {
    expect(DEFAULT_ROUTE_MAP_FOCUS).toBe("region");

    const region = selectRouteMapFocusTarget(scene, DEFAULT_ROUTE_MAP_FOCUS);
    expect(region).toMatchObject({
      alignY: "start",
      label: "Top level",
      maxZoom: 0.48,
      routeCount: 14,
    });
    expect(region.bounds).toEqual(scene.selectedSectionBounds);
  });

  it("keeps area focus available for the selected route group", () => {
    const area = selectRouteMapFocusTarget(scene, "area");

    expect(area).toMatchObject({
      alignY: "center",
      label: "Entry",
      maxZoom: 0.76,
      routeCount: 1,
    });
    expect(area.bounds).toEqual(scene.selectedGroupBounds);
  });

  it("expands deterministically from area to region to the full atlas", () => {
    const area = selectRouteMapFocusTarget(scene, "area");
    const region = selectRouteMapFocusTarget(scene, "region");
    const atlas = selectRouteMapFocusTarget(scene, "atlas");

    expect(region.routeCount).toBeGreaterThan(area.routeCount);
    expect(atlas.routeCount).toBe(scene.routeMap.routes.length);
    expect(atlas.bounds).toEqual(scene.bounds);
    expect(describeSelectedRouteLocation(scene)).toBe("Top level / Entry");
  });
});
