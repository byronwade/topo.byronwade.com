import { describe, expect, it } from "vitest";

import { createPreviewRouteUrl, selectLiveFrames } from "./index.js";

describe("createPreviewRouteUrl", () => {
  it("preserves only the opaque gateway session when resolving a route", () => {
    expect(
      createPreviewRouteUrl(
        "http://127.0.0.1:4180/?topo_session=opaque&debug=1",
        "/customers?tab=active",
      ),
    ).toBe("http://127.0.0.1:4180/customers?tab=active&topo_session=opaque");
  });
});

const candidates = [
  {
    id: "far-live",
    title: "Far live",
    routePath: "/far",
    position: { x: 5_000, y: 0 },
    width: 780,
    height: 688,
    live: true,
  },
  {
    id: "selected",
    title: "Selected",
    routePath: "/selected",
    position: { x: 1_000, y: 0 },
    width: 780,
    height: 688,
    selected: true,
  },
  {
    id: "near-live",
    title: "Near live",
    routePath: "/near",
    position: { x: 1_900, y: 0 },
    width: 780,
    height: 688,
    live: true,
  },
  {
    id: "hovered",
    title: "Hovered",
    routePath: "/hovered",
    position: { x: 0, y: 0 },
    width: 780,
    height: 688,
    hovered: true,
  },
] as const;

describe("selectLiveFrames", () => {
  it("promotes selected, hovered, then nearest live screens through one bounded policy", () => {
    const frames = selectLiveFrames("http://127.0.0.1:3000", candidates, {
      maxFrames: 3,
    });

    expect(frames.map((frame) => frame.id)).toEqual([
      "selected",
      "hovered",
      "near-live",
    ]);
    expect(frames.map((frame) => frame.reason)).toEqual([
      "selected",
      "hover",
      "live",
    ]);
    expect(frames.map((frame) => frame.interactive)).toEqual([
      true,
      true,
      false,
    ]);
    expect(frames[0]).toMatchObject({
      src: "http://127.0.0.1:3000/selected",
      position: { x: 1_000, y: 0 },
      width: 780,
      height: 688,
    });
  });

  it("allows promotion to be disabled without constructing frames", () => {
    expect(
      selectLiveFrames("http://127.0.0.1:3000", candidates, {
        maxFrames: 0,
      }),
    ).toEqual([]);
  });

  it("loads a concrete preview path while retaining canonical route identity", () => {
    const frames = selectLiveFrames(
      "http://127.0.0.1:3000",
      [
        {
          ...candidates[1],
          routePath: "/customers/[customerId]",
          previewPath: "/customers/customer-demo?tab=activity",
        },
      ],
      { maxFrames: 1 },
    );

    expect(frames[0]).toMatchObject({
      routePath: "/customers/[customerId]",
      previewPath: "/customers/customer-demo?tab=activity",
      src: "http://127.0.0.1:3000/customers/customer-demo?tab=activity",
    });
  });
});
