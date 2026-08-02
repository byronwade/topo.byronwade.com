import { describe, expect, it } from "vitest";

import type { FrameworkAdapterContext } from "@topo/framework-adapter";

import { discoverReactRoutes, reactFrameworkAdapter } from "./index.js";

function context(
  sources: Record<string, string>,
  packages = ["react", "react-router-dom"],
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

describe("React adapter", () => {
  it("discovers only source-grounded absolute React Router paths", async () => {
    const fixture = context({
      "src/App.tsx": `
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/customers/:customerId" element={<Customer />} />
          <Route path="relative-child" element={<UnsafeGuess />} />
        </Routes>
      `,
    });

    await expect(discoverReactRoutes(fixture)).resolves.toEqual([
      { filePath: "src/App.tsx", routePath: "/", source: "react-router" },
      {
        filePath: "src/App.tsx",
        routePath: "/customers/:customerId",
        source: "react-router",
      },
    ]);
    await expect(reactFrameworkAdapter.detect(fixture)).resolves.toEqual([
      expect.objectContaining({ framework: "react-router", confidence: 1 }),
    ]);
  });

  it("uses the concrete application entry for a routerless React app", async () => {
    const fixture = context(
      { "src/main.tsx": "createRoot(document.body).render(<App />)" },
      ["react"],
    );
    await expect(discoverReactRoutes(fixture)).resolves.toEqual([
      { filePath: "src/main.tsx", routePath: "/", source: "spa-entry" },
    ]);
  });

  it("does not compete with specialized React frameworks", async () => {
    const fixture = context({ "src/main.tsx": "" }, ["react", "next"]);
    await expect(reactFrameworkAdapter.detect(fixture)).resolves.toEqual([]);
  });
});
