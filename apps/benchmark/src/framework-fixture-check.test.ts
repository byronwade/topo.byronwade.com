import { describe, expect, it } from "vitest";

import { builtInFrameworkFixtureDefinitions } from "./framework-fixture-check.js";

describe("built-in framework fixture definitions", () => {
  it("keeps every native routing family behind one declarative contract", () => {
    const definitions = builtInFrameworkFixtureDefinitions("C:/topo");

    expect(definitions.map((definition) => definition.id)).toEqual([
      "next-app",
      "next-pages",
      "tanstack-router",
      "tanstack-start",
      "react",
      "vue",
      "nuxt",
      "svelte",
    ]);
    expect(
      definitions.every((definition) => definition.routes.length > 0),
    ).toBe(true);
    expect(
      definitions.every((definition) => definition.flowStepCount === 3),
    ).toBe(true);
  });

  it("declares App Router states separately from concrete browser visits", () => {
    const definition = builtInFrameworkFixtureDefinitions("C:/topo").find(
      (candidate) => candidate.id === "next-app",
    );

    expect(definition?.graphScreens).toEqual([
      { routePath: "/", state: "default" },
      { routePath: "/", state: "not-found" },
      { routePath: "/dashboard", state: "default" },
      { routePath: "/dashboard", state: "loading" },
      { routePath: "/dashboard/customers", state: "default" },
      { routePath: "/settings", state: "default" },
    ]);
    expect(definition?.routes).toHaveLength(5);
  });
});
