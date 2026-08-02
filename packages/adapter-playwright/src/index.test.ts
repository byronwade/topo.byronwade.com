import { describe, expect, it } from "vitest";

import { capabilities, isDestructiveControl } from "./index.js";

describe("Playwright adapter", () => {
  it("advertises safe capture capabilities", () => {
    expect(capabilities.destructiveActionsSkipped).toBe(true);
    expect(isDestructiveControl("Delete customer")).toBe(true);
  });
});
