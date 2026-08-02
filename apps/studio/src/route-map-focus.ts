import type { CanvasBounds, CanvasFitAlignment } from "@topo/canvas-engine";
import type { AtlasScene } from "@topo/layout";

export type RouteMapFocus = "area" | "region" | "atlas";

export const DEFAULT_ROUTE_MAP_FOCUS: RouteMapFocus = "region";

export interface RouteMapFocusTarget {
  alignY: CanvasFitAlignment;
  bounds: CanvasBounds;
  label: string;
  maxZoom: number;
  padding: number;
  routeCount: number;
}

/**
 * Resolve the semantic route-map focus without leaking renderer state into the
 * canonical graph. Region is the default Studio framing: it establishes the
 * selected route's surrounding application territory while keeping previews
 * readable. Area and whole-atlas framing remain explicit progressive views.
 */
export function selectRouteMapFocusTarget(
  scene: AtlasScene,
  focus: RouteMapFocus,
): RouteMapFocusTarget {
  const selectedGroup = scene.routeMap.groups.find((group) =>
    group.screenIds.includes(scene.selectedScreenId ?? ""),
  );
  const selectedSection = scene.routeMap.sections.find((section) =>
    section.screenIds.includes(scene.selectedScreenId ?? ""),
  );

  if (focus === "area") {
    return {
      alignY: "center",
      bounds: scene.selectedGroupBounds,
      label: selectedGroup?.label ?? "Selected area",
      maxZoom: 0.76,
      padding: 56,
      routeCount: selectedGroup?.routeCount ?? 0,
    };
  }

  if (focus === "region") {
    return {
      alignY: "start",
      bounds: scene.selectedSectionBounds,
      label: selectedSection?.label ?? "Selected region",
      maxZoom: 0.48,
      padding: 48,
      routeCount: selectedSection?.routeCount ?? 0,
    };
  }

  return {
    alignY: "center",
    bounds: scene.bounds,
    label: "Application atlas",
    maxZoom: 0.34,
    padding: 40,
    routeCount: scene.routeMap.routes.length,
  };
}

export function describeSelectedRouteLocation(scene: AtlasScene): string {
  const selectedGroup = scene.routeMap.groups.find((group) =>
    group.screenIds.includes(scene.selectedScreenId ?? ""),
  );
  const selectedSection = scene.routeMap.sections.find((section) =>
    section.screenIds.includes(scene.selectedScreenId ?? ""),
  );

  return [selectedSection?.label, selectedGroup?.label]
    .filter((label): label is string => Boolean(label))
    .join(" / ");
}
