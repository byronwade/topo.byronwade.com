import { expect, it } from "vitest";

import { cx, keyboardActivationKeys } from "./index.js";

it("provides accessible class composition helpers", () => { expect(cx("button", false, "active")).toBe("button active"); expect(keyboardActivationKeys).toContain("Enter"); });
