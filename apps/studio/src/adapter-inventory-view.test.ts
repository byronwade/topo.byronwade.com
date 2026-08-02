import { describe, expect, it } from "vitest";

import type { AdapterInventoryResponse } from "@topo/protocol";

import {
  groupAdapterInventory,
  presentAdapterStatus,
} from "./adapter-inventory-view";

const emptyFlowMembership = {
  transitionCount: 0,
  inferredFlowCount: 0,
  flowTransitionIds: [],
  inferredFlowIds: [],
};

const inventory: AdapterInventoryResponse = {
  schemaVersion: 1,
  adapters: [
    {
      id: "builtin:framework:topo.next",
      adapterId: "topo.next",
      displayName: "Next.js",
      kind: "framework",
      provenance: "built-in",
      status: "active",
      active: true,
      registered: false,
      routeCount: 47,
      previewCount: 0,
      endpointCount: 0,
      ...emptyFlowMembership,
      screenIds: ["screen:home"],
      componentIds: [],
      endpointIds: [],
    },
    {
      id: "scaffold:component-preview:acme.preview",
      adapterId: "acme.preview",
      displayName: "Acme previews",
      kind: "component-preview",
      provenance: "scaffold",
      status: "registered",
      active: false,
      registered: true,
      routeCount: 0,
      previewCount: 0,
      endpointCount: 0,
      ...emptyFlowMembership,
      screenIds: [],
      componentIds: [],
      endpointIds: [],
    },
    {
      id: "builtin:flow-discovery:source-flow",
      adapterId: "source-flow",
      displayName: "Source flow discovery",
      kind: "flow-discovery",
      provenance: "built-in",
      status: "active",
      active: true,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: 0,
      transitionCount: 12,
      inferredFlowCount: 2,
      screenIds: [],
      componentIds: [],
      endpointIds: [],
      flowTransitionIds: ["transition:one"],
      inferredFlowIds: ["inferred-flow:one"],
    },
    {
      id: "builtin:application-runtime:package-script",
      adapterId: "package-script",
      displayName: "Package script",
      kind: "application-runtime",
      provenance: "built-in",
      status: "available",
      active: false,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: 0,
      ...emptyFlowMembership,
      screenIds: [],
      componentIds: [],
      endpointIds: [],
    },
  ],
  issues: [],
  summary: { total: 4, active: 2, registered: 1, declared: 0, issues: 0 },
};

describe("Studio adapter inventory presentation", () => {
  it("groups adapter kinds in a stable product order", () => {
    expect(
      groupAdapterInventory(inventory).map((group) => [
        group.kind,
        group.entries.map((entry) => entry.adapterId),
      ]),
    ).toEqual([
      ["framework", ["topo.next"]],
      ["flow-discovery", ["source-flow"]],
      ["component-preview", ["acme.preview"]],
      ["application-runtime", ["package-script"]],
    ]);
  });

  it("renders evidence-specific status text", () => {
    expect(presentAdapterStatus(inventory.adapters[0]!)).toBe(
      "Active · 47 routes",
    );
    expect(presentAdapterStatus(inventory.adapters[1]!)).toBe("Registered");
    expect(presentAdapterStatus(inventory.adapters[2]!)).toBe(
      "Active · 12 transitions · 2 journeys",
    );
    expect(presentAdapterStatus(inventory.adapters[3]!)).toBe("Available");
  });
});
