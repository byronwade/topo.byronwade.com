import { describe, expect, it, vi } from "vitest";

import { StudioCustomizationResponseSchema } from "@topo/protocol";

import { composeProjectStudio } from "./project-studio";
import { defaultStudio } from "./studio-config";
import type { TopoStudioRuntime } from "./studio-runtime";

describe("project-owned Studio customization", () => {
  it("adds a defaulted local destination and command while removing built-ins", () => {
    const manifest = StudioCustomizationResponseSchema.parse({
      schemaVersion: 1,
      defaultDestination: "reviews",
      remove: { destinations: ["editor"], commands: ["capture"] },
      destinations: {
        atlas: { label: "Map" },
        reviews: { url: "http://127.0.0.1:4400/review" },
      },
      commands: {
        doctor: { label: "Run checks" },
        openReviews: { to: "reviews", view: "assigned" },
      },
    });
    const composition = composeProjectStudio(defaultStudio, manifest);

    expect(composition.issues).toEqual([]);
    expect(composition.definition.defaultDestination).toBe("reviews");
    expect(composition.definition.destinations.editor).toBeUndefined();
    expect(composition.definition.destinations.atlas).toMatchObject({
      label: "Map",
      path: "/atlas/flows",
      tools: "canvas",
    });
    expect(composition.definition.destinations.atlas?.component).toBe(
      defaultStudio.destinations.atlas?.component,
    );
    expect(composition.definition.destinations.reviews).toMatchObject({
      label: "Reviews",
      path: "/reviews",
      tools: "none",
      primaryAction: "none",
      statusBar: true,
    });
    expect(composition.definition.commands.capture).toBeUndefined();
    expect(composition.definition.commands.doctor).toMatchObject({
      label: "Run checks",
      shortcut: "⌘ ↵",
    });
    const runChecks = vi.fn();
    composition.definition.commands.doctor?.run({
      data: { runChecks },
    } as unknown as TopoStudioRuntime);
    expect(runChecks).toHaveBeenCalledOnce();
    expect(composition.definition.commands.openReviews?.label).toBe(
      "Open reviews",
    );

    const go = vi.fn();
    composition.definition.commands.openReviews?.run({
      actions: { go },
    } as unknown as TopoStudioRuntime);
    expect(go).toHaveBeenCalledWith("reviews", "assigned");
  });

  it("keeps the working base Studio when a project route is ambiguous", () => {
    const manifest = StudioCustomizationResponseSchema.parse({
      schemaVersion: 1,
      destinations: {
        reports: {
          path: "/atlas/reports",
          url: "http://localhost:4400",
        },
      },
    });
    const composition = composeProjectStudio(defaultStudio, manifest);

    expect(composition.definition).toBe(defaultStudio);
    expect(composition.issues[0]).toContain("share route root");
  });

  it("keeps the working base Studio when a command target is missing", () => {
    const manifest = StudioCustomizationResponseSchema.parse({
      schemaVersion: 1,
      commands: {
        openReviews: { to: "reviews" },
      },
    });
    const composition = composeProjectStudio(defaultStudio, manifest);

    expect(composition.definition).toBe(defaultStudio);
    expect(composition.issues[0]).toContain(
      'command "openReviews" targets missing destination "reviews"',
    );
  });

  it("requires runtime fields only for new project entries", () => {
    const destinationManifest = StudioCustomizationResponseSchema.parse({
      schemaVersion: 1,
      destinations: { reviews: { label: "Reviews" } },
    });
    const destinationComposition = composeProjectStudio(
      defaultStudio,
      destinationManifest,
    );

    expect(destinationComposition.definition).toBe(defaultStudio);
    expect(destinationComposition.issues).toEqual([
      'Project Studio customization was ignored: New project Studio destination "reviews" needs a loopback URL',
    ]);

    const commandManifest = StudioCustomizationResponseSchema.parse({
      schemaVersion: 1,
      commands: { openReviews: { label: "Open reviews" } },
    });
    const commandComposition = composeProjectStudio(
      defaultStudio,
      commandManifest,
    );

    expect(commandComposition.definition).toBe(defaultStudio);
    expect(commandComposition.issues).toEqual([
      'Project Studio customization was ignored: New project Studio command "openReviews" needs a destination in "to"',
    ]);
  });
});
