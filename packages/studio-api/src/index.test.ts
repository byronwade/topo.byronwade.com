import { describe, expect, it } from "vitest";

import {
  createStudioSearchIndex,
  defineStudio,
  matchStudioRoute,
  parseStudioSelection,
  patchStudioSelectionHref,
  STUDIO_SELECTION_QUERY_KEYS,
  type StudioCommand,
  type StudioDestination,
} from "./index.js";

describe("Studio selection links", () => {
  it("reads bounded stable identities without consuming unrelated query state", () => {
    expect(
      parseStudioSelection(
        "/atlas/flows?demo=1&screen=screen%3Ahome&flow=flow%3Abook&step=step%3Astart&component=component%3Acard&endpoint=api%3Ahttp%3AGET%3A%2Fapi%2Fcustomers&preview=preview%3Aprimary&note=note%3Acopy&finding=finding%3Aroute&probe=interaction-probe%3Awatch-tour",
      ),
    ).toEqual({
      screenId: "screen:home",
      flowId: "flow:book",
      flowStepId: "step:start",
      componentId: "component:card",
      endpointId: "api:http:GET:/api/customers",
      previewId: "preview:primary",
      noteId: "note:copy",
      findingId: "finding:route",
      probeId: "interaction-probe:watch-tour",
    });
    expect(STUDIO_SELECTION_QUERY_KEYS).toEqual([
      "screen",
      "flow",
      "step",
      "component",
      "endpoint",
      "preview",
      "note",
      "finding",
      "probe",
    ]);
  });

  it("patches one identity while preserving session, overlay, and hash state", () => {
    expect(
      patchStudioSelectionHref(
        "/atlas/routes?demo=1&overlay=command&screen=old#selected",
        {
          screenId: "screen:/customers/[id]",
          componentId: "component:CustomerCard",
          previewId: "preview:CustomerCard#Default",
        },
      ),
    ).toBe(
      "/atlas/routes?demo=1&overlay=command&screen=screen%3A%2Fcustomers%2F%5Bid%5D&component=component%3ACustomerCard&preview=preview%3ACustomerCard%23Default#selected",
    );
    expect(
      patchStudioSelectionHref("/notes/detail?note=obsolete&demo=1", {
        noteId: undefined,
      }),
    ).toBe("/notes/detail?demo=1");
  });

  it("drops oversized inbound identities and rejects invalid outbound patches", () => {
    const oversized = "x".repeat(513);
    expect(parseStudioSelection(`/atlas/routes?screen=${oversized}`)).toEqual(
      {},
    );
    expect(() =>
      patchStudioSelectionHref("/atlas/routes", { screenId: " " }),
    ).toThrow("1-512 characters");
  });
});

interface TestDestination extends StudioDestination {
  marker: string;
}

interface TestCommand extends StudioCommand {
  run(): string;
}

const baseStudio = defineStudio<TestDestination, TestCommand>({
  defaultDestination: "atlas",
  destinations: {
    atlas: {
      label: "Atlas",
      description: "Routes, components, and flows",
      path: "/atlas/flows",
      marker: "atlas-view",
    },
    editor: {
      label: "Editor",
      description: "Design workspace",
      path: "/editor/canvas",
      marker: "editor-view",
    },
  },
  commands: {
    capture: {
      label: "Capture screens",
      shortcut: "C",
      run: () => "capture",
    },
  },
});

describe("defineStudio", () => {
  it("adds, replaces, and removes features through one keyed object", () => {
    const customized = defineStudio<TestDestination, TestCommand>({
      extends: baseStudio,
      destinations: {
        editor: false,
        atlas: {
          ...baseStudio.destinations.atlas!,
          label: "Application map",
        },
        reports: {
          label: "Reports",
          description: "Custom local reports",
          path: "/reports",
          marker: "reports-view",
        },
      },
      commands: {
        capture: false,
        greetDeveloper: {
          label: "Say hello",
          run: () => "hello",
        },
      },
    });

    expect(Object.keys(customized.destinations)).toEqual(["atlas", "reports"]);
    expect(customized.destinations.atlas?.label).toBe("Application map");
    expect(customized.destinations.reports?.marker).toBe("reports-view");
    expect(Object.keys(customized.commands)).toEqual(["greetDeveloper"]);
    expect(customized.commands.greetDeveloper?.run()).toBe("hello");
    expect(customized.defaultDestination).toBe("atlas");
  });

  it("removes inherited entries through explicit readable lists", () => {
    const customized = defineStudio<TestDestination, TestCommand>({
      extends: baseStudio,
      remove: {
        destinations: ["editor"],
        commands: ["capture"],
      },
    });

    expect(Object.keys(customized.destinations)).toEqual(["atlas"]);
    expect(Object.keys(customized.commands)).toEqual([]);
  });

  it("falls back to the first remaining destination when the default is removed", () => {
    const customized = defineStudio<TestDestination, TestCommand>({
      extends: baseStudio,
      destinations: { atlas: false },
    });

    expect(customized.defaultDestination).toBe("editor");
    expect(matchStudioRoute(customized, "/missing")).toMatchObject({
      destinationId: "editor",
      view: "canvas",
    });
  });

  it("matches every sub-view from the destination landing path", () => {
    expect(matchStudioRoute(baseStudio, "/atlas/routes?demo=1")).toMatchObject({
      destinationId: "atlas",
      view: "routes",
    });
    expect(matchStudioRoute(baseStudio, "/atlas")).toMatchObject({
      destinationId: "atlas",
      view: "flows",
    });
    expect(matchStudioRoute(baseStudio, "/editor/assets")).toMatchObject({
      destinationId: "editor",
      view: "assets",
    });
  });

  it("rejects ambiguous routes and malformed definitions immediately", () => {
    expect(() =>
      defineStudio({
        destinations: {
          atlas: {
            label: "Atlas",
            description: "One",
            path: "/workspace/atlas",
          },
          editor: {
            label: "Editor",
            description: "Two",
            path: "/workspace/editor",
          },
        },
      }),
    ).toThrow("route root");
    expect(() =>
      defineStudio({
        destinations: {
          "Not valid": {
            label: "Broken",
            description: "Invalid id",
            path: "broken",
          },
        },
      }),
    ).toThrow("destination id");
  });

  it("returns frozen definitions so extensions cannot mutate shared defaults", () => {
    expect(Object.isFrozen(baseStudio)).toBe(true);
    expect(Object.isFrozen(baseStudio.destinations)).toBe(true);
    expect(Object.isFrozen(baseStudio.destinations.atlas)).toBe(true);
    expect(Object.isFrozen(baseStudio.commands)).toBe(true);
  });
});

describe("createStudioSearchIndex", () => {
  const index = createStudioSearchIndex([
    {
      id: "screen:customers",
      kind: "route",
      title: "/customers",
      description: "Customers · default screen",
      text: "app/customers/page.tsx captured",
      target: {
        destinationId: "atlas",
        view: "routes",
        selection: { kind: "screen", id: "screen:customers" },
      },
    },
    {
      id: "screen:customers-detail",
      kind: "route",
      title: "/customers/[id]",
      description: "Customer detail · dynamic route",
      text: "app/customers/[id]/page.tsx",
      target: {
        destinationId: "atlas",
        view: "routes",
        selection: { kind: "screen", id: "screen:customers-detail" },
      },
    },
    {
      id: "note:customer-empty-state",
      kind: "note",
      title: "Clarify customer empty state",
      description: "Open screen note · /customers",
      text: "Explain what happens before the first customer is created.",
      target: {
        destinationId: "notes",
        view: "detail",
        selection: { kind: "note", id: "note:customer-empty-state" },
      },
    },
  ]);

  it("ranks exact and prefix titles ahead of supporting-text matches", () => {
    expect(index.size).toBe(3);
    expect(index.search("customers").map((match) => match.id)).toEqual([
      "screen:customers",
      "screen:customers-detail",
      "note:customer-empty-state",
    ]);
  });

  it("requires every query term and preserves JSON-readable navigation identity", () => {
    expect(index.search("customer dynamic")).toEqual([
      expect.objectContaining({
        id: "screen:customers-detail",
        matchedTerms: ["customer", "dynamic"],
        target: {
          destinationId: "atlas",
          view: "routes",
          selection: { kind: "screen", id: "screen:customers-detail" },
        },
      }),
    ]);
  });

  it("bounds result counts and returns no project records for an empty query", () => {
    expect(index.search("customer", { limit: 1 })).toHaveLength(1);
    expect(index.search("   ")).toEqual([]);
  });

  it("rejects ambiguous stable identities at the module interface", () => {
    expect(() =>
      createStudioSearchIndex([
        {
          id: "same",
          kind: "route",
          title: "One",
          description: "First",
          target: { destinationId: "atlas" },
        },
        {
          id: "same",
          kind: "note",
          title: "Two",
          description: "Second",
          target: { destinationId: "notes" },
        },
      ]),
    ).toThrow("Duplicate Studio search record id");
  });
});
