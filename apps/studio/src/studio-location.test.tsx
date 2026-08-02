import { describe, expect, it } from "vitest";

import { defaultStudio, defineTopoStudio } from "./studio-config";
import { parseStudioLocation } from "./studio-location";

function ReportsDestination() {
  return null;
}

describe("parseStudioLocation", () => {
  it("derives built-in views and overlays from the composed Studio", () => {
    expect(
      parseStudioLocation(defaultStudio, "/doctor?overlay=export"),
    ).toEqual({
      destination: "doctor",
      view: "index",
      overlay: "export",
    });
    expect(
      parseStudioLocation(defaultStudio, "/atlas/routes?overlay=annotate"),
    ).toEqual({
      destination: "atlas",
      view: "routes",
      overlay: "annotate",
    });
    expect(parseStudioLocation(defaultStudio, "/welcome")).toEqual({
      destination: "atlas",
      view: "flows",
      overlay: "welcome",
    });
  });

  it("keeps map presentation addressable without making it route identity", () => {
    expect(
      parseStudioLocation(defaultStudio, "/atlas/routes?canvas=map&demo=1"),
    ).toEqual({
      destination: "atlas",
      view: "routes",
      overlay: undefined,
      canvas: "map",
    });
    expect(
      parseStudioLocation(defaultStudio, "/atlas/components?canvas=screen"),
    ).toEqual({
      destination: "atlas",
      view: "components",
      overlay: undefined,
    });
  });

  it("routes custom destinations without adding shell conditionals", () => {
    const customized = defineTopoStudio({
      extends: defaultStudio,
      destinations: {
        editor: false,
        reports: {
          label: "Reports",
          description: "Project reports",
          path: "/reports/summary",
          component: ReportsDestination,
          icon: defaultStudio.destinations.atlas!.icon,
          tools: "none",
          primaryAction: "none",
        },
      },
    });

    expect(parseStudioLocation(customized, "/reports/history")).toMatchObject({
      destination: "reports",
      view: "history",
    });
    expect(parseStudioLocation(customized, "/editor/canvas")).toMatchObject({
      destination: "atlas",
      view: "flows",
    });
  });
});
