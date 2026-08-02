import { describe, expect, it } from "vitest";

import { discoverTanStackRoutes, tanStackFrameworkAdapter } from "./index.js";

describe("TanStack adapter", () => {
  it("recognizes current and legacy Start package names", async () => {
    for (const packageName of ["@tanstack/react-start", "@tanstack/start"]) {
      const matches = await tanStackFrameworkAdapter.detect({
        rootDir: "/fixture",
        files: [],
        packageNames: new Set([packageName]),
        readFile: async () => "",
      });

      expect(matches).toEqual([
        {
          framework: "tanstack-start",
          confidence: 1,
          reasons: [`${packageName} dependency`],
        },
      ]);
    }
  });

  it("prefers authoritative generated full paths over local route paths", () => {
    const generatedTree = `
const JobsJobIdRoute = JobsJobIdRouteImport.update({
  path: '/$jobId',
})
declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': { fullPath: '/' }
    '/jobs': { fullPath: '/jobs' }
    '/jobs/$jobId': { fullPath: '/jobs/$jobId' }
  }
}`;

    expect(
      discoverTanStackRoutes(
        [
          "src/routes/__root.tsx",
          "src/routes/index.tsx",
          "src/routes/jobs.tsx",
          "src/routes/jobs.$jobId.tsx",
          "src/routeTree.gen.ts",
        ],
        generatedTree,
      ),
    ).toEqual([
      {
        filePath: "src/routeTree.gen.ts",
        routePath: "/",
        state: "default",
        source: "generated-tree",
      },
      {
        filePath: "src/routeTree.gen.ts",
        routePath: "/jobs",
        state: "default",
        source: "generated-tree",
      },
      {
        filePath: "src/routeTree.gen.ts",
        routePath: "/jobs/:jobId",
        state: "default",
        source: "generated-tree",
      },
    ]);
  });

  it("falls back to route files without inventing root or pathless-layout screens", () => {
    expect(
      discoverTanStackRoutes([
        "src/routes/__root.tsx",
        "src/routes/index.tsx",
        "src/routes/_authenticated.dashboard.tsx",
        "src/routes/customers.$id.tsx",
        "src/routes/-shared.tsx",
      ]),
    ).toEqual([
      {
        filePath: "src/routes/_authenticated.dashboard.tsx",
        routePath: "/dashboard",
        state: "default",
        source: "file",
      },
      {
        filePath: "src/routes/customers.$id.tsx",
        routePath: "/customers/:id",
        state: "default",
        source: "file",
      },
      {
        filePath: "src/routes/index.tsx",
        routePath: "/",
        state: "default",
        source: "file",
      },
    ]);
  });

  it("does not claim unrelated framework route directories", async () => {
    expect(
      await tanStackFrameworkAdapter.detect({
        rootDir: "/fixture",
        files: [
          { filePath: "src/routes/+page.svelte", extension: ".svelte" },
          { filePath: "src/routes/jobs/+page.svelte", extension: ".svelte" },
        ],
        packageNames: new Set(["@sveltejs/kit"]),
        readFile: async () => "",
      }),
    ).toEqual([]);
  });
});
