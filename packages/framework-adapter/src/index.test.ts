import { describe, expect, it, vi } from "vitest";

import {
  FRAMEWORK_ADAPTER_API_VERSION,
  FrameworkAdapterContractError,
  createFrameworkAdapterRegistry,
  defineFrameworkAdapter,
  type FrameworkAdapterContext,
} from "./index.js";

const context: FrameworkAdapterContext = {
  rootDir: "C:/project",
  files: [{ filePath: "views/home.tsx", extension: ".tsx" }],
  packageNames: new Set(),
  readFile: async () => "export default null",
};

function fixtureAdapter() {
  return defineFrameworkAdapter({
    apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
    id: "acme.router",
    displayName: "Acme Router",
    detect: () => [
      { framework: "acme-router", confidence: 1, reasons: ["fixture"] },
    ],
    scan: () => ({
      routes: [
        {
          framework: "acme-router",
          filePath: "views/home.tsx",
          routePath: "/",
          state: "default",
        },
      ],
    }),
  });
}

describe("framework adapter registry", () => {
  it("runs only matching adapters and returns normalized contributions", async () => {
    const unmatchedScan = vi.fn(() => ({ routes: [] }));
    const unmatched = defineFrameworkAdapter({
      apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
      id: "acme.unmatched",
      displayName: "Unmatched",
      detect: () => [],
      scan: unmatchedScan,
    });

    const result = await createFrameworkAdapterRegistry([
      fixtureAdapter(),
      unmatched,
    ]).scan(context);

    expect(result.frameworks).toEqual(["acme-router"]);
    expect(result.routes).toHaveLength(1);
    expect(unmatchedScan).not.toHaveBeenCalled();
  });

  it("rejects duplicate adapter ids at registration", () => {
    expect(() =>
      createFrameworkAdapterRegistry([fixtureAdapter(), fixtureAdapter()]),
    ).toThrow(FrameworkAdapterContractError);
  });

  it("rejects routes for frameworks not declared during detection", async () => {
    const invalid = defineFrameworkAdapter({
      ...fixtureAdapter(),
      id: "acme.invalid",
      scan: () => ({
        routes: [
          {
            framework: "other-router",
            filePath: "views/home.tsx",
            routePath: "/",
            state: "default",
          },
        ],
      }),
    });

    await expect(
      createFrameworkAdapterRegistry([invalid]).scan(context),
    ).rejects.toThrow(FrameworkAdapterContractError);
  });

  it("rejects reserved aggregate framework ids", async () => {
    const invalid = defineFrameworkAdapter({
      ...fixtureAdapter(),
      id: "acme.reserved",
      detect: () => [
        { framework: "mixed", confidence: 1, reasons: ["invalid fixture"] },
      ],
      scan: () => ({ routes: [] }),
    });

    await expect(
      createFrameworkAdapterRegistry([invalid]).scan(context),
    ).rejects.toThrow(FrameworkAdapterContractError);
  });
});
