import { describe, expect, it } from "vitest";

import { fixtureGraph } from "./studio-model";
import {
  canPersistStudioChanges,
  createInitialTopoDataState,
  resolveTopoDataMode,
} from "./useTopoData";

describe("Studio data authority", () => {
  it("loads Fieldbase fixtures only for the explicit demo mode", () => {
    const demo = createInitialTopoDataState(true);

    expect(demo.graph).toBe(fixtureGraph);
    expect(demo.projectSettings).toMatchObject({
      name: "fieldbase-web",
      capture: {
        autoCapture: true,
        viewport: { width: 1440, height: 1024 },
      },
    });
    expect(demo.graph.screens).toHaveLength(47);
    expect(demo.notes.length).toBeGreaterThan(0);
    expect(demo.flows.length).toBeGreaterThan(0);
  });

  it("starts production Studio without substituting demo evidence", () => {
    const production = createInitialTopoDataState(false);
    const serialized = JSON.stringify(production).toLowerCase();

    expect(production.connected).toBe(false);
    expect(production.graph).toMatchObject({
      framework: "unknown",
      rootDir: "Not connected",
      screens: [],
      components: [],
      edges: [],
      findings: [],
    });
    expect(production.projectSettings).toMatchObject({
      name: "Workspace",
      projectRoot: "Not connected",
      sourceRoot: "Not connected",
    });
    expect(production.adapterInventory.summary.total).toBe(0);
    expect(production.notes).toEqual([]);
    expect(production.flows).toEqual([]);
    expect(production.snapshots).toEqual([]);
    expect(production.previewArtifacts).toEqual([]);
    expect(serialized).not.toContain("fieldbase");
    expect(serialized).not.toContain("demo://");
  });

  it("distinguishes connection startup, failure, daemon data, and demo", () => {
    expect(
      resolveTopoDataMode({
        demoMode: false,
        connected: false,
        connectionAttempted: false,
      }),
    ).toBe("connecting");
    expect(
      resolveTopoDataMode({
        demoMode: false,
        connected: false,
        connectionAttempted: true,
      }),
    ).toBe("offline");
    expect(
      resolveTopoDataMode({
        demoMode: false,
        connected: true,
        connectionAttempted: true,
      }),
    ).toBe("daemon");
    expect(
      resolveTopoDataMode({
        demoMode: true,
        connected: false,
        connectionAttempted: false,
      }),
    ).toBe("demo");
  });

  it("permits in-memory demo changes but requires a daemon for project writes", () => {
    expect(canPersistStudioChanges({ demoMode: true, connected: false })).toBe(
      true,
    );
    expect(canPersistStudioChanges({ demoMode: false, connected: true })).toBe(
      true,
    );
    expect(canPersistStudioChanges({ demoMode: false, connected: false })).toBe(
      false,
    );
  });
});
