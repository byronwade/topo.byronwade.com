import type { DoctorReport } from "@topo/protocol";
import type { Finding } from "@topo/schema";

import { findingTone } from "./studio-model";

export type DoctorReportScope = "all" | "app" | "environment";
export type DoctorReportSeverity = "all" | "error" | "warning" | "info";

/**
 * Project canonical Doctor checks and source findings into the report's
 * ephemeral triage groups. This preserves daemon scopes instead of relabeling
 * every check as environment state.
 */
export function createDoctorReportPresentation(
  report: DoctorReport,
  findings: readonly Finding[],
  scope: DoctorReportScope,
  severity: DoctorReportSeverity,
) {
  const matchesSeverity = (value: "error" | "warning" | "info") =>
    severity === "all" || severity === value;
  const checksByScope = {
    environment: report.checks.filter(
      (check) =>
        check.scope === "environment" && matchesSeverity(check.severity),
    ),
    security: report.checks.filter(
      (check) => check.scope === "security" && matchesSeverity(check.severity),
    ),
    application: report.checks.filter(
      (check) =>
        check.scope === "application" && matchesSeverity(check.severity),
    ),
  };
  const matchingFindings = findings.filter((finding) =>
    matchesSeverity(findingTone(finding)),
  );
  const showEnvironment = scope !== "app";
  const showApplication = scope !== "environment";
  const visible = {
    environment: showEnvironment ? checksByScope.environment : [],
    security: showEnvironment ? checksByScope.security : [],
    application: showApplication ? checksByScope.application : [],
    findings: showApplication ? matchingFindings : [],
  };
  const environmentCount = report.checks.filter(
    (check) => check.scope === "environment" || check.scope === "security",
  ).length;
  const applicationCount =
    findings.length +
    report.checks.filter((check) => check.scope === "application").length;
  const severityCounts = {
    error:
      findings.filter((finding) => findingTone(finding) === "error").length +
      report.checks.filter((check) => check.severity === "error").length,
    warning:
      findings.filter((finding) => findingTone(finding) === "warning").length +
      report.checks.filter((check) => check.severity === "warning").length,
    info:
      findings.filter((finding) => findingTone(finding) === "info").length +
      report.checks.filter((check) => check.severity === "info").length,
  };

  return {
    visible,
    visibleCount: Object.values(visible).reduce(
      (total, records) => total + records.length,
      0,
    ),
    scopeCounts: {
      all: environmentCount + applicationCount,
      app: applicationCount,
      environment: environmentCount,
    },
    severityCounts,
  };
}
