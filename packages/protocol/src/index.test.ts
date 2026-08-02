import { describe, expect, it } from "vitest";

import {
  AdapterInventoryResponseSchema,
  ComponentPreviewScaffoldResponseSchema,
  ComponentPreviewsResponseSchema,
  DiagnosticCheckReportSchema,
  DoctorReportSchema,
  FlowsResponseSchema,
  InteractionProbesResponseSchema,
  NotesResponseSchema,
  ProjectSettingsResponseSchema,
  PreviewGatewaySessionsResponseSchema,
  ResourceEventSchema,
  SnapshotsResponseSchema,
  StudioCustomizationResponseSchema,
  VisualEvidenceResponseSchema,
  resourceEvent,
} from "./index.js";

describe("Studio resource responses", () => {
  const timestamp = "2026-08-01T02:00:00.000Z";

  it("validates the sanitized project and capture settings resource", () => {
    const settings = ProjectSettingsResponseSchema.parse({
      schemaVersion: 1,
      name: "@acme/web",
      projectRoot: "C:/work/acme",
      sourceRoot: "C:/work/acme/apps/web",
      configPath: "C:/work/acme/topo.config.ts",
      capture: {
        version: 1,
        autoCapture: false,
        headless: true,
        viewport: { width: 1280, height: 800 },
      },
    });

    expect(settings.capture.viewport).toEqual({ width: 1280, height: 800 });
    expect(JSON.stringify(settings)).not.toContain("cookies");
    expect(() =>
      ProjectSettingsResponseSchema.parse({
        ...settings,
        capture: { ...settings.capture, viewport: { width: -1, height: 800 } },
      }),
    ).toThrow();
  });

  it("keeps every hydrated collection versioned and schema-validated", () => {
    expect(
      NotesResponseSchema.parse({
        schemaVersion: 1,
        notes: [
          {
            version: 1,
            id: "review-home",
            type: "screen",
            title: "Review home",
            body: "Check the primary action.",
            status: "open",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        issues: [],
      }).notes[0]?.id,
    ).toBe("review-home");
    expect(
      FlowsResponseSchema.parse({
        schemaVersion: 1,
        flows: [
          {
            version: 1,
            id: "checkout",
            title: "Checkout",
            entryStepId: "start",
            steps: [{ id: "start", title: "Start" }],
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        issues: [],
      }).flows[0]?.id,
    ).toBe("checkout");
    expect(
      SnapshotsResponseSchema.parse({
        schemaVersion: 1,
        snapshots: [
          {
            id: "snapshot-home",
            screenId: "screen-home",
            routePath: "/",
            capturedAt: timestamp,
            status: "captured",
            contentHash: "a".repeat(64),
            imageUrl: "http://127.0.0.1:4173/snapshots/home.png",
          },
        ],
      }).snapshots[0]?.routePath,
    ).toBe("/");
    expect(
      ComponentPreviewsResponseSchema.parse({
        schemaVersion: 1,
        previewArtifacts: [],
      }).previewArtifacts,
    ).toEqual([]);
    expect(
      InteractionProbesResponseSchema.parse({
        schemaVersion: 1,
        interactionProbes: [],
      }).interactionProbes,
    ).toEqual([]);
  });

  it("rejects malformed nested records instead of trusting collection shapes", () => {
    expect(() =>
      NotesResponseSchema.parse({
        schemaVersion: 1,
        notes: [{ id: "missing-version" }],
        issues: [],
      }),
    ).toThrow();
    expect(() =>
      FlowsResponseSchema.parse({
        schemaVersion: 1,
        flows: [
          {
            version: 1,
            id: "checkout",
            title: "Checkout",
            entryStepId: "missing",
            steps: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        issues: [],
      }),
    ).toThrow(/does not exist/);
    expect(() =>
      SnapshotsResponseSchema.parse({
        schemaVersion: 1,
        snapshots: [
          {
            id: "snapshot-home",
            screenId: "screen-home",
            routePath: "/",
            capturedAt: "not-a-date",
            status: "captured",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      ComponentPreviewsResponseSchema.parse({
        schemaVersion: 1,
        previewArtifacts: [{ version: 1, id: "partial" }],
      }),
    ).toThrow();
    expect(() =>
      InteractionProbesResponseSchema.parse({
        schemaVersion: 1,
        interactionProbes: [{ version: 1, status: "guessed" }],
      }),
    ).toThrow();
  });

  it("validates source-safe component preview scaffold evidence", () => {
    const graph = {
      version: 1,
      generatedAt: timestamp,
      rootDir: "C:/project",
      framework: "next-app",
      screens: [],
      components: [],
      edges: [],
      findings: [],
    };
    expect(
      ComponentPreviewScaffoldResponseSchema.parse({
        schemaVersion: 1,
        result: {
          schemaVersion: 1,
          componentId: "component:components/Button.tsx",
          componentName: "Button",
          componentSource: "components/Button.tsx",
          previewSource: "components/Button.topo.tsx",
          exportName: "Button",
          exportKind: "function",
          requiredProps: 0,
          mode: "ready",
          canApply: true,
          sourceHash: "a".repeat(64),
          templateHash: "b".repeat(64),
          bytes: 128,
          conflicts: [],
          status: "created",
          createdAt: timestamp,
        },
        graph,
      }).result.previewSource,
    ).toBe("components/Button.topo.tsx");

    expect(() =>
      ComponentPreviewScaffoldResponseSchema.parse({
        schemaVersion: 1,
        result: {
          componentId: "partial",
          status: "created",
        },
        graph,
      }),
    ).toThrow();
  });
});

describe("diagnostic check report", () => {
  it("keeps quality-gate policy and bounded evidence machine-readable", () => {
    const report = DiagnosticCheckReportSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-08-01T02:00:00.000Z",
      projectRoot: "C:/work/topo",
      sourceRoot: "C:/work/topo/apps/web",
      mode: "runtime",
      policy: { failOn: "low", routes: ["/dashboard"] },
      ok: false,
      summary: {
        filesScanned: 12,
        findings: {
          total: 1,
          open: 1,
          blocking: 1,
          bySeverity: { info: 0, low: 1, medium: 0, high: 0 },
        },
        probes: {
          total: 1,
          effectObserved: 0,
          possiblyInert: 1,
          skipped: 0,
          activationErrors: 0,
          blocking: 0,
        },
      },
      findings: [
        {
          id: "interaction-probe:dashboard:save",
          severity: "low",
          status: "open",
          title: "Control may be inert",
          description: "No recognized effect was observed.",
          evidence: ["Probe route: /dashboard"],
          confidence: 0.82,
        },
      ],
      interactionProbes: [
        {
          version: 1,
          id: "interaction-probe:dashboard:save",
          routePath: "/dashboard",
          control: {
            index: 0,
            id: "control:save",
            label: "Save",
            tagName: "button",
            role: "button",
            locator: "#save",
          },
          status: "possibly-inert",
          effects: [],
          evidence: ["Activated #save"],
          observedAt: "2026-08-01T02:00:00.000Z",
        },
      ],
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      mode: "runtime",
      ok: false,
      policy: { failOn: "low", routes: ["/dashboard"] },
    });
    expect("graph" in report).toBe(false);
  });
});

describe("preview gateway sessions", () => {
  it("requires opaque launch URLs to retain isolated profile origins", () => {
    const response = PreviewGatewaySessionsResponseSchema.parse({
      schemaVersion: 1,
      sessions: [
        {
          profileName: "Owner",
          baseUrl: "http://127.0.0.1:4180/",
          launchUrl: "http://127.0.0.1:4180/?topo_session=opaque-owner-token",
          expiresAt: "2026-08-01T20:00:00.000Z",
        },
        {
          profileName: "Customer",
          baseUrl: "http://127.0.0.1:4181/",
          launchUrl:
            "http://127.0.0.1:4181/?topo_session=opaque-customer-token",
          expiresAt: "2026-08-01T20:00:00.000Z",
        },
      ],
    });
    expect(response.sessions.map((session) => session.profileName)).toEqual([
      "Owner",
      "Customer",
    ]);
    expect(() =>
      PreviewGatewaySessionsResponseSchema.parse({
        schemaVersion: 1,
        sessions: [
          {
            profileName: "Owner",
            baseUrl: "http://127.0.0.1:4180/",
            launchUrl: "http://127.0.0.1:4181/?topo_session=wrong-origin",
            expiresAt: "2026-08-01T20:00:00.000Z",
          },
        ],
      }),
    ).toThrow();
  });
});

describe("adapter inventory", () => {
  it("keeps daemon adapter capabilities versioned and machine-readable", () => {
    expect(
      AdapterInventoryResponseSchema.parse({
        schemaVersion: 1,
        adapters: [
          {
            id: "builtin:framework:next",
            adapterId: "next",
            displayName: "Next.js",
            kind: "framework",
            provenance: "built-in",
            status: "active",
            active: true,
            registered: false,
            routeCount: 3,
            previewCount: 0,
          },
        ],
        issues: [],
        summary: {
          total: 1,
          active: 1,
          registered: 0,
          declared: 0,
          issues: 0,
        },
      }).adapters[0],
    ).toMatchObject({ adapterId: "next", routeCount: 3 });
  });
});

describe("Studio customization", () => {
  it("normalizes a compact loopback-only project manifest", () => {
    expect(
      StudioCustomizationResponseSchema.parse({
        schemaVersion: 1,
        remove: { destinations: ["editor"], commands: ["capture"] },
        destinations: {
          atlas: { label: "Map" },
          reviews: { url: "http://127.0.0.1:4400/reviews" },
        },
        commands: {
          doctor: { label: "Run checks" },
          openReviews: { to: "reviews" },
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      remove: { destinations: ["editor"], commands: ["capture"] },
      destinations: {
        atlas: { label: "Map" },
        reviews: { url: "http://127.0.0.1:4400/reviews" },
      },
      commands: {
        doctor: { label: "Run checks" },
        openReviews: { to: "reviews" },
      },
    });
  });

  it("rejects remote frames, invalid IDs, and query-bearing paths", () => {
    expect(() =>
      StudioCustomizationResponseSchema.parse({
        schemaVersion: 1,
        destinations: { reports: { url: "https://example.com" } },
      }),
    ).toThrow("loopback HTTP");
    expect(() =>
      StudioCustomizationResponseSchema.parse({
        schemaVersion: 1,
        destinations: {
          "Not valid": { url: "http://127.0.0.1:4400" },
        },
      }),
    ).toThrow("Studio entry IDs");
    expect(() =>
      StudioCustomizationResponseSchema.parse({
        schemaVersion: 1,
        destinations: {
          reports: {
            path: "/reports?mode=all",
            url: "http://127.0.0.1:4400",
          },
        },
      }),
    ).toThrow("absolute pathnames");
    expect(() =>
      StudioCustomizationResponseSchema.parse({
        schemaVersion: 1,
        commands: { openReports: { to: "Not valid" } },
      }),
    ).toThrow("Studio entry IDs");
  });
});

describe("resource events", () => {
  it("validates every durable Studio resource invalidation", () => {
    expect(
      ResourceEventSchema.parse(
        resourceEvent("adapters", "2026-08-01T02:00:00.000Z"),
      ),
    ).toMatchObject({ resource: "adapters" });
    expect(
      ResourceEventSchema.parse(
        resourceEvent("notes", "2026-08-01T02:00:00.000Z"),
      ),
    ).toEqual({
      type: "resource.updated",
      resource: "notes",
      occurredAt: "2026-08-01T02:00:00.000Z",
    });
    expect(
      ResourceEventSchema.parse({
        type: "resource.updated",
        resource: "snapshots",
        occurredAt: "2026-08-01T02:00:00.000Z",
      }),
    ).toMatchObject({ resource: "snapshots" });
    expect(
      ResourceEventSchema.parse({
        type: "resource.updated",
        resource: "visuals",
        occurredAt: "2026-08-01T02:00:00.000Z",
      }),
    ).toMatchObject({ resource: "visuals" });
    expect(
      ResourceEventSchema.parse({
        type: "resource.updated",
        resource: "component-previews",
        occurredAt: "2026-08-01T02:00:00.000Z",
      }),
    ).toMatchObject({ resource: "component-previews" });
    expect(
      ResourceEventSchema.parse(
        resourceEvent("doctor", "2026-08-01T02:00:00.000Z"),
      ),
    ).toMatchObject({ resource: "doctor" });
    expect(() =>
      ResourceEventSchema.parse({
        type: "resource.updated",
        resource: "unknown",
        occurredAt: "2026-08-01T02:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("visual evidence", () => {
  it("keeps baseline authority and comparison metrics machine-readable", () => {
    const hash = "a".repeat(64);
    expect(
      VisualEvidenceResponseSchema.parse({
        schemaVersion: 1,
        baselines: [
          {
            version: 1,
            id: "visual-baseline-home",
            screenId: "screen:home",
            routePath: "/",
            sourceSnapshotId: "snapshot-home",
            acceptedAt: "2026-08-01T02:00:00.000Z",
            artifactPath: ".topo/snapshots/home.png",
            contentHash: hash,
            width: 1440,
            height: 1024,
          },
        ],
        comparisons: [],
      }).baselines[0],
    ).toMatchObject({ screenId: "screen:home", contentHash: hash });
  });
});

describe("doctor report", () => {
  it("retains stable checks and summary evidence", () => {
    expect(
      DoctorReportSchema.parse({
        schemaVersion: 1,
        generatedAt: "2026-08-01T02:00:00.000Z",
        projectRoot: "C:/work/topo",
        sourceRoot: "C:/work/topo/apps/web",
        ok: true,
        summary: { total: 1, passed: 1, warnings: 0, errors: 0 },
        checks: [
          {
            id: "runtime.node-version",
            scope: "environment",
            title: "Node.js runtime",
            status: "pass",
            severity: "info",
            detail: "Node.js 24.14.0 satisfies the required major version.",
            evidence: { version: "24.14.0", requiredMajor: 24 },
          },
        ],
      }).checks[0],
    ).toMatchObject({ id: "runtime.node-version", status: "pass" });
  });
});
