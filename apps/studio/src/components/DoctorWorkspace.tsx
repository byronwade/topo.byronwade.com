import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronDown, PanelRight, Route } from "lucide-react";

import { compareRouteScreens } from "@topo/canvas-engine";
import type { DoctorReport } from "@topo/protocol";
import type { CanvasInteractionMode } from "@topo/react";
import type { ApplicationGraph, Finding } from "@topo/schema";

import { selectFindingScreen, selectScreenEvidence } from "../screen-evidence";
import {
  createDoctorReportPresentation,
  type DoctorReportScope,
  type DoctorReportSeverity,
} from "../doctor-presentation";
import {
  findingTone,
  type StudioNote,
  type StudioSnapshot,
} from "../studio-model";
import { ScreenEvidenceStage } from "./ScreenEvidenceStage";

interface DoctorWorkspaceProps {
  connected: boolean;
  view: string;
  graph: ApplicationGraph;
  doctorReport: DoctorReport;
  interactionMode: CanvasInteractionMode;
  notes: StudioNote[];
  previewBaseUrl: string;
  selectedFindingId?: string;
  selectedScreenId?: string;
  snapshots: StudioSnapshot[];
  runtimeDiagnostics: boolean;
  busyAction?: string;
  onRunChecks: () => void;
  onNavigate: (path: string) => void;
  onSelectFinding: (id?: string) => void;
  onSelectScreen: (id: string) => void;
}

function FindingRow({
  finding,
  onOpen,
}: {
  finding: Finding;
  onOpen: () => void;
}) {
  return (
    <button
      className={`doctor-row tone-${findingTone(finding)}`}
      data-finding-id={finding.id}
      onClick={onOpen}
      type="button"
    >
      <span className="doctor-dot" />
      <strong>{finding.title}</strong>
      <code>{finding.description}</code>
      <span>{finding.confidence.toFixed(2)}</span>
    </button>
  );
}

async function copyRemediation(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

function DoctorCheckGroup({
  checks,
  copyState,
  label,
  onCopy,
}: {
  checks: DoctorReport["checks"];
  copyState?: { id: string; status: "copied" | "failed" };
  label: string;
  onCopy: (id: string, action: string) => void;
}) {
  if (checks.length === 0) return null;
  return (
    <section className="doctor-report-group" data-doctor-scope={label}>
      <span className="section-label">{label}</span>
      <div className="environment-list">
        {checks.map((check) => {
          const actionState =
            copyState?.id === check.id ? copyState.status : undefined;
          return (
            <article
              className={`doctor-row tone-${check.severity}`}
              data-doctor-check-id={check.id}
              key={check.id}
            >
              <span className="doctor-dot" />
              <div>
                <strong>{check.title}</strong>
                <code>{check.detail}</code>
              </div>
              {check.action && (
                <button
                  aria-label={`Copy remediation for ${check.title}`}
                  data-copy-state={actionState ?? "ready"}
                  onClick={() => onCopy(check.id, check.action!)}
                  title="Copy remediation"
                  type="button"
                >
                  {actionState === "copied"
                    ? "Copied"
                    : actionState === "failed"
                      ? "Copy failed"
                      : check.action}
                </button>
              )}
              {!check.action && <span>{check.status.toUpperCase()}</span>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DoctorReportView(props: DoctorWorkspaceProps) {
  const [scope, setScope] = useState<DoctorReportScope>("all");
  const [severity, setSeverity] = useState<DoctorReportSeverity>("all");
  const [copyState, setCopyState] = useState<{
    id: string;
    status: "copied" | "failed";
  }>();
  const presentation = createDoctorReportPresentation(
    props.doctorReport,
    props.graph.findings,
    scope,
    severity,
  );
  const copyCheckAction = (id: string, action: string) => {
    void copyRemediation(action)
      .then(() => setCopyState({ id, status: "copied" }))
      .catch(() => setCopyState({ id, status: "failed" }));
  };
  return (
    <div className="doctor-report-view">
      <aside className="filter-sidebar">
        <span className="section-label">SCOPE</span>
        <button
          className={scope === "all" ? "is-selected" : ""}
          onClick={() => setScope("all")}
          type="button"
        >
          <span>All checks</span>
          <small>{presentation.scopeCounts.all}</small>
        </button>
        <button
          className={scope === "app" ? "is-selected" : ""}
          onClick={() => setScope("app")}
          type="button"
        >
          <span>In the app</span>
          <small>{presentation.scopeCounts.app}</small>
        </button>
        <button
          className={scope === "environment" ? "is-selected" : ""}
          onClick={() => setScope("environment")}
          type="button"
        >
          <span>In the environment</span>
          <small className="error-text">
            {presentation.scopeCounts.environment}
          </small>
        </button>
        <span className="section-label">SEVERITY</span>
        <button
          className={severity === "error" ? "is-selected" : ""}
          onClick={() =>
            setSeverity((current) => (current === "error" ? "all" : "error"))
          }
          type="button"
        >
          <span className="label-with-dot tone-error">Error</span>
          <small>{presentation.severityCounts.error}</small>
        </button>
        <button
          className={severity === "warning" ? "is-selected" : ""}
          onClick={() =>
            setSeverity((current) =>
              current === "warning" ? "all" : "warning",
            )
          }
          type="button"
        >
          <span className="label-with-dot tone-warning">Warning</span>
          <small>{presentation.severityCounts.warning}</small>
        </button>
        <button
          className={severity === "info" ? "is-selected" : ""}
          onClick={() =>
            setSeverity((current) => (current === "info" ? "all" : "info"))
          }
          type="button"
        >
          <span className="label-with-dot tone-info">Info</span>
          <small>{presentation.severityCounts.info}</small>
        </button>
      </aside>
      <main className="doctor-report-panel">
        <header>
          <div>
            <h1>Doctor</h1>
            <p>
              {presentation.visibleCount} checks shown · last run{" "}
              {formatLastRun(props.doctorReport.generatedAt)} · evidence only,
              never a verdict
            </p>
          </div>
          <button
            className="primary-button"
            disabled={props.busyAction === "doctor"}
            onClick={props.onRunChecks}
            type="button"
          >
            {props.busyAction === "doctor"
              ? "Running checks"
              : props.busyAction === "probe"
                ? "Running runtime probes"
                : props.runtimeDiagnostics
                  ? "Re-run + runtime"
                  : "Re-run all checks"}
          </button>
        </header>
        <DoctorCheckGroup
          checks={presentation.visible.environment}
          copyState={copyState}
          label="IN THE ENVIRONMENT"
          onCopy={copyCheckAction}
        />
        <DoctorCheckGroup
          checks={presentation.visible.security}
          copyState={copyState}
          label="SECURITY"
          onCopy={copyCheckAction}
        />
        <DoctorCheckGroup
          checks={presentation.visible.application}
          copyState={copyState}
          label="PROJECT READINESS"
          onCopy={copyCheckAction}
        />
        {presentation.visible.findings.length > 0 && (
          <section className="doctor-report-group" data-doctor-scope="findings">
            <span className="section-label">SOURCE FINDINGS</span>
            <div className="doctor-finding-list">
              {presentation.visible.findings.map((finding) => (
                <FindingRow
                  finding={finding}
                  key={finding.id}
                  onOpen={() => {
                    props.onSelectFinding(finding.id);
                    const screen = selectFindingScreen(
                      props.graph,
                      finding,
                      props.selectedScreenId,
                    );
                    if (screen) props.onSelectScreen(screen.id);
                    props.onNavigate("/doctor/findings");
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function FindingsOverlay(props: DoctorWorkspaceProps) {
  const selectedFindingRef = useRef<HTMLButtonElement>(null);
  const initializedFindingRef = useRef(false);
  const preferredScreen =
    props.graph.screens.find(
      (screen) => screen.id === props.selectedScreenId,
    ) ?? props.graph.screens[0];
  const selectedFinding = props.graph.findings.find(
    (finding) => finding.id === props.selectedFindingId,
  );
  const selectedScreen = selectedFinding
    ? selectFindingScreen(props.graph, selectedFinding, preferredScreen?.id)
    : preferredScreen;
  const evidence = useMemo(
    () =>
      selectScreenEvidence({
        graph: props.graph,
        notes: props.notes,
        snapshots: props.snapshots,
        selectedScreenId: selectedScreen?.id,
      }),
    [props.graph, props.notes, props.snapshots, selectedScreen?.id],
  );
  const routeScreens = props.graph.screens
    .filter((screen) => screen.state === "default")
    .sort(compareRouteScreens);

  useEffect(() => {
    if (initializedFindingRef.current) return;
    initializedFindingRef.current = true;
    if (!props.selectedFindingId && props.graph.findings[0]) {
      props.onSelectFinding(props.graph.findings[0].id);
    }
  }, [props.graph.findings, props.onSelectFinding, props.selectedFindingId]);

  useEffect(() => {
    selectedFindingRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedFinding?.id]);

  const selectFinding = (finding: Finding) => {
    props.onSelectFinding(finding.id);
    const screen = selectFindingScreen(
      props.graph,
      finding,
      selectedScreen?.id,
    );
    if (screen) props.onSelectScreen(screen.id);
  };

  return (
    <div
      className="three-pane doctor-findings-view"
      data-selected-finding-id={selectedFinding?.id}
    >
      <aside className="atlas-sidebar note-detail-tree">
        <div className="atlas-tabs">
          <button
            className="is-active"
            onClick={() => props.onNavigate("/atlas/routes")}
            type="button"
          >
            Routes
          </button>
          <button
            onClick={() => props.onNavigate("/atlas/components")}
            type="button"
          >
            Components
          </button>
          <button
            onClick={() => props.onNavigate("/atlas/flows")}
            type="button"
          >
            Flows
          </button>
        </div>
        <div className="tree-scroll">
          <div className="tree-row tree-root">
            <ChevronDown size={11} />
            <strong>app</strong>
          </div>
          {routeScreens.map((screen) => {
            const routeDepth = screen.routePath
              .split("/")
              .filter(Boolean).length;
            const indent = Math.min(3, routeDepth + 1);
            return (
              <button
                aria-label={`Open ${screen.routePath} screen evidence`}
                className={`tree-row tree-file indent-${indent} ${screen.id === selectedScreen?.id ? "is-selected" : ""}`}
                key={screen.id}
                onClick={() => {
                  props.onSelectFinding(undefined);
                  props.onSelectScreen(screen.id);
                }}
                title={`${screen.routePath} · ${screen.source.filePath}`}
                type="button"
              >
                <Route size={11} />
                <span>{screen.routePath}</span>
              </button>
            );
          })}
        </div>
      </aside>
      <ScreenEvidenceStage
        ariaLabel="Topo Doctor screen evidence canvas. Select a finding to open its exact source-backed screen."
        connected={props.connected}
        contextLabel={selectedScreen?.source.filePath}
        evidence={evidence}
        interactionMode={props.interactionMode}
        previewBaseUrl={props.previewBaseUrl}
      />
      <aside className="atlas-inspector findings-overlay-list">
        <div className="inspector-titlebar">
          <div>
            <PanelRight size={13} />
            <strong>Findings</strong>
          </div>
          <span>
            {props.graph.findings.length} ACROSS {routeScreens.length} ROUTES
          </span>
        </div>
        {props.graph.findings.map((finding) => {
          const findingScreen = selectFindingScreen(
            props.graph,
            finding,
            selectedScreen?.id,
          );
          return (
            <button
              className={`overlay-finding tone-${findingTone(finding)} ${finding.id === selectedFinding?.id ? "is-selected" : ""}`}
              data-finding-id={finding.id}
              data-screen-id={findingScreen?.id}
              data-source-path={finding.source?.filePath}
              key={finding.id}
              onClick={() => selectFinding(finding)}
              ref={
                finding.id === selectedFinding?.id
                  ? selectedFindingRef
                  : undefined
              }
              type="button"
            >
              <span className="doctor-dot" />
              <div>
                <strong>{finding.title}</strong>
                <code>
                  {finding.source?.filePath ?? "/"} · {finding.description}
                </code>
              </div>
              <span>{finding.confidence.toFixed(2)}</span>
            </button>
          );
        })}
        {props.graph.findings.length === 0 && (
          <p className="doctor-findings-empty">No findings recorded.</p>
        )}
      </aside>
    </div>
  );
}

export function DoctorWorkspace(props: DoctorWorkspaceProps) {
  if (props.view === "findings") return <FindingsOverlay {...props} />;
  return <DoctorReportView {...props} />;
}

function formatLastRun(value: string): string {
  const elapsedMs = Math.max(0, Date.now() - Date.parse(value));
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return "just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
