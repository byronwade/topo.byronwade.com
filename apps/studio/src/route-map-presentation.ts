export interface RouteMapLabelVisibility {
  sectionMeta: boolean;
  sectionProvenance: boolean;
  groupMeta: boolean;
  groupPath: boolean;
  routeMeta: boolean;
  routePath: boolean;
}

export interface RouteMapHeaderLayoutInput {
  kind: "section" | "group";
  width: number;
  titleWidth: number;
  metaWidth: number;
  secondaryLeadingWidth: number;
  secondaryTrailingWidth?: number;
}

export interface RouteMapHeaderLayout {
  title: { x: number; y: number };
  meta: { x: number; y: number; visible: boolean };
  secondaryLeading: { x: number; y: number };
  secondaryTrailing?: { x: number; y: number; visible: boolean };
}

function trailingLabelFits(
  width: number,
  leadingX: number,
  leadingWidth: number,
  trailingRight: number,
  trailingWidth: number,
  minimumGap: number,
): boolean {
  return (
    leadingX + leadingWidth + minimumGap <=
    width - trailingRight - trailingWidth
  );
}

/**
 * Lay out the two textual rows in route-map region and area headers.
 *
 * Pixi measures text at runtime, so collision handling belongs in this small
 * renderer-neutral function rather than in adapter data or hard-coded label
 * truncation. Leading identity always wins; trailing metadata disappears when
 * the measured row is too narrow.
 */
export function selectRouteMapHeaderLayout(
  input: RouteMapHeaderLayoutInput,
): RouteMapHeaderLayout {
  const section = input.kind === "section";
  const leadingX = section ? 44 : 24;
  const trailingRight = section ? 30 : 28;
  const minimumGap = section ? 32 : 24;
  const metaVisible = trailingLabelFits(
    input.width,
    leadingX,
    input.titleWidth,
    trailingRight,
    input.metaWidth,
    minimumGap,
  );

  const secondaryTrailing =
    !section && input.secondaryTrailingWidth !== undefined
      ? {
          x: input.width - trailingRight,
          y: 72,
          visible: trailingLabelFits(
            input.width,
            leadingX,
            input.secondaryLeadingWidth,
            trailingRight,
            input.secondaryTrailingWidth,
            minimumGap,
          ),
        }
      : undefined;

  return {
    title: { x: leadingX, y: section ? 18 : 7 },
    meta: {
      x: input.width - trailingRight,
      y: section ? 22 : 18,
      visible: metaVisible,
    },
    secondaryLeading: { x: leadingX, y: 66 },
    secondaryTrailing,
  };
}

/**
 * Keep the route atlas readable as one semantic zoom surface. Titles remain
 * available at every level while paths, provenance, and counts progressively
 * appear only when the camera can give them enough room.
 */
export function selectRouteMapLabelVisibility(
  zoom: number,
): RouteMapLabelVisibility {
  return {
    sectionMeta: zoom >= 0.18,
    sectionProvenance: zoom >= 0.3,
    groupMeta: zoom >= 0.3,
    groupPath: zoom >= 0.2,
    routeMeta: zoom >= 0.3,
    routePath: zoom >= 0.2,
  };
}
