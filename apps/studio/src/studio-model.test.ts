import { describe, expect, it } from "vitest";

import {
  applyNotePatch,
  createScreenNoteAnchor,
  filterStudioNotes,
  fixtureGraph,
  fixtureInteractionProbes,
  fixtureNotes,
  fixturePreviewArtifacts,
  fixtureSnapshots,
  getNoteAnchorSignalRows,
  normalizeStudioSettings,
  noteAnchorStatus,
  searchStudioNotes,
  selectInteractionProbe,
  type StudioNote,
} from "./studio-model";

describe("Studio-local settings", () => {
  it("keeps only real browser preferences and bounds live-frame pressure", () => {
    expect(
      normalizeStudioSettings({
        workspaceName: "stale-demo-alias",
        autoCapture: false,
        viewport: "stale",
        theme: "system",
        maxLiveScreens: 99,
        promoteOnHover: false,
        runtimeDiagnostics: true,
        previewProfile: " Owner ",
      }),
    ).toEqual({
      theme: "system",
      promoteOnHover: false,
      maxLiveScreens: 8,
      runtimeDiagnostics: true,
      previewProfile: "Owner",
    });
    expect(normalizeStudioSettings({ maxLiveScreens: 0 }).maxLiveScreens).toBe(
      1,
    );
  });
});

const noteFixture: StudioNote = {
  version: 1,
  id: "note:test",
  type: "screen",
  title: "Check the empty state",
  body: "The empty state should explain the next action.",
  targetKind: "screen",
  targetId: fixtureGraph.screens[0]!.id,
  targetRoute: fixtureGraph.screens[0]!.routePath,
  status: "open",
  author: "byron",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
};

describe("Studio demo media fixtures", () => {
  it("ships a meaningful product route hierarchy instead of numbered placeholders", () => {
    const routePaths = fixtureGraph.screens.map((screen) => screen.routePath);

    expect(routePaths).toHaveLength(47);
    expect(routePaths.some((routePath) => /\/route-\d+$/.test(routePath))).toBe(
      false,
    );
    expect(routePaths).toEqual(
      expect.arrayContaining([
        "/workspace",
        "/workspace/jobs",
        "/workspace/jobs/[id]",
        "/workspace/jobs/[id]/invoice",
        "/workspace/customers/[id]",
        "/workspace/settings/team",
      ]),
    );
  });

  it("keeps renderable component sources and captured image artifacts LLM-readable", () => {
    const renderable = fixtureGraph.components.filter(
      (component) => component.previewStatus === "renderable",
    );

    expect(
      renderable.every((component) => component.previewSources.length > 0),
    ).toBe(true);
    expect(fixturePreviewArtifacts.length).toBeGreaterThan(0);
    expect(
      fixturePreviewArtifacts.every(
        (artifact) =>
          artifact.status === "captured" &&
          artifact.imageUrl?.startsWith("data:image/svg+xml"),
      ),
    ).toBe(true);
    expect(
      fixturePreviewArtifacts.every((artifact) =>
        fixtureGraph.components.some(
          (component) => component.id === artifact.targetId,
        ),
      ),
    ).toBe(true);
    expect(
      new Set(
        renderable.flatMap((component) =>
          component.previewSources.map((preview) => preview.adapterId),
        ),
      ),
    ).toEqual(new Set(["storybook", "topo"]));
    expect(
      fixturePreviewArtifacts.some(
        (artifact) =>
          artifact.adapterId === "topo" &&
          artifact.source.filePath.endsWith(".topo.tsx"),
      ),
    ).toBe(true);
    expect(fixtureGraph.components[0]?.previewSources).toHaveLength(2);
    expect(
      fixturePreviewArtifacts
        .filter(
          (artifact) => artifact.targetId === fixtureGraph.components[0]?.id,
        )
        .map((artifact) => artifact.title),
    ).toEqual(["Default", "Loading"]);
  });

  it("ships a complete domain-owned component catalog without numbered placeholders", () => {
    const components = fixtureGraph.components;
    const names = components.map((component) => component.name);
    const sourceDomains = new Set(
      components.map((component) => component.source.filePath.split("/")[1]),
    );

    expect(components).toHaveLength(128);
    expect(new Set(names).size).toBe(128);
    expect(names.some((name) => /^Component\d+$/.test(name))).toBe(false);
    expect(sourceDomains).toEqual(
      new Set([
        "billing",
        "customers",
        "data",
        "dispatch",
        "feedback",
        "forms",
        "jobs",
        "navigation",
        "scheduling",
        "ui",
      ]),
    );
    expect(components[104]).toMatchObject({
      name: "AssignmentDrawer",
      previewStatus: "missing",
      source: {
        filePath: "features/dispatch/components/AssignmentDrawer.tsx",
      },
    });
  });

  it("keeps every demo note distinct and source-targeted", () => {
    expect(fixtureNotes).toHaveLength(11);
    expect(new Set(fixtureNotes.map((note) => note.title)).size).toBe(11);
    expect(
      fixtureNotes.every(
        (note) => note.targetRoute && note.targetRoute.startsWith("/"),
      ),
    ).toBe(true);
  });

  it("provides route imagery for every resolved demo flow screen", () => {
    const snapshotScreenIds = new Set(
      fixtureSnapshots
        .filter((snapshot) => snapshot.imageUrl)
        .map((snapshot) => snapshot.screenId),
    );
    const primaryScreenIds = fixtureGraph.screens
      .filter((screen) => !screen.routePath.startsWith("/workspace/"))
      .map((screen) => screen.id);

    expect(primaryScreenIds.every((id) => snapshotScreenIds.has(id))).toBe(
      true,
    );
  });

  it("keeps every probe outcome readable and focuses inert route evidence", () => {
    expect(
      new Set(fixtureInteractionProbes.map((probe) => probe.status)),
    ).toEqual(
      new Set([
        "possibly-inert",
        "effect-observed",
        "skipped",
        "activation-error",
      ]),
    );
    expect(selectInteractionProbe(fixtureInteractionProbes, "/")).toMatchObject(
      {
        status: "possibly-inert",
        control: { label: "Watch the tour" },
      },
    );
    expect(
      selectInteractionProbe(fixtureInteractionProbes, "/jobs"),
    ).toMatchObject({
      status: "activation-error",
    });
    expect(selectInteractionProbe(fixtureInteractionProbes, "/unprobed")).toBe(
      undefined,
    );
    expect(
      selectInteractionProbe(
        fixtureInteractionProbes,
        "/",
        "fixture-interaction-probe-open-dashboard",
      ),
    ).toMatchObject({
      id: "fixture-interaction-probe-open-dashboard",
      status: "effect-observed",
    });
    expect(
      selectInteractionProbe(
        fixtureInteractionProbes,
        "/",
        "interaction-probe:stale",
      ),
    ).toMatchObject({ status: "possibly-inert" });
  });
});

describe("Studio note lifecycle and anchor evidence", () => {
  it("treats notes without anchor evidence as explicitly unbound", () => {
    expect(noteAnchorStatus(noteFixture)).toBe("unbound");
    expect(getNoteAnchorSignalRows(noteFixture)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "source",
          present: false,
          value: "Not recorded",
        }),
        expect.objectContaining({
          key: "coordinates",
          present: false,
          value: "Not recorded",
        }),
      ]),
    );
    expect(getNoteAnchorSignalRows(noteFixture)).toHaveLength(6);
  });

  it("renders every recorded anchor signal from structured evidence", () => {
    const note: StudioNote = {
      ...noteFixture,
      anchor: {
        status: "drifted",
        source: { filePath: "app/page.tsx", line: 41, column: 7 },
        componentSymbol: "MarketingHero",
        role: "heading",
        accessibleName: "Unfold your application",
        testLocator: "hero-headline",
        domFingerprint: "a91c",
        coordinates: { x: 0.25, y: 0.4, width: 0.5, height: 0.1 },
        driftPixels: 14,
      },
    };

    const rows = getNoteAnchorSignalRows(note);
    expect(rows.every((row) => row.present)).toBe(true);
    expect(rows.find((row) => row.key === "source")?.value).toBe(
      "app/page.tsx:41:7",
    );
    expect(rows.find((row) => row.key === "role-name")?.value).toContain(
      "Unfold your application",
    );
    expect(rows.find((row) => row.key === "coordinates")?.value).toContain(
      "14px drift",
    );
  });

  it("filters lifecycle separately from anchor health and note type", () => {
    const drifted: StudioNote = {
      ...noteFixture,
      id: "note:drifted",
      anchor: { status: "drifted" },
    };
    const resolved: StudioNote = {
      ...noteFixture,
      id: "note:resolved",
      status: "resolved",
      type: "flow",
    };
    const notes = [noteFixture, drifted, resolved];

    expect(filterStudioNotes(notes, "open").map((note) => note.id)).toEqual([
      "note:test",
      "note:drifted",
    ]);
    expect(filterStudioNotes(notes, "drifted").map((note) => note.id)).toEqual([
      "note:drifted",
    ]);
    expect(filterStudioNotes(notes, "resolved").map((note) => note.id)).toEqual(
      ["note:resolved"],
    );
    expect(filterStudioNotes(notes, "flow").map((note) => note.id)).toEqual([
      "note:resolved",
    ]);
  });

  it("searches note content and structured anchor evidence inside a facet", () => {
    const drifted: StudioNote = {
      ...noteFixture,
      id: "note:drifted",
      title: "Technician picker needs a fixture",
      targetRoute: "/jobs/new",
      anchor: {
        status: "drifted",
        source: { filePath: "components/technician-picker.tsx" },
        componentSymbol: "TechnicianPicker",
        testLocator: "technician-picker",
      },
    };
    const resolved: StudioNote = {
      ...noteFixture,
      id: "note:resolved",
      title: "Pricing copy signed off",
      status: "resolved",
      type: "screen",
      targetRoute: "/pricing",
    };
    const notes = [noteFixture, drifted, resolved];

    expect(
      searchStudioNotes(notes, "all", "technician picker").map(
        (note) => note.id,
      ),
    ).toEqual(["note:drifted"]);
    expect(
      searchStudioNotes(notes, "drifted", "components technician").map(
        (note) => note.id,
      ),
    ).toEqual(["note:drifted"]);
    expect(searchStudioNotes(notes, "open", "pricing")).toEqual([]);
    expect(searchStudioNotes(notes, "all", "  ")).toEqual(notes);
  });

  it("re-anchors a note to the selected screen without fabricating DOM signals", () => {
    const verifiedAt = "2026-08-01T13:00:00.000Z";
    const screen = fixtureGraph.screens[0]!;
    const anchor = createScreenNoteAnchor(noteFixture, screen, verifiedAt);

    expect(anchor).toEqual({
      status: "attached",
      source: screen.source,
      verifiedAt,
    });
    expect(
      getNoteAnchorSignalRows({ ...noteFixture, anchor }).filter(
        (row) => row.present,
      ),
    ).toHaveLength(1);
  });

  it("drops stale anchor signals when re-anchoring to a different screen", () => {
    const originalScreen = fixtureGraph.screens[0]!;
    const nextScreen = fixtureGraph.screens.find(
      (candidate) => candidate.id !== originalScreen.id,
    )!;
    const anchor = createScreenNoteAnchor(
      {
        ...noteFixture,
        targetId: originalScreen.id,
        anchor: {
          status: "drifted",
          source: originalScreen.source,
          testLocator: "old-screen-control",
          coordinates: { x: 0.2, y: 0.3 },
          driftPixels: 14,
        },
      },
      nextScreen,
      "2026-08-01T13:00:00.000Z",
    );

    expect(anchor).toEqual({
      status: "attached",
      source: nextScreen.source,
      verifiedAt: "2026-08-01T13:00:00.000Z",
    });
  });

  it("applies nullable optimistic patches without mutating creation identity", () => {
    const patched = applyNotePatch(
      { ...noteFixture, anchor: { status: "attached" } },
      { status: "resolved", author: null, anchor: null },
      "2026-08-01T14:00:00.000Z",
    );

    expect(patched).toMatchObject({
      id: noteFixture.id,
      status: "resolved",
      createdAt: noteFixture.createdAt,
      updatedAt: "2026-08-01T14:00:00.000Z",
    });
    expect(patched.author).toBeUndefined();
    expect(patched.anchor).toBeUndefined();
  });
});
