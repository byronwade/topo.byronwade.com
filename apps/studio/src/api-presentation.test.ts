import { describe, expect, it } from "vitest";

import { fixtureGraph } from "./studio-model";
import {
  apiEndpointGroup,
  apiEndpointOrigin,
  apiEndpointOriginLabel,
  describeApiEndpointUsage,
} from "./api-presentation";

describe("API atlas presentation", () => {
  it("keeps endpoint usage derived from source transitions and inferred journeys", () => {
    const endpoint = fixtureGraph.apiEndpoints.find(
      (candidate) => candidate.id === "api:http:GET:/api/customers",
    );
    expect(endpoint).toBeDefined();

    const usage = describeApiEndpointUsage(endpoint!, fixtureGraph);

    expect(usage.transitions).toHaveLength(1);
    expect(usage.sourceScreens[0]?.routePath).toBe("/customers");
    expect(usage.inferredFlows[0]?.title).toContain("inferred journey");
  });

  it("labels source, contract, and mixed evidence without changing graph data", () => {
    const source = fixtureGraph.apiEndpoints.find(
      (candidate) => candidate.id === "api:http:GET:/api/customers",
    )!;
    const sourceOnly = {
      discoveries: source.discoveries.filter(
        (discovery) => discovery.kind !== "openapi",
      ),
    };
    expect(apiEndpointOrigin(sourceOnly)).toBe("source");
    expect(apiEndpointOriginLabel(apiEndpointOrigin(sourceOnly))).toBe(
      "Source-backed",
    );

    const contractDiscovery = {
      adapterId: "openapi",
      kind: "openapi" as const,
      source: { filePath: "openapi.yaml" },
      confidence: 1,
    };
    const contract = { discoveries: [contractDiscovery] };
    expect(apiEndpointOrigin(contract)).toBe("contract");
    expect(
      apiEndpointOrigin({
        discoveries: [
          contractDiscovery,
          {
            adapterId: "next",
            kind: "framework-source" as const,
            source: { filePath: "app/api/customers/route.ts" },
            confidence: 0.9,
          },
        ],
      }),
    ).toBe("mixed");
  });

  it("organizes nested API domains into readable canvas groups", () => {
    expect(apiEndpointGroup({ path: "/api/dispatch/board" })).toBe(
      "api/dispatch",
    );
    expect(apiEndpointGroup({ path: "/health" })).toBe("health");
    expect(apiEndpointGroup({ path: "/" })).toBe("root");
  });
});
