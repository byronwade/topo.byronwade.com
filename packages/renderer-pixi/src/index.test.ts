import type { Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

import {
  calculateViewportDots,
  calculateViewportGrid,
  createSnapshotTextureCache,
  prioritizeVisibleTextureCandidates,
} from "./index.js";

function fakeTexture(
  width = 10,
  height = 10,
): Texture & {
  destroy: ReturnType<typeof vi.fn>;
} {
  return {
    width,
    height,
    destroy: vi.fn(),
  } as unknown as Texture & { destroy: ReturnType<typeof vi.fn> };
}

describe("calculateViewportGrid", () => {
  it("anchors grid lines to the camera offset", () => {
    const lines = calculateViewportGrid(100, 100, {
      x: 10,
      y: -6,
      zoom: 1,
    });

    expect(
      lines
        .filter((line) => line.axis === "x" && !line.major)
        .map((line) => line.position),
    ).toEqual([10, 42, 74]);
    expect(
      lines
        .filter((line) => line.axis === "y" && !line.major)
        .map((line) => line.position),
    ).toEqual([26, 58, 90]);
  });

  it("coarsens the world grid when zoomed out", () => {
    const lines = calculateViewportGrid(100, 100, { x: 0, y: 0, zoom: 0.2 });
    const xPositions = lines
      .filter((line) => line.axis === "x" && !line.major)
      .map((line) => line.position);

    expect(xPositions).toEqual([0, 25.6, 51.2, 76.80000000000001]);
  });
});

describe("calculateViewportDots", () => {
  it("projects a camera-anchored dotted field with stable major intersections", () => {
    const dots = calculateViewportDots(100, 100, {
      x: 0,
      y: 0,
      zoom: 1,
    });

    expect(dots).toHaveLength(16);
    expect(dots[0]).toEqual({ x: 0, y: 0, major: true });
    expect(dots).toContainEqual({ x: 32, y: 32, major: false });
    expect(dots.filter((dot) => dot.major)).toEqual([
      { x: 0, y: 0, major: true },
    ]);
  });
});

describe("prioritizeVisibleTextureCandidates", () => {
  it("bounds work to visible nodes and promotes the selected artifact first", () => {
    const result = prioritizeVisibleTextureCandidates(
      [
        {
          id: "near",
          x: 40,
          y: 20,
          width: 100,
          height: 80,
          selected: false,
        },
        {
          id: "selected",
          x: 500,
          y: 20,
          width: 100,
          height: 80,
          selected: true,
        },
        {
          id: "far-offscreen",
          x: 5000,
          y: 5000,
          width: 100,
          height: 80,
          selected: false,
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `visible-${index}`,
          x: 160 + index * 80,
          y: 120,
          width: 60,
          height: 60,
          selected: false,
        })),
      ],
      { x: 0, y: 0, zoom: 1 },
      { width: 800, height: 500 },
      4,
    );

    expect(result.map((item) => item.id)).toEqual([
      "selected",
      "visible-3",
      "visible-2",
      "visible-4",
    ]);
    expect(result).toHaveLength(4);
    expect(result.some((item) => item.id === "far-offscreen")).toBe(false);
  });
});

describe("createSnapshotTextureCache", () => {
  it("evicts the least recently used unretained texture", () => {
    const cache = createSnapshotTextureCache({
      maxEntries: 2,
      maxBytes: Number.POSITIVE_INFINITY,
    });
    const first = fakeTexture();
    const second = fakeTexture();
    const third = fakeTexture();

    cache.set("first", first);
    cache.set("second", second);
    expect(cache.get("first")).toBe(first);
    cache.set("third", third);

    expect(cache.has("first")).toBe(true);
    expect(cache.has("second")).toBe(false);
    expect(cache.has("third")).toBe(true);
    expect(second.destroy).toHaveBeenCalledWith(true);
    expect(cache.stats()).toMatchObject({
      entries: 2,
      evictions: 1,
      hits: 1,
      misses: 0,
      overBudget: false,
    });
  });

  it("protects retained viewport textures and reports temporary pressure", () => {
    const cache = createSnapshotTextureCache({
      maxEntries: 1,
      maxBytes: Number.POSITIVE_INFINITY,
    });
    const first = fakeTexture();
    const second = fakeTexture();

    cache.retain(["first", "second"]);
    cache.set("first", first);
    cache.set("second", second);

    expect(cache.stats()).toMatchObject({
      entries: 2,
      retained: 2,
      overBudget: true,
    });
    cache.retain(["second"]);
    expect(cache.has("first")).toBe(false);
    expect(cache.has("second")).toBe(true);
    expect(first.destroy).toHaveBeenCalledWith(true);
    expect(cache.stats()).toMatchObject({
      entries: 1,
      retained: 1,
      evictions: 1,
      overBudget: false,
    });
  });

  it("enforces the estimated GPU byte budget", () => {
    const cache = createSnapshotTextureCache({
      maxEntries: 10,
      maxBytes: 600,
    });
    const first = fakeTexture(10, 10);
    const second = fakeTexture(10, 10);

    cache.set("first", first);
    cache.set("second", second);

    expect(cache.has("first")).toBe(false);
    expect(cache.has("second")).toBe(true);
    expect(cache.stats()).toMatchObject({
      entries: 1,
      bytes: 400,
      evictions: 1,
    });
  });

  it("uses external release hooks and keeps release failures observable", async () => {
    const onReleaseError = vi.fn();
    const cache = createSnapshotTextureCache({ onReleaseError });
    const texture = fakeTexture();
    const release = vi.fn(() => Promise.reject(new Error("unload failed")));

    cache.set("external", texture, { release });
    cache.delete("external");
    await Promise.resolve();

    expect(release).toHaveBeenCalledOnce();
    expect(texture.destroy).not.toHaveBeenCalled();
    expect(onReleaseError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "unload failed" }),
      "external",
    );
    expect(cache.stats().releaseErrors).toBe(1);
  });

  it("releases every owned texture on clear", () => {
    const cache = createSnapshotTextureCache();
    const first = fakeTexture();
    const second = fakeTexture();
    cache.set("first", first);
    cache.set("second", second);

    cache.clear();

    expect(first.destroy).toHaveBeenCalledWith(true);
    expect(second.destroy).toHaveBeenCalledWith(true);
    expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0, retained: 0 });
  });
});
