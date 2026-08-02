import { describe, expect, it } from "vitest";

import { sourceFlowDiscoveryAdapter } from "./index.js";

function context(source: string) {
  return {
    rootDir: "/project",
    files: [{ filePath: "src/Home.tsx", extension: ".tsx" }],
    packageNames: new Set<string>(["react-router-dom"]),
    screens: [
      {
        screenId: "react:/",
        routePath: "/",
        sourceFilePaths: ["src/Home.tsx"],
      },
    ],
    readFile: async () => source,
  };
}

describe("source flow discovery", () => {
  it("recognizes links, router calls, forms, fetch, and axios", async () => {
    const result = await sourceFlowDiscoveryAdapter.scan(
      context(`
        <Link to="/customers">Customers</Link>
        router.push('/jobs')
        redirect("/login")
        <form action="/api/customers" method="post" />
        fetch('/api/jobs', { method: 'PATCH' })
        axios.delete('/api/jobs/42')
      `),
    );
    expect(result.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "navigation", target: { kind: "route", routePath: "/customers" } }),
        expect.objectContaining({ kind: "navigation", target: { kind: "route", routePath: "/jobs" } }),
        expect.objectContaining({ kind: "redirect", target: { kind: "route", routePath: "/login" } }),
        expect.objectContaining({ kind: "submission", target: { kind: "api-endpoint", method: "POST", path: "/api/customers" } }),
        expect.objectContaining({ kind: "request", target: { kind: "api-endpoint", method: "PATCH", path: "/api/jobs" } }),
        expect.objectContaining({ kind: "request", target: { kind: "api-endpoint", method: "DELETE", path: "/api/jobs/42" } }),
      ]),
    );
  });

  it("reports computed navigation without evaluating it", async () => {
    const result = await sourceFlowDiscoveryAdapter.scan(
      context("navigate(destination)"),
    );
    expect(result.transitions).toEqual([]);
    expect(result.issues?.[0]?.message).toContain("Computed navigation target");
  });
});
