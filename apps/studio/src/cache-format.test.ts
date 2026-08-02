import { describe, expect, it } from "vitest";

import { formatCacheBytes } from "./components/SettingsWorkspace";

describe("formatCacheBytes", () => {
  it("keeps cache status compact across byte scales", () => {
    expect(formatCacheBytes(0)).toBe("0 B");
    expect(formatCacheBytes(1_536)).toBe("1.5 KB");
    expect(formatCacheBytes(12 * 1_024 * 1_024)).toBe("12 MB");
  });
});
