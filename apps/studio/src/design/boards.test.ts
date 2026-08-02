import { describe, expect, it } from "vitest";

import { PAPER_BOARD_CONTRACTS } from "./boards";

describe("Paper Studio board contract", () => {
  it("preserves the complete 23-board Paper inventory", () => {
    expect(PAPER_BOARD_CONTRACTS).toHaveLength(23);
    expect(new Set(PAPER_BOARD_CONTRACTS.map((board) => board.name)).size).toBe(
      23,
    );
    expect(
      PAPER_BOARD_CONTRACTS.every((board) =>
        board.name.startsWith(`${board.name.split(" — ")[0]} — `),
      ),
    ).toBe(true);
  });

  it("keeps every board directly addressable", () => {
    expect(
      PAPER_BOARD_CONTRACTS.every((board) => board.path.startsWith("/")),
    ).toBe(true);
    expect(new Set(PAPER_BOARD_CONTRACTS.map((board) => board.path)).size).toBe(
      23,
    );
  });
});
