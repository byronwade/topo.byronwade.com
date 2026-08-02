import { describe, expect, it } from "vitest";

import type { DoctorReport } from "@topo/protocol";

import { fixtureDoctorReport, fixtureGraph } from "./studio-model";
import { createDoctorReportPresentation } from "./doctor-presentation";

const report: DoctorReport = {
  ...fixtureDoctorReport,
  checks: [
    ...fixtureDoctorReport.checks,
    {
      id: "demo.framework",
      scope: "application",
      title: "Framework adapter is ready",
      status: "warning",
      severity: "warning",
      detail: "One native application adapter is available.",
      evidence: { framework: "next" },
    },
  ],
};

describe("Doctor report presentation", () => {
  it("preserves canonical environment, security, and application scopes", () => {
    const presentation = createDoctorReportPresentation(
      report,
      fixtureGraph.findings,
      "all",
      "all",
    );

    expect(presentation.visible.environment).toHaveLength(1);
    expect(presentation.visible.security).toHaveLength(1);
    expect(presentation.visible.application).toHaveLength(1);
    expect(presentation.visible.findings).toHaveLength(14);
    expect(presentation.scopeCounts).toEqual({
      all: 17,
      app: 15,
      environment: 2,
    });
    expect(presentation.visibleCount).toBe(17);
  });

  it("composes scope and severity filters without truncating findings", () => {
    const environment = createDoctorReportPresentation(
      report,
      fixtureGraph.findings,
      "environment",
      "info",
    );
    expect(environment.visible.environment).toHaveLength(1);
    expect(environment.visible.security).toHaveLength(1);
    expect(environment.visible.application).toEqual([]);
    expect(environment.visible.findings).toEqual([]);
    expect(environment.visibleCount).toBe(2);

    const app = createDoctorReportPresentation(
      report,
      fixtureGraph.findings,
      "app",
      "all",
    );
    expect(app.visible.application).toHaveLength(1);
    expect(app.visible.findings.map((finding) => finding.id)).toEqual(
      fixtureGraph.findings.map((finding) => finding.id),
    );
    expect(app.visibleCount).toBe(15);
  });
});
