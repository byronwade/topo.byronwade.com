import { describe, expect, it } from "vitest";

import { emptyApplicationGraph } from "@topo/schema";

import { fixtureGraph } from "./studio-model";
import {
  presentConnection,
  presentFramework,
  presentProject,
  presentScanState,
  presentWelcome,
} from "./studio-presentation";

describe("Studio project presentation", () => {
  it("presents built-in and extension framework identities", () => {
    expect(presentFramework("next-app")).toBe("Next.js App Router");
    expect(presentFramework("tanstack-start")).toBe("TanStack Start");
    expect(presentFramework("acme-router")).toBe("Acme Router");
  });

  it("derives a bounded project label from either path style", () => {
    expect(
      presentProject({ ...fixtureGraph, rootDir: "C:\\code\\field-service" }),
    ).toBe("field-service");
    expect(
      presentProject({ ...fixtureGraph, rootDir: "/work/apps/customer-web" }),
    ).toBe("customer-web");
    expect(presentProject(emptyApplicationGraph("Not connected"))).toBe(
      "No project",
    );
  });

  it("labels empty production state without fixture or scan claims", () => {
    const graph = emptyApplicationGraph("Not connected");
    const welcome = presentWelcome("offline", graph);

    expect(presentConnection("connecting", graph)).toBe("Connecting to daemon");
    expect(presentConnection("offline", graph)).toBe(
      "Daemon offline · no project loaded",
    );
    expect(presentScanState("offline", graph)).toBe("no project data");
    expect(welcome.introduction).toContain("No project is loaded");
    expect(welcome.footer).toContain("never substitutes");
    expect(JSON.stringify(welcome).toLowerCase()).not.toContain(
      "fieldbase is loaded",
    );
  });

  it("labels disconnected evidence as stale rather than current", () => {
    const welcome = presentWelcome("offline", fixtureGraph);

    expect(presentConnection("offline", fixtureGraph)).toContain(
      "last known data",
    );
    expect(presentScanState("offline", fixtureGraph)).toBe(
      "last validated local data",
    );
    expect(welcome.introduction).toContain("last graph validated");
    expect(welcome.footer).toContain("Reconnect before changing");
  });
});
