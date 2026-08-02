import type { PreviewAnchorInspection } from "@topo/runtime-bridge";
import type { NoteAnchor, ScreenNode, UpdateNoteInput } from "@topo/schema";

export type NotePlacementMode = "point" | "region";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface ArtboardClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type NotePlacementCoordinates = NonNullable<NoteAnchor["coordinates"]>;

const MINIMUM_REGION_SIZE = 0.01;
const COORDINATE_PRECISION = 1_000_000;

function roundUnit(value: number): number {
  return (
    Math.round(Math.min(1, Math.max(0, value)) * COORDINATE_PRECISION) /
    COORDINATE_PRECISION
  );
}

export function normalizeArtboardPoint(
  client: { x: number; y: number },
  rect: ArtboardClientRect,
): NormalizedPoint {
  if (rect.width <= 0 || rect.height <= 0) {
    throw new RangeError("Artboard dimensions must be positive");
  }

  return {
    x: roundUnit((client.x - rect.left) / rect.width),
    y: roundUnit((client.y - rect.top) / rect.height),
  };
}

export function resolveNotePlacement(
  mode: NotePlacementMode,
  start: NormalizedPoint,
  end: NormalizedPoint,
): NotePlacementCoordinates | undefined {
  if (mode === "point") return { x: end.x, y: end.y };

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = roundUnit(Math.abs(end.x - start.x));
  const height = roundUnit(Math.abs(end.y - start.y));

  if (width < MINIMUM_REGION_SIZE || height < MINIMUM_REGION_SIZE) {
    return undefined;
  }

  return { x, y, width, height };
}

export function createPlacedNoteUpdate(
  screen: ScreenNode,
  coordinates: NotePlacementCoordinates,
  verifiedAt: string,
  inspection?: PreviewAnchorInspection,
): UpdateNoteInput {
  return {
    targetKind: "screen",
    targetId: screen.id,
    targetRoute: screen.routePath,
    anchor: {
      status: "attached",
      source: screen.source,
      coordinates,
      verifiedAt,
      ...(inspection ?? {}),
    },
  };
}
