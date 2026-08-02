import { createHash } from "node:crypto";

import type { PreviewProfile } from "@topo/browser";
import {
  probeRoute,
  type RuntimeObservation,
  type RuntimeProbeOptions,
  type RuntimeProbeResult,
} from "@topo/analyzer-runtime";
import {
  analyzeStaticWorkspace,
  type StaticAnalysisResult,
} from "@topo/analyzer-static";
import {
  DiagnosticCheckReportSchema,
  type DiagnosticCheckFailOn,
  type DiagnosticCheckReport,
} from "@topo/protocol";
import { screenPreviewPath } from "@topo/schema";
import type {
  ApplicationGraph,
  Finding,
  InteractionProbeArtifact,
} from "@topo/schema";

export interface DiagnosticsOptions {
  rootDir: string;
  graph: ApplicationGraph;
  /** Reuses a daemon-owned source snapshot when the caller already analyzed it. */
  staticAnalysis?: StaticAnalysisResult;
  baseUrl?: string;
  profile?: PreviewProfile;
  headless?: boolean;
  executablePath?: string;
  viewport?: { width: number; height: number };
  runtime?: boolean;
  routes?: string[];
  probe?: (options: RuntimeProbeOptions) => Promise<RuntimeProbeResult>;
  now?: () => string;
}

export interface DiagnosticsResult {
  graph: ApplicationGraph;
  findings: Finding[];
  staticFilesScanned: number;
  runtimeObservations: RuntimeObservation[];
  interactionProbes: InteractionProbeArtifact[];
  probedRoutes: string[];
}

export interface DiagnosticCheckOptions extends DiagnosticsOptions {
  projectRoot: string;
  failOn?: DiagnosticCheckFailOn;
}

const FINDING_SEVERITY_RANK = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
} as const;

function routeErrorArtifact(
  routePath: string,
  previewPath: string | undefined,
  screenId: string | undefined,
  error: unknown,
  now: () => string,
): InteractionProbeArtifact {
  const message =
    error instanceof Error ? error.message : "Unable to probe route";
  const digest = createHash("sha256")
    .update(routePath)
    .digest("hex")
    .slice(0, 20);
  return {
    version: 1,
    id: `interaction-probe:route-error:${digest}`,
    routePath,
    ...(previewPath ? { previewPath } : {}),
    ...(screenId ? { screenId } : {}),
    control: {
      index: -1,
      id: `control:route:${digest}`,
      label: `Route probe for ${routePath}`,
      tagName: "document",
      role: "document",
      locator: routePath,
    },
    status: "activation-error",
    effects: [],
    evidence: [`Unable to probe ${routePath}: ${message}`],
    observedAt: now(),
    error: message,
  };
}

function isRuntimeFindingForRoutes(
  finding: Finding,
  routePaths: Set<string>,
): boolean {
  if (!finding.id.startsWith("interaction-probe:")) return false;
  return finding.evidence.some((item) => {
    if (!item.startsWith("Probe route: ")) return false;
    return routePaths.has(item.slice("Probe route: ".length));
  });
}

function reconcileFindings(
  graph: ApplicationGraph,
  staticFindings: Finding[],
  runtimeFindings: Finding[],
  probedRoutes: string[],
): Finding[] {
  const routeScope = new Set(probedRoutes);
  const retained = graph.findings.filter(
    (finding) =>
      !finding.id.startsWith("static:") &&
      !isRuntimeFindingForRoutes(finding, routeScope),
  );
  const byId = new Map<string, Finding>();
  for (const finding of [...retained, ...staticFindings, ...runtimeFindings]) {
    byId.set(finding.id, finding);
  }
  return [...byId.values()];
}

export async function runDiagnostics(
  options: DiagnosticsOptions,
): Promise<DiagnosticsResult> {
  const staticResult =
    options.staticAnalysis ?? (await analyzeStaticWorkspace(options.rootDir));
  const interactionProbes: InteractionProbeArtifact[] = [];
  const runtimeFindings: Finding[] = [];
  const now = options.now ?? (() => new Date().toISOString());
  const probe = options.probe ?? probeRoute;
  const probedRoutes = options.runtime
    ? [
        ...new Set(
          options.routes ??
            options.graph.screens
              .filter((screen) => screen.state === "default")
              .map((screen) => screen.routePath),
        ),
      ]
    : [];

  for (const routePath of probedRoutes) {
    const screen = options.graph.screens.find(
      (candidate) =>
        candidate.routePath === routePath && candidate.state === "default",
    );
    if (!screen) throw new Error(`Unknown diagnostic route: ${routePath}`);
    const previewPath = screenPreviewPath(screen);
    try {
      if (!previewPath) {
        throw new Error(
          screen.previewRoute?.status === "unresolved"
            ? screen.previewRoute.reason
            : `No preview path is available for ${routePath}`,
        );
      }
      const result = await probe({
        baseUrl: options.baseUrl ?? options.graph.previewBaseUrl,
        routePath,
        previewPath,
        screenId: screen.id,
        profile: options.profile,
        headless: options.headless,
        executablePath: options.executablePath,
        viewport: options.viewport,
      });
      interactionProbes.push(...result.observations);
      runtimeFindings.push(...result.findings);
    } catch (error: unknown) {
      interactionProbes.push(
        routeErrorArtifact(routePath, previewPath, screen.id, error, now),
      );
    }
  }

  const findings = reconcileFindings(
    options.graph,
    staticResult.findings,
    runtimeFindings,
    probedRoutes,
  );
  return {
    graph: { ...options.graph, findings },
    findings,
    staticFilesScanned: staticResult.filesScanned,
    runtimeObservations: interactionProbes,
    interactionProbes,
    probedRoutes,
  };
}

/**
 * Runs the existing diagnostics pipeline and projects its result into the
 * bounded, versioned contract used by CLI and CI callers. The application
 * graph remains the diagnostic source of truth and is intentionally omitted
 * from this report so machine consumers do not need to load it twice.
 */
export async function runDiagnosticCheck(
  options: DiagnosticCheckOptions,
): Promise<DiagnosticCheckReport> {
  const result = await runDiagnostics(options);
  const failOn = options.failOn ?? "low";
  const threshold =
    failOn === "none" ? undefined : FINDING_SEVERITY_RANK[failOn];
  const blockingFindings = result.findings.filter(
    (finding) =>
      finding.status === "open" &&
      threshold !== undefined &&
      FINDING_SEVERITY_RANK[finding.severity] >= threshold,
  ).length;
  const activationErrors = result.interactionProbes.filter(
    (probe) => probe.status === "activation-error",
  ).length;
  const blockingProbeErrors = failOn === "none" ? 0 : activationErrors;
  const countSeverity = (severity: keyof typeof FINDING_SEVERITY_RANK) =>
    result.findings.filter((finding) => finding.severity === severity).length;
  const countProbeStatus = (
    status: InteractionProbeArtifact["status"],
  ): number =>
    result.interactionProbes.filter((probe) => probe.status === status).length;

  return DiagnosticCheckReportSchema.parse({
    schemaVersion: 1,
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
    projectRoot: options.projectRoot,
    sourceRoot: options.rootDir,
    mode: options.runtime ? "runtime" : "static",
    policy: {
      failOn,
      routes: result.probedRoutes,
    },
    ok: blockingFindings === 0 && blockingProbeErrors === 0,
    summary: {
      filesScanned: result.staticFilesScanned,
      findings: {
        total: result.findings.length,
        open: result.findings.filter((finding) => finding.status === "open")
          .length,
        blocking: blockingFindings,
        bySeverity: {
          info: countSeverity("info"),
          low: countSeverity("low"),
          medium: countSeverity("medium"),
          high: countSeverity("high"),
        },
      },
      probes: {
        total: result.interactionProbes.length,
        effectObserved: countProbeStatus("effect-observed"),
        possiblyInert: countProbeStatus("possibly-inert"),
        skipped: countProbeStatus("skipped"),
        activationErrors,
        blocking: blockingProbeErrors,
      },
    },
    findings: result.findings,
    interactionProbes: result.interactionProbes,
  });
}
