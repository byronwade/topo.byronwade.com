import { describe, expect, it } from "vitest";

import { discoverNuxtRoutes, nuxtFrameworkAdapter } from "./index.js";

describe("Nuxt adapter", () => {
  it("maps pages, route groups, dynamic segments, modes, and error state", () => {
    expect(
      discoverNuxtRoutes([
        "app/app.vue",
        "app/error.vue",
        "app/pages/(marketing)/index.vue",
        "app/pages/customers/[customerId].vue",
        "app/pages/docs/[...slug].vue",
        "app/pages/reports/[[year]].client.vue",
        "app/pages/-draft.vue",
      ]),
    ).toEqual([
      {
        filePath: "app/pages/(marketing)/index.vue",
        routePath: "/",
        state: "default",
        source: "pages",
      },
      {
        filePath: "app/error.vue",
        routePath: "/",
        state: "error",
        source: "error-boundary",
      },
      {
        filePath: "app/pages/customers/[customerId].vue",
        routePath: "/customers/:customerId",
        state: "default",
        source: "pages",
      },
      {
        filePath: "app/pages/docs/[...slug].vue",
        routePath: "/docs/:slug(.*)*",
        state: "default",
        source: "pages",
      },
      {
        filePath: "app/pages/reports/[[year]].client.vue",
        routePath: "/reports/:year?",
        state: "default",
        source: "pages",
      },
    ]);
  });

  it("uses app.vue when the optional pages system is absent", () => {
    expect(discoverNuxtRoutes(["app.vue"])).toEqual([
      {
        filePath: "app.vue",
        routePath: "/",
        state: "default",
        source: "app-entry",
      },
    ]);
  });

  it("detects a Nuxt package without executing its configuration", async () => {
    expect(
      nuxtFrameworkAdapter.detect({
        rootDir: "C:/project",
        files: [{ filePath: "pages/index.vue", extension: ".vue" }],
        packageNames: new Set(["nuxt", "vue"]),
        readFile: async () => "",
      }),
    ).toEqual([expect.objectContaining({ framework: "nuxt", confidence: 1 })]);
  });

  it("does not claim another framework merely because it has pages", async () => {
    expect(
      await nuxtFrameworkAdapter.detect({
        rootDir: "C:/project",
        files: [{ filePath: "pages/index.tsx", extension: ".tsx" }],
        packageNames: new Set(["next", "react"]),
        readFile: async () => "",
      }),
    ).toEqual([]);
  });
});
