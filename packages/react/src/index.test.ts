import { describe, expect, it } from "vitest";

import { shouldStartCanvasPan } from "./index.js";

describe("shouldStartCanvasPan", () => {
  it("reserves primary mouse and pen drags for selection in select mode", () => {
    expect(shouldStartCanvasPan("select", "mouse", 0)).toBe(false);
    expect(shouldStartCanvasPan("select", "pen", 0)).toBe(false);
  });

  it("supports explicit pan mode, middle mouse panning, and touch gestures", () => {
    expect(shouldStartCanvasPan("pan", "mouse", 0)).toBe(true);
    expect(shouldStartCanvasPan("select", "mouse", 1)).toBe(true);
    expect(shouldStartCanvasPan("select", "touch", 0)).toBe(true);
  });

  it("rejects unsupported mouse buttons", () => {
    expect(shouldStartCanvasPan("pan", "mouse", 2)).toBe(false);
  });
});
