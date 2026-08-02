import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileCode2,
  FileText,
  Frame,
  Layers3,
  Monitor,
  MoreHorizontal,
  Package,
  Route,
  Search,
  Square,
  StickyNote,
} from "lucide-react";

import type { CanvasInteractionMode } from "@topo/react";
import type { ApplicationGraph, ComponentNode } from "@topo/schema";

import {
  filterEditorComponents,
  filterEditorScreens,
} from "../editor-presentation";
import { selectScreenEvidence, type ScreenEvidence } from "../screen-evidence";
import {
  findingTone,
  type StudioNote,
  type StudioSnapshot,
} from "../studio-model";
import { ScreenEvidenceStage } from "./ScreenEvidenceStage";

interface EditorWorkspaceProps {
  connected: boolean;
  graph: ApplicationGraph;
  interactionMode: CanvasInteractionMode;
  notes: StudioNote[];
  previewBaseUrl: string;
  snapshots: StudioSnapshot[];
  selectedScreenId?: string;
  view: string;
  onNavigate: (path: string) => void;
  onSelectComponent: (id: string) => void;
  onSelectFinding: (id: string) => void;
  onSelectNote: (id: string) => void;
  onSelectScreen: (id: string) => void;
}

interface LayerRowProps {
  chevron?: "down" | "right";
  icon: ReactNode;
  indent?: 0 | 1 | 2 | 3;
  label: string;
  root?: boolean;
  selected?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
}

function LayerRow({
  chevron,
  icon,
  indent = 0,
  label,
  onClick,
  root,
  selected,
  trailing,
}: LayerRowProps) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      className={`editor-layer-row indent-${indent}${selected ? " is-selected" : ""}${root ? " is-root" : ""}`}
      {...(onClick ? { onClick, type: "button" as const } : {})}
    >
      <span className="layer-chevron" aria-hidden="true">
        {chevron === "down" ? (
          <ChevronDown size={11} />
        ) : chevron === "right" ? (
          <ChevronRight size={11} />
        ) : null}
      </span>
      <span className="layer-kind" aria-hidden="true">
        {icon}
      </span>
      <span className="layer-name">{label}</span>
      <span className="layer-trailing">{trailing}</span>
    </Component>
  );
}

function EvidenceTree({
  evidence,
  onNavigate,
  onSelectComponent,
  onSelectFinding,
  onSelectNote,
}: {
  evidence: ScreenEvidence;
  onNavigate: (path: string) => void;
  onSelectComponent: (id: string) => void;
  onSelectFinding: (id: string) => void;
  onSelectNote: (id: string) => void;
}) {
  const screen = evidence.screen;
  if (!screen) {
    return <div className="editor-empty-sidebar">No screens discovered.</div>;
  }
  const openFinding = (findingId: string) => {
    onSelectFinding(findingId);
    onNavigate("/doctor/findings");
  };
  return (
    <div className="editor-layer-tree">
      <LayerRow
        chevron="down"
        icon={<Monitor size={12} />}
        label={screen.title}
        root
        selected
        trailing={<span className="screen-state-dot" />}
      />
      <LayerRow
        icon={<Route size={11} />}
        indent={1}
        label={screen.routePath}
      />
      <LayerRow
        icon={<FileCode2 size={11} />}
        indent={1}
        label={screen.source.filePath}
      />
      <LayerRow
        chevron={evidence.components.length > 0 ? "down" : "right"}
        icon={<Package size={11} />}
        indent={1}
        label="Used components"
        trailing={evidence.components.length}
      />
      {evidence.components.slice(0, 8).map((component) => (
        <LayerRow
          icon={<Box size={10} />}
          indent={2}
          key={component.id}
          label={component.name}
          onClick={() => {
            onSelectComponent(component.id);
            onNavigate("/atlas/components");
          }}
          trailing={
            component.previewStatus === "renderable" ? (
              <CheckCircle2 size={10} />
            ) : (
              <Circle size={8} />
            )
          }
        />
      ))}
      {evidence.components.length > 8 && (
        <LayerRow
          icon={<MoreHorizontal size={10} />}
          indent={2}
          label={`View all ${evidence.components.length} components`}
          onClick={() => onNavigate("/atlas/components")}
        />
      )}
      <LayerRow
        chevron={evidence.findings.length > 0 ? "down" : "right"}
        icon={<AlertTriangle size={11} />}
        indent={1}
        label="Findings"
        onClick={() => {
          const firstFinding = evidence.findings[0];
          if (firstFinding) openFinding(firstFinding.id);
          else onNavigate("/doctor/findings");
        }}
        trailing={evidence.findings.length}
      />
      {evidence.findings.slice(0, 4).map((finding) => (
        <LayerRow
          icon={<Circle size={8} />}
          indent={2}
          key={finding.id}
          label={finding.title}
          onClick={() => openFinding(finding.id)}
          trailing={Math.round(finding.confidence * 100)}
        />
      ))}
      {evidence.findings.length > 4 && (
        <LayerRow
          icon={<MoreHorizontal size={10} />}
          indent={2}
          label={`View all ${evidence.findings.length} findings`}
          onClick={() => onNavigate("/doctor")}
        />
      )}
      <LayerRow
        chevron={evidence.notes.length > 0 ? "down" : "right"}
        icon={<StickyNote size={11} />}
        indent={1}
        label="Notes"
        onClick={() => onNavigate("/notes")}
        trailing={evidence.notes.length}
      />
      {evidence.notes.slice(0, 4).map((note) => (
        <LayerRow
          icon={<FileText size={10} />}
          indent={2}
          key={note.id}
          label={note.title}
          onClick={() => {
            onSelectNote(note.id);
            onNavigate("/notes/detail");
          }}
          trailing={note.status === "resolved" ? "✓" : "•"}
        />
      ))}
      {evidence.notes.length > 4 && (
        <LayerRow
          icon={<MoreHorizontal size={10} />}
          indent={2}
          label={`View all ${evidence.notes.length} notes`}
          onClick={() => onNavigate("/notes")}
        />
      )}
    </div>
  );
}

function ScreenList({
  graph,
  selectedScreenId,
  onSelectScreen,
}: Pick<
  EditorWorkspaceProps,
  "graph" | "selectedScreenId" | "onSelectScreen"
>) {
  const [query, setQuery] = useState("");
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const allScreens = useMemo(
    () => filterEditorScreens(graph.screens, ""),
    [graph.screens],
  );
  const screens = useMemo(
    () => filterEditorScreens(graph.screens, query),
    [graph.screens, query],
  );
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [query, selectedScreenId]);
  return (
    <div
      className="editor-pages"
      data-matched-screens={screens.length}
      data-total-screens={allScreens.length}
    >
      <span className="section-label">
        SCREENS
        <span>
          {screens.length === allScreens.length
            ? allScreens.length
            : `${screens.length} / ${allScreens.length}`}
        </span>
      </span>
      <label
        className="editor-evidence-search"
        htmlFor="topo-editor-screen-search"
      >
        <Search size={11} />
        <input
          aria-label="Search screens"
          id="topo-editor-screen-search"
          name="editor-screen-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search routes or source"
          type="search"
          value={query}
        />
      </label>
      <div className="editor-screen-list">
        {screens.map((screen) => (
          <button
            className={screen.id === selectedScreenId ? "is-selected" : ""}
            data-screen-id={screen.id}
            key={screen.id}
            onClick={() => onSelectScreen(screen.id)}
            ref={screen.id === selectedScreenId ? selectedRowRef : undefined}
            type="button"
          >
            <Route size={10} /> <strong>{screen.routePath}</strong>
            <span>
              {screen.renderStatus === "captured"
                ? "Snapshot"
                : screen.renderStatus}
            </span>
          </button>
        ))}
        {screens.length === 0 && (
          <p className="editor-list-empty">No screen evidence matches.</p>
        )}
      </div>
    </div>
  );
}

function EditorSidebar(
  props: EditorWorkspaceProps & { evidence: ScreenEvidence },
) {
  const assets = props.view === "assets";
  return (
    <aside className="editor-sidebar">
      <div className="editor-tabs">
        <button
          className={!assets ? "is-active" : ""}
          onClick={() => props.onNavigate("/editor/canvas")}
          type="button"
        >
          <Layers3 size={13} /> Evidence
        </button>
        <button
          className={assets ? "is-active" : ""}
          onClick={() => props.onNavigate("/editor/assets")}
          type="button"
        >
          Assets
        </button>
        <button onClick={() => props.onNavigate("/atlas/routes")} type="button">
          Routes
        </button>
      </div>
      {assets ? (
        <AssetsPanel
          components={props.graph.components}
          evidence={props.evidence}
          onNavigate={props.onNavigate}
          onSelectComponent={props.onSelectComponent}
        />
      ) : (
        <>
          <EvidenceTree
            evidence={props.evidence}
            onNavigate={props.onNavigate}
            onSelectComponent={props.onSelectComponent}
            onSelectFinding={props.onSelectFinding}
            onSelectNote={props.onSelectNote}
          />
          <ScreenList
            graph={props.graph}
            onSelectScreen={props.onSelectScreen}
            selectedScreenId={props.evidence.screen?.id}
          />
        </>
      )}
    </aside>
  );
}

function AssetsPanel({
  components,
  evidence,
  onNavigate,
  onSelectComponent,
}: {
  components: ComponentNode[];
  evidence: ScreenEvidence;
  onNavigate: (path: string) => void;
  onSelectComponent: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matchingComponents = useMemo(
    () => filterEditorComponents(components, query),
    [components, query],
  );
  return (
    <div
      className="assets-panel"
      data-matched-components={matchingComponents.length}
      data-total-components={components.length}
    >
      <section>
        <span className="section-label">
          COMPONENT EVIDENCE
          <span>
            {matchingComponents.length === components.length
              ? components.length
              : `${matchingComponents.length} / ${components.length}`}
          </span>
        </span>
        <label
          className="editor-evidence-search"
          htmlFor="topo-editor-asset-search"
        >
          <Search size={11} />
          <input
            aria-label="Search component assets"
            id="topo-editor-asset-search"
            name="editor-asset-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search components"
            type="search"
            value={query}
          />
        </label>
        {matchingComponents.map((component) => (
          <button
            className="asset-component"
            data-component-id={component.id}
            key={component.id}
            onClick={() => {
              onSelectComponent(component.id);
              onNavigate("/atlas/components");
            }}
            type="button"
          >
            <Box size={13} />
            <strong>{component.name}</strong>
            <span>{component.previewStatus}</span>
          </button>
        ))}
        {matchingComponents.length === 0 && (
          <p className="editor-list-empty">No component evidence matches.</p>
        )}
      </section>
      <section>
        <span className="section-label">SOURCE IDENTITY</span>
        <div className="editor-source-list">
          <code>{evidence.screen?.source.filePath ?? "Not discovered"}</code>
          {evidence.components.slice(0, 5).map((component) => (
            <code key={component.id}>{component.source.filePath}</code>
          ))}
        </div>
      </section>
      <section>
        <span className="section-label">CAPTURE EVIDENCE</span>
        <div className="well-card">
          <strong>{evidence.snapshot?.status ?? "No capture"}</strong>
          <span>
            {evidence.snapshot?.contentHash ?? "Run Capture to create evidence"}
          </span>
        </div>
      </section>
    </div>
  );
}

function InsertPanel({
  components,
  onNavigate,
  onSelectComponent,
}: {
  components: ComponentNode[];
  onNavigate: (path: string) => void;
  onSelectComponent: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => filterEditorComponents(components, query),
    [components, query],
  );
  const visible = matches.slice(0, 8);
  return (
    <div
      className="insert-panel"
      data-canvas-interactive
      data-matched-components={matches.length}
      data-rendered-components={visible.length}
      data-total-components={components.length}
    >
      <label
        className="insert-search-wrap"
        htmlFor="topo-editor-component-search"
      >
        <Search size={12} />
        <input
          aria-label="Search component evidence"
          className="insert-search"
          id="topo-editor-component-search"
          name="editor-component-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search component evidence"
          value={query}
        />
      </label>
      <span className="section-label insert-results-label">
        DISCOVERED COMPONENTS
        <span>
          {visible.length} / {matches.length}
        </span>
      </span>
      <div className="insert-grid">
        {visible.map((component, index) => (
          <button
            className={index === 0 ? "is-active" : ""}
            key={component.id}
            onClick={() => {
              onSelectComponent(component.id);
              onNavigate("/atlas/components");
            }}
            type="button"
          >
            {component.previewStatus === "renderable" ? (
              <Frame size={20} />
            ) : (
              <Square size={20} />
            )}
            <span>{component.name}</span>
          </button>
        ))}
      </div>
      {matches.length === 0 && (
        <p className="editor-list-empty">No component evidence matches.</p>
      )}
      {matches.length > visible.length && (
        <button
          className="insert-view-all"
          onClick={() => onNavigate("/atlas/components")}
          type="button"
        >
          View all {matches.length} matching components
          <ChevronRight size={11} />
        </button>
      )}
      <p className="insert-evidence-note">
        Topo opens source-backed previews; it never inserts visual edits into
        your application.
      </p>
    </div>
  );
}

function PropertyInspector({
  evidence,
  onNavigate,
  onSelectComponent,
  onSelectFinding,
  onSelectNote,
}: {
  evidence: ScreenEvidence;
  onNavigate: (path: string) => void;
  onSelectComponent: (id: string) => void;
  onSelectFinding: (id: string) => void;
  onSelectNote: (id: string) => void;
}) {
  const screen = evidence.screen;
  const snapshot = evidence.snapshot;
  return (
    <aside className="property-inspector">
      <div className="property-heading">
        <div>
          <Monitor size={13} />
          <strong>{screen?.title ?? "Screen evidence"}</strong>
        </div>
        <span>{screen?.state ?? "unseen"}</span>
      </div>
      <section>
        <span className="section-label">SOURCE</span>
        <dl className="property-list">
          <div>
            <dt>Route</dt>
            <dd>{screen?.routePath ?? "Not discovered"}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd>{screen?.source.filePath ?? "Not discovered"}</dd>
          </div>
          <div>
            <dt>Framework</dt>
            <dd>{screen?.framework ?? "unknown"}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{screen?.state ?? "unknown"}</dd>
          </div>
        </dl>
      </section>
      <section>
        <span className="section-label">CAPTURE</span>
        <div className="well-card horizontal">
          <div>
            <strong>
              {snapshot?.status ?? screen?.renderStatus ?? "unseen"}
            </strong>
            <span>
              {snapshot?.width && snapshot.height
                ? `${snapshot.width} × ${snapshot.height}`
                : "No dimensions recorded"}
            </span>
          </div>
          <code>{snapshot?.contentHash?.slice(0, 8) ?? "—"}</code>
        </div>
      </section>
      <section>
        <span className="section-label section-count">
          USED COMPONENTS <span>{evidence.components.length}</span>
        </span>
        <div className="editor-inspector-list">
          {evidence.components.length === 0 && <span>None recorded</span>}
          {evidence.components.slice(0, 6).map((component) => (
            <button
              key={component.id}
              onClick={() => {
                onSelectComponent(component.id);
                onNavigate("/atlas/components");
              }}
              type="button"
            >
              <Box size={11} /> {component.name}
              <span>{component.previewStatus}</span>
            </button>
          ))}
          {evidence.components.length > 6 && (
            <button
              onClick={() => onNavigate("/atlas/components")}
              type="button"
            >
              <MoreHorizontal size={11} /> View all {evidence.components.length}
              <span>Components</span>
            </button>
          )}
        </div>
      </section>
      <section>
        <span className="section-label section-count">
          FINDINGS <span>{evidence.findings.length}</span>
        </span>
        {evidence.findings.length === 0 ? (
          <div className="well-card">
            <span>No source-matched findings.</span>
          </div>
        ) : (
          evidence.findings.slice(0, 2).map((finding) => (
            <button
              className={`finding-card tone-${findingTone(finding)}`}
              data-finding-id={finding.id}
              key={finding.id}
              onClick={() => {
                onSelectFinding(finding.id);
                onNavigate("/doctor/findings");
              }}
              type="button"
            >
              <div className="finding-title-row">
                <strong>{finding.title}</strong>
                <code>{finding.confidence.toFixed(2)}</code>
              </div>
              <p>{finding.description}</p>
            </button>
          ))
        )}
        {evidence.findings.length > 2 && (
          <button
            className="editor-disclosure-action"
            onClick={() => onNavigate("/doctor")}
            type="button"
          >
            View all {evidence.findings.length} findings
            <ChevronRight size={11} />
          </button>
        )}
      </section>
      <section>
        <span className="section-label section-count">
          NOTES <span>{evidence.notes.length}</span>
        </span>
        <div className="editor-inspector-list">
          {evidence.notes.length === 0 && <span>No notes on this screen.</span>}
          {evidence.notes.slice(0, 3).map((note) => (
            <button
              key={note.id}
              onClick={() => {
                onSelectNote(note.id);
                onNavigate("/notes/detail");
              }}
              type="button"
            >
              <StickyNote size={11} /> {note.title}
              <span>{note.status}</span>
            </button>
          ))}
          {evidence.notes.length > 3 && (
            <button onClick={() => onNavigate("/notes")} type="button">
              <MoreHorizontal size={11} /> View all {evidence.notes.length}
              <span>Notes</span>
            </button>
          )}
        </div>
      </section>
    </aside>
  );
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const evidence = useMemo(
    () =>
      selectScreenEvidence({
        graph: props.graph,
        notes: props.notes,
        snapshots: props.snapshots,
        selectedScreenId: props.selectedScreenId,
      }),
    [props.graph, props.notes, props.selectedScreenId, props.snapshots],
  );
  return (
    <div className="editor-view">
      <EditorSidebar {...props} evidence={evidence} />
      <ScreenEvidenceStage
        connected={props.connected}
        evidence={evidence}
        interactionMode={props.interactionMode}
        overlay={
          props.view === "insert" ? (
            <InsertPanel
              components={props.graph.components}
              onNavigate={props.onNavigate}
              onSelectComponent={props.onSelectComponent}
            />
          ) : undefined
        }
        previewBaseUrl={props.previewBaseUrl}
      />
      <PropertyInspector
        evidence={evidence}
        onNavigate={props.onNavigate}
        onSelectComponent={props.onSelectComponent}
        onSelectFinding={props.onSelectFinding}
        onSelectNote={props.onSelectNote}
      />
    </div>
  );
}
