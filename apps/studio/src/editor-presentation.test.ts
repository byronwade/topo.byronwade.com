import { describe, expect, it } from "vitest";

import {
  filterEditorComponents,
  filterEditorScreens,
} from "./editor-presentation";
import { fixtureGraph } from "./studio-model";

describe("Editor evidence presentation", () => {
  it("keeps the complete default-screen inventory in canonical route order", () => {
    const screens = filterEditorScreens(fixtureGraph.screens, "");
    expect(screens).toHaveLength(
      fixtureGraph.screens.filter((screen) => screen.state === "default")
        .length,
    );
    expect(new Set(screens.map((screen) => screen.id)).size).toBe(
      screens.length,
    );
    expect(screens[0]?.routePath).toBe("/");
  });

  it("searches stable route, source, status, and component evidence", () => {
    const missingComponents = filterEditorComponents(
      fixtureGraph.components,
      "missing",
    );
    expect(
      filterEditorScreens(fixtureGraph.screens, "workspace dispatch map").map(
        (screen) => screen.routePath,
      ),
    ).toEqual(["/workspace/dispatch/map"]);
    expect(
      filterEditorComponents(fixtureGraph.components, "technician picker").map(
        (component) => component.name,
      ),
    ).toContain("TechnicianPicker");
    expect(missingComponents.length).toBeGreaterThan(0);
    expect(
      missingComponents.every(
        (component) => component.previewStatus === "missing",
      ),
    ).toBe(true);
  });
});
