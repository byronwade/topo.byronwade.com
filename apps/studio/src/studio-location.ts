import { matchStudioRoute } from "@topo/studio-api";

import type { StudioLocation, StudioOverlay } from "./design/boards";
import type { TopoStudioDefinition } from "./studio-config";

const OVERLAYS = new Set<Exclude<StudioOverlay, undefined>>([
  "navigation",
  "command",
  "annotate",
  "export",
]);

/** Resolves the URL through the composed Studio instead of a route switch. */
export function parseStudioLocation(
  studio: TopoStudioDefinition,
  href = typeof window === "undefined"
    ? studio.destinations[studio.defaultDestination]!.path
    : `${window.location.pathname}${window.location.search}`,
): StudioLocation {
  const origin =
    typeof window === "undefined"
      ? "http://topo.local"
      : window.location.origin;
  const url = new URL(href, origin);
  const welcome = url.pathname === "/welcome";
  const route = matchStudioRoute(
    studio,
    welcome ? studio.destinations[studio.defaultDestination]!.path : url.href,
  );
  const requestedOverlay = url.searchParams.get("overlay") ?? "";
  const overlay = welcome
    ? "welcome"
    : OVERLAYS.has(requestedOverlay as Exclude<StudioOverlay, undefined>)
      ? (requestedOverlay as Exclude<StudioOverlay, undefined>)
      : undefined;
  const canvas = url.searchParams.get("canvas") === "map" ? "map" : undefined;

  return {
    destination: route.destinationId,
    view: route.view,
    overlay,
    ...(canvas ? { canvas } : {}),
  };
}
