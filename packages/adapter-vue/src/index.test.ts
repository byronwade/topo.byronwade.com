import { describe, expect, it } from "vitest";

import type { FrameworkAdapterContext } from "@topo/framework-adapter";

import { discoverVueRoutes, vueFrameworkAdapter } from "./index.js";

function context(
  sources: Record<string, string>,
  packages = ["vue", "vue-router"],
): FrameworkAdapterContext {
  return {
    rootDir: "C:/project",
    files: Object.keys(sources).map((filePath) => ({
      filePath,
      extension: filePath.slice(filePath.lastIndexOf(".")),
    })),
    packageNames: new Set(packages),
    readFile: async (filePath) => sources[filePath] ?? "",
  };
}

describe("Vue adapter", () => {
  it("discovers static absolute Vue Router paths", async () => {
    const fixture = context({
      "src/router.ts": `
        const routes = [
          { path: '/', component: Home },
          { path: '/customers/:customerId', component: Customer },
          { path: 'relative-child', component: Child },
        ];
        createRouter({ history: createWebHistory(), routes });
      `,
    });
    await expect(discoverVueRoutes(fixture)).resolves.toEqual([
      { filePath: "src/router.ts", routePath: "/", source: "vue-router" },
      {
        filePath: "src/router.ts",
        routePath: "/customers/:customerId",
        source: "vue-router",
      },
    ]);
    await expect(vueFrameworkAdapter.detect(fixture)).resolves.toEqual([
      expect.objectContaining({ framework: "vue-router" }),
    ]);
  });

  it("uses App.vue for a routerless Vue app", async () => {
    const fixture = context({ "src/App.vue": "<template>Home</template>" }, [
      "vue",
    ]);
    await expect(discoverVueRoutes(fixture)).resolves.toEqual([
      { filePath: "src/App.vue", routePath: "/", source: "spa-entry" },
    ]);
  });

  it("defers Nuxt workspaces to the Nuxt adapter", async () => {
    const fixture = context({ "app.vue": "<NuxtPage />" }, ["vue", "nuxt"]);
    await expect(vueFrameworkAdapter.detect(fixture)).resolves.toEqual([]);
  });
});
