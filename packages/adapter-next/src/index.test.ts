import { describe, expect, it } from "vitest";

import { discoverNextRoutes } from "./index.js";

describe("Next adapter", () => {
  it("maps App Router states and ignores layouts and route groups", () => {
    expect(discoverNextRoutes([
      "app/(marketing)/page.tsx",
      "app/(marketing)/pricing/page.tsx",
      "app/layout.tsx",
      "app/dashboard/loading.tsx",
      "app/dashboard/page.tsx",
    ])).toEqual([
      { filePath: "app/(marketing)/page.tsx", routePath: "/", state: "default", router: "app" },
      { filePath: "app/(marketing)/pricing/page.tsx", routePath: "/pricing", state: "default", router: "app" },
      { filePath: "app/dashboard/loading.tsx", routePath: "/dashboard", state: "loading", router: "app" },
      { filePath: "app/dashboard/page.tsx", routePath: "/dashboard", state: "default", router: "app" },
    ]);
  });

  it("maps Pages Router index and 404 files", () => {
    expect(discoverNextRoutes(["pages/index.tsx", "pages/customers/[id].tsx", "pages/404.tsx", "pages/api/health.ts"])).toEqual([
      { filePath: "pages/404.tsx", routePath: "/404", state: "not-found", router: "pages" },
      { filePath: "pages/customers/[id].tsx", routePath: "/customers/[id]", state: "default", router: "pages" },
      { filePath: "pages/index.tsx", routePath: "/", state: "default", router: "pages" },
    ]);
  });
});
