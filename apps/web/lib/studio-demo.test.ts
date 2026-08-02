import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { buildStudioDemoUrl } from "./studio-demo";

describe("Studio demo handoff", () => {
  it("opens the generated same-origin Studio demo by default", () => {
    expect(buildStudioDemoUrl()).toBe(
      "/demo-studio/welcome?demo=1&source=website",
    );
  });

  it("normalizes a configured deployment to the canonical welcome view", () => {
    expect(buildStudioDemoUrl("https://demo.topo.example/old?stale=1")).toBe(
      "https://demo.topo.example/welcome?demo=1&source=website",
    );
  });

  it("rejects unsupported redirect protocols", () => {
    expect(() => buildStudioDemoUrl("javascript:alert(1)")).toThrow(
      "must use http or https",
    );
  });

  it("rewrites every public Studio deep link to the generated entry", async () => {
    expect(nextConfig.rewrites).toBeTypeOf("function");
    const rewrites = await nextConfig.rewrites!();
    expect(rewrites).toEqual([
      { source: "/demo-studio", destination: "/_topo-studio/index.html" },
      {
        source: "/demo-studio/:path*",
        destination: "/_topo-studio/index.html",
      },
    ]);
  });
});
