import { describe, expect, it } from "vitest";

import {
  FLOW_DISCOVERY_ADAPTER_VERSION,
  FlowDiscoveryAdapterContractError,
  createFlowDiscoveryAdapterRegistry,
  defineFlowDiscoveryAdapter,
} from "./index.js";

const context = {
  rootDir: "/project",
  files: [{ filePath: "src/page.tsx", extension: ".tsx" }],
  packageNames: new Set<string>(),
  screens: [
    {
      screenId: "screen:home",
      routePath: "/",
      sourceFilePaths: ["src/page.tsx"],
    },
  ],
  readFile: async () => "",
};

describe("flow discovery adapter contract", () => {
  it("aggregates source-located transition evidence", async () => {
    const adapter = defineFlowDiscoveryAdapter({
      apiVersion: FLOW_DISCOVERY_ADAPTER_VERSION,
      id: "test-flow",
      displayName: "Test flow",
      scan: () => ({
        transitions: [
          {
            sourceScreenId: "screen:home",
            kind: "navigation" as const,
            target: { kind: "route" as const, routePath: "/customers" },
            action: "Open customers",
            source: { filePath: "src/page.tsx", line: 4 },
            confidence: 0.9,
          },
        ],
      }),
    });
    const result = await createFlowDiscoveryAdapterRegistry([adapter]).scan(
      context,
    );
    expect(result.transitions[0]).toMatchObject({
      adapterId: "test-flow",
      sourceScreenId: "screen:home",
    });
  });

  it("rejects transitions from screens outside the shared snapshot", async () => {
    const adapter = defineFlowDiscoveryAdapter({
      apiVersion: FLOW_DISCOVERY_ADAPTER_VERSION,
      id: "bad-flow",
      displayName: "Bad flow",
      scan: () => ({
        transitions: [
          {
            sourceScreenId: "screen:hidden",
            kind: "navigation" as const,
            target: { kind: "route" as const, routePath: "/hidden" },
            action: "Open hidden",
            source: { filePath: "src/page.tsx" },
            confidence: 1,
          },
        ],
      }),
    });
    await expect(
      createFlowDiscoveryAdapterRegistry([adapter]).scan(context),
    ).rejects.toBeInstanceOf(FlowDiscoveryAdapterContractError);
  });
});
