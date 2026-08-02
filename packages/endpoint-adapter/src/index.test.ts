import { describe, expect, it } from "vitest";

import {
  API_ENDPOINT_ADAPTER_VERSION,
  ApiEndpointAdapterContractError,
  createApiEndpointAdapterRegistry,
  defineApiEndpointAdapter,
} from "./index.js";

const context = {
  rootDir: "/project",
  files: [{ filePath: "src/api.ts", extension: ".ts" }],
  packageNames: new Set<string>(),
  readFile: async () => "",
};

describe("API endpoint adapter contract", () => {
  it("aggregates valid endpoint evidence", async () => {
    const adapter = defineApiEndpointAdapter({
      apiVersion: API_ENDPOINT_ADAPTER_VERSION,
      id: "test-api",
      displayName: "Test API",
      scan: () => ({
        endpoints: [{
          protocol: "http" as const,
          method: "GET" as const,
          path: "/api/customers",
          source: { filePath: "src/api.ts", line: 4 },
          discoveryKind: "router-source" as const,
          confidence: 0.95,
        }],
      }),
    });
    const result = await createApiEndpointAdapterRegistry([adapter]).scan(context);
    expect(result.endpoints).toHaveLength(1);
    expect(result.contributions[0]?.adapterId).toBe("test-api");
  });

  it("rejects source paths outside the shared snapshot", async () => {
    const adapter = defineApiEndpointAdapter({
      apiVersion: API_ENDPOINT_ADAPTER_VERSION,
      id: "bad-api",
      displayName: "Bad API",
      scan: () => ({
        endpoints: [{
          protocol: "http" as const,
          method: "GET" as const,
          path: "/hidden",
          source: { filePath: "../hidden.ts" },
          discoveryKind: "router-source" as const,
          confidence: 1,
        }],
      }),
    });
    await expect(createApiEndpointAdapterRegistry([adapter]).scan(context)).rejects.toBeInstanceOf(ApiEndpointAdapterContractError);
  });
});
