import { describe, expect, it } from "vitest";

import { discoverSvelteRoutes, svelteFrameworkAdapter } from "./index.js";

describe("Svelte adapter", () => {
  it("maps SvelteKit pages, route groups, parameters, matchers, rest routes, and errors", () => {
    expect(
      discoverSvelteRoutes([
        "src/routes/(app)/+page.svelte",
        "src/routes/(app)/customers/[customerId=uuid]/+page.svelte",
        "src/routes/(app)/docs/[...slug]/+page.svelte",
        "src/routes/(app)/settings/+error.svelte",
        "src/routes/api/health/+server.ts",
      ]),
    ).toEqual([
      {
        filePath: "src/routes/(app)/+page.svelte",
        routePath: "/",
        state: "default",
        source: "sveltekit",
      },
      {
        filePath: "src/routes/(app)/customers/[customerId=uuid]/+page.svelte",
        routePath: "/customers/:customerId",
        state: "default",
        source: "sveltekit",
      },
      {
        filePath: "src/routes/(app)/docs/[...slug]/+page.svelte",
        routePath: "/docs/:slug(.*)*",
        state: "default",
        source: "sveltekit",
      },
      {
        filePath: "src/routes/(app)/settings/+error.svelte",
        routePath: "/settings",
        state: "error",
        source: "sveltekit",
      },
    ]);
  });

  it("uses App.svelte for an ordinary Svelte application", () => {
    expect(discoverSvelteRoutes(["src/App.svelte", "src/main.ts"])).toEqual([
      {
        filePath: "src/App.svelte",
        routePath: "/",
        state: "default",
        source: "spa-entry",
      },
    ]);
  });

  it("detects SvelteKit independently from standalone Svelte", async () => {
    expect(
      svelteFrameworkAdapter.detect({
        rootDir: "C:/project",
        files: [{ filePath: "src/routes/+page.svelte", extension: ".svelte" }],
        packageNames: new Set(["svelte", "@sveltejs/kit"]),
        readFile: async () => "",
      }),
    ).toEqual([expect.objectContaining({ framework: "sveltekit" })]);
  });
});
