import { describe, expect, it } from "vitest";

import { findRouteLinks } from "./index.js";

describe("resolver", () => {
  it("finds literal route links with source lines", () => {
    expect(findRouteLinks("<Link href='/dashboard'>Dashboard</Link>", "app/page.tsx")).toEqual([{ sourceFile: "app/page.tsx", href: "/dashboard", line: 1 }]);
  });
});
