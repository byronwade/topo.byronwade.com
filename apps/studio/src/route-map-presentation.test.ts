import { describe, expect, it } from "vitest";

import {
  selectRouteMapHeaderLayout,
  selectRouteMapLabelVisibility,
} from "./route-map-presentation";

describe("route map label visibility", () => {
  it("keeps atlas and region views quiet enough to scan", () => {
    expect(selectRouteMapLabelVisibility(0.16)).toEqual({
      sectionMeta: false,
      sectionProvenance: false,
      groupMeta: false,
      groupPath: false,
      routeMeta: false,
      routePath: false,
    });

    expect(selectRouteMapLabelVisibility(0.22)).toEqual({
      sectionMeta: true,
      sectionProvenance: false,
      groupMeta: false,
      groupPath: true,
      routeMeta: false,
      routePath: true,
    });
  });

  it("progressively reveals provenance and counts at useful zoom levels", () => {
    expect(selectRouteMapLabelVisibility(0.32)).toEqual({
      sectionMeta: true,
      sectionProvenance: true,
      groupMeta: true,
      groupPath: true,
      routeMeta: true,
      routePath: true,
    });
  });
});

describe("route map header layout", () => {
  it("keeps region provenance on a dedicated row", () => {
    expect(
      selectRouteMapHeaderLayout({
        kind: "section",
        width: 560,
        titleWidth: 108,
        metaWidth: 220,
        secondaryLeadingWidth: 236,
      }),
    ).toEqual({
      title: { x: 44, y: 18 },
      meta: { x: 530, y: 22, visible: true },
      secondaryLeading: { x: 44, y: 66 },
      secondaryTrailing: undefined,
    });
  });

  it("hides trailing metadata instead of allowing a narrow header collision", () => {
    expect(
      selectRouteMapHeaderLayout({
        kind: "section",
        width: 400,
        titleWidth: 108,
        metaWidth: 220,
        secondaryLeadingWidth: 236,
      }).meta.visible,
    ).toBe(false);
  });

  it("independently protects both rows of an area header", () => {
    expect(
      selectRouteMapHeaderLayout({
        kind: "group",
        width: 520,
        titleWidth: 270,
        metaWidth: 214,
        secondaryLeadingWidth: 312,
        secondaryTrailingWidth: 102,
      }),
    ).toEqual({
      title: { x: 24, y: 7 },
      meta: { x: 492, y: 18, visible: false },
      secondaryLeading: { x: 24, y: 66 },
      secondaryTrailing: { x: 492, y: 72, visible: true },
    });
  });
});
