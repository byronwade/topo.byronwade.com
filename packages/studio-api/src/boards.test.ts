import { describe, expect, it } from "vitest";

import { findStudioBoard, studioBoards, studioFrame } from "./boards.js";

describe("Studio board contract", () => {
  it("keeps all 23 approved Paper boards unique and directly addressable", () => {
    expect(studioBoards).toHaveLength(23);
    expect(new Set(studioBoards.map((board) => board.id)).size).toBe(23);
    expect(new Set(studioBoards.map((board) => board.name)).size).toBe(23);
    expect(new Set(studioBoards.map((board) => board.path)).size).toBe(23);
    expect(studioBoards.every((board) => board.path.startsWith("/"))).toBe(
      true,
    );
    expect(Object.isFrozen(studioBoards)).toBe(true);
    expect(studioBoards.every((board) => Object.isFrozen(board))).toBe(true);
    expect(
      studioBoards.filter((board) => board.shell === "immersive"),
    ).toHaveLength(2);
  });

  it("matches boards without coupling them to session query parameters", () => {
    expect(findStudioBoard("/atlas/flows?demo=1")?.id).toBe("atlas-flows");
    expect(
      findStudioBoard("/atlas/flows?demo=1&overlay=command&studio=review")?.id,
    ).toBe("global-command-palette");
    expect(
      findStudioBoard("https://127.0.0.1:4173/settings/light?demo=1")?.id,
    ).toBe("settings-light-theme");
    expect(findStudioBoard("/custom/reports?demo=1")).toBeUndefined();
  });

  it("preserves the exact shared Paper frame", () => {
    expect(studioFrame).toEqual({
      width: 1_440,
      height: 900,
      topbarHeight: 52,
      statusbarHeight: 30,
      leftPaneWidth: 248,
      centerPaneWidth: 928,
      rightPaneWidth: 264,
      canvasTitlebarHeight: 40,
      canvasInsetX: 14,
      canvasInsetTop: 4,
      canvasInsetBottom: 14,
      canvasRadius: 16,
    });
    expect(
      studioFrame.leftPaneWidth +
        studioFrame.centerPaneWidth +
        studioFrame.rightPaneWidth,
    ).toBe(studioFrame.width);
  });

  it("requires real screen evidence for source-backed review boards", () => {
    expect(findStudioBoard("/atlas/components")?.renderer).toBe("pixi-hybrid");
    expect(findStudioBoard("/doctor/findings")?.renderer).toBe("pixi-hybrid");
    expect(findStudioBoard("/notes/detail")?.renderer).toBe("pixi-hybrid");
    expect(findStudioBoard("/doctor")?.renderer).toBeUndefined();
    expect(findStudioBoard("/notes")?.renderer).toBeUndefined();
  });
});
