import { lazy } from "react";
import { describe, expect, it } from "vitest";

import { PAPER_BOARD_CONTRACTS } from "./design/boards";
import { reviewStudio } from "./examples/review-studio";
import { customizeStudio, defaultStudio } from "./studio-config";

describe("Topo Studio composition", () => {
  it("declares every built-in destination and command in one definition", () => {
    expect(Object.keys(defaultStudio.destinations)).toEqual([
      "atlas",
      "editor",
      "notes",
      "doctor",
      "settings",
    ]);
    expect(Object.keys(defaultStudio.commands)).toEqual([
      "rescan",
      "capture",
      "doctor",
      "export",
    ]);
    expect(defaultStudio.destinations.atlas).toMatchObject({
      path: "/atlas/flows",
      tools: "canvas",
      primaryAction: "rescan",
      immersiveViews: ["live", "probe"],
    });
    expect(defaultStudio.destinations.settings).toMatchObject({
      tools: "none",
      primaryAction: "none",
      statusBar: false,
    });
  });

  it("keeps every Paper destination addressable through the composed routes", () => {
    const roots = new Set(
      Object.values(defaultStudio.destinations).map(
        (destination) => destination.path.split("/").filter(Boolean)[0],
      ),
    );
    const boardDestinations = PAPER_BOARD_CONTRACTS.filter(
      (board) =>
        board.destination !== "global" && board.destination !== "welcome",
    );

    expect(
      boardDestinations.every((board) => roots.has(board.destination)),
    ).toBe(true);
  });

  it("lets a developer remove Editor and add Reviews without editing the shell", () => {
    expect(reviewStudio.destinations.editor).toBeUndefined();
    expect(reviewStudio.destinations.reviews?.path).toBe("/reviews");
    expect(reviewStudio.commands.capture).toBeUndefined();
    expect(reviewStudio.commands.openReviews?.label).toBe("Open reviews");
  });

  it("defaults new destinations and function commands for the common case", () => {
    function ReleaseNotes() {
      return null;
    }
    const customized = customizeStudio({
      remove: { destinations: ["editor"], commands: ["capture"] },
      destinations: { releaseNotes: { component: ReleaseNotes } },
      commands: { openReleaseNotes: () => undefined },
    });

    expect(customized.destinations.releaseNotes).toMatchObject({
      label: "Release notes",
      description: "Release notes workspace",
      path: "/release-notes",
      component: ReleaseNotes,
      tools: "none",
      primaryAction: "none",
      statusBar: true,
    });
    expect(customized.commands.openReleaseNotes).toMatchObject({
      label: "Open release notes",
    });
    expect(customized.destinations.editor).toBeUndefined();
    expect(customized.commands.capture).toBeUndefined();
  });

  it("allows one-field edits to built-in destinations", () => {
    const customized = customizeStudio({
      destinations: { atlas: { label: "Map" } },
    });

    expect(customized.destinations.atlas).toMatchObject({
      label: "Map",
      path: defaultStudio.destinations.atlas?.path,
      component: defaultStudio.destinations.atlas?.component,
    });
  });

  it("customizes the built-ins without requiring an explicit base definition", () => {
    const minimal = customizeStudio({
      defaultDestination: "notes",
      destinations: {
        atlas: false,
        editor: false,
        doctor: false,
        settings: false,
      },
      commands: {
        capture: false,
        doctor: false,
        export: false,
        rescan: false,
      },
    });

    expect(minimal.defaultDestination).toBe("notes");
    expect(Object.keys(minimal.destinations)).toEqual(["notes"]);
    expect(Object.keys(minimal.commands)).toEqual([]);
  });

  it("accepts a lazy destination through the same one-field component API", () => {
    const LazyNotes = lazy(async () => ({ default: () => null }));
    const notes = defaultStudio.destinations.notes!;
    const customized = customizeStudio({
      destinations: {
        notes: { ...notes, component: LazyNotes },
      },
    });

    expect(customized.destinations.notes?.component).toBe(LazyNotes);
  });
});
