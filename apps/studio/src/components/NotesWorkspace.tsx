import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PanelRight,
  Pencil,
  Route,
  Search,
  X,
} from "lucide-react";

import { compareRouteScreens } from "@topo/canvas-engine";
import type { CanvasInteractionMode } from "@topo/react";
import { inspectPreviewAnchor } from "@topo/runtime-bridge";
import type {
  ApplicationGraph,
  ScreenNode,
  UpdateNoteInput,
} from "@topo/schema";

import {
  createPlacedNoteUpdate,
  normalizeArtboardPoint,
  resolveNotePlacement,
  type NormalizedPoint,
  type NotePlacementMode,
} from "../note-placement";
import {
  selectNoteScreen,
  selectScreenEvidence,
  type ScreenEvidence,
} from "../screen-evidence";
import {
  createScreenNoteAnchor,
  filterStudioNotes,
  getNoteAnchorSignalRows,
  noteAnchorStatus,
  searchStudioNotes,
  type StudioNote,
  type StudioNoteFilter,
  type StudioSnapshot,
} from "../studio-model";
import { ScreenEvidenceStage } from "./ScreenEvidenceStage";

interface NotesWorkspaceProps {
  view: string;
  connected: boolean;
  graph: ApplicationGraph;
  interactionMode: CanvasInteractionMode;
  notes: StudioNote[];
  previewBaseUrl: string;
  snapshots: StudioSnapshot[];
  selectedNoteId?: string;
  busyAction?: string;
  onSelectNote: (id: string) => void;
  onNavigate: (path: string) => void;
  onUpdateNote: (
    id: string,
    input: UpdateNoteInput,
  ) => Promise<StudioNote | undefined>;
  onDeleteNote: (id: string) => Promise<boolean | undefined>;
  onSelectScreen: (id: string) => void;
}

function formatRelativeTime(timestamp: string): string {
  const milliseconds = Math.max(0, Date.now() - Date.parse(timestamp));
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

function NoteStatusDot({ note }: { note: StudioNote }) {
  const tone = note.status === "resolved" ? "resolved" : noteAnchorStatus(note);
  return <span className={`note-status-dot is-${tone}`} />;
}

function AllNotesView({
  notes,
  onSelectNote,
  onNavigate,
}: NotesWorkspaceProps) {
  const [filter, setFilter] = useState<StudioNoteFilter>("all");
  const [query, setQuery] = useState("");
  const open = filterStudioNotes(notes, "open");
  const drifted = filterStudioNotes(notes, "drifted");
  const resolved = filterStudioNotes(notes, "resolved");
  const filteredNotes = useMemo(
    () => searchStudioNotes(notes, filter, query),
    [filter, notes, query],
  );
  const title =
    filter === "all"
      ? "All notes"
      : filter === "element"
        ? "Element pins"
        : filter === "screen"
          ? "Screen notes"
          : filter === "flow"
            ? "Flow notes"
            : `${filter[0]!.toUpperCase()}${filter.slice(1)} notes`;

  return (
    <div className="notes-index-view">
      <aside className="filter-sidebar">
        <span className="section-label">STATUS</span>
        {[
          ["all", "All notes", notes.length],
          ["open", "Open", open.length],
          ["drifted", "Drifted", drifted.length],
          ["resolved", "Resolved", resolved.length],
        ].map(([value, label, count]) => (
          <button
            className={filter === value ? "is-selected" : ""}
            key={String(label)}
            onClick={() => setFilter(value as StudioNoteFilter)}
            type="button"
          >
            <span>{String(label)}</span>
            <small>{String(count)}</small>
          </button>
        ))}
        <span className="section-label">ANCHOR</span>
        {[
          ["element", "Element pin"],
          ["screen", "Screen note"],
          ["flow", "Flow note"],
        ].map(([value, label]) => (
          <button
            className={filter === value ? "is-selected" : ""}
            key={label}
            onClick={() => setFilter(value as StudioNoteFilter)}
            type="button"
          >
            <span>{label}</span>
            <small>{notes.filter((note) => note.type === value).length}</small>
          </button>
        ))}
      </aside>
      <main className="notes-list-panel">
        <header className="notes-index-header">
          <div className="notes-index-heading">
            <h1>{title}</h1>
            <span>
              {filteredNotes.length} shown · {notes.length} stored as Markdown
              in .topo/notes
            </span>
          </div>
          <label className="notes-index-search" htmlFor="topo-notes-search">
            <Search aria-hidden="true" size={12} />
            <input
              aria-label="Search notes"
              id="topo-notes-search"
              name="notes-search"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search notes"
              type="search"
              value={query}
            />
            {query && (
              <button
                aria-label="Clear note search"
                onClick={() => setQuery("")}
                type="button"
              >
                <X size={11} />
              </button>
            )}
          </label>
        </header>
        <div className="notes-table">
          {filteredNotes.map((note) => (
            <button
              data-anchor-status={noteAnchorStatus(note)}
              data-note-id={note.id}
              data-note-status={note.status}
              data-note-type={note.type}
              key={note.id}
              onClick={() => {
                onSelectNote(note.id);
                onNavigate("/notes/detail");
              }}
              type="button"
            >
              <NoteStatusDot note={note} />
              <div className="note-row-copy">
                <strong>{note.title}</strong>
                <code>
                  {note.targetRoute ?? ".topo/notes"}
                  {noteAnchorStatus(note) === "drifted"
                    ? ` · anchor drifted${note.anchor?.driftPixels !== undefined ? ` ${note.anchor.driftPixels}px` : ""}`
                    : ` · ${noteAnchorStatus(note)}`}
                </code>
              </div>
              <span className="note-type-chip">
                {note.type} {note.type === "element" ? "pin" : "note"}
              </span>
              <small>
                {note.author ?? "local"} · {formatRelativeTime(note.updatedAt)}
              </small>
            </button>
          ))}
          {filteredNotes.length === 0 && (
            <div className="empty-notes-state">
              No notes match this view. The Markdown source remains unchanged.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function MiniRouteTree({
  graph,
  onNavigate,
  onSelectScreen,
  screen,
}: {
  graph: ApplicationGraph;
  onNavigate: (path: string) => void;
  onSelectScreen: (id: string) => void;
  screen?: ScreenNode;
}) {
  const selectedRouteRef = useRef<HTMLButtonElement>(null);
  const routeScreens = graph.screens
    .filter((candidate) => candidate.state === "default")
    .sort(compareRouteScreens);

  useEffect(() => {
    selectedRouteRef.current?.scrollIntoView({ block: "nearest" });
  }, [screen?.id]);

  return (
    <aside className="atlas-sidebar note-detail-tree">
      <div className="atlas-tabs">
        <button
          className="is-active"
          onClick={() => onNavigate("/atlas/routes")}
          type="button"
        >
          Routes
        </button>
        <button onClick={() => onNavigate("/atlas/components")} type="button">
          Components
        </button>
        <button onClick={() => onNavigate("/atlas/flows")} type="button">
          Flows
        </button>
      </div>
      <div className="tree-scroll">
        <div className="tree-row tree-root">
          <ChevronDown size={11} />
          <strong>app</strong>
        </div>
        {routeScreens.map((item) => {
          const routeDepth = item.routePath.split("/").filter(Boolean).length;
          const indent = Math.min(3, routeDepth + 1);
          return (
            <button
              aria-label={`Use ${item.routePath} as the note screen`}
              className={`tree-row tree-file indent-${indent} ${item.id === screen?.id ? "is-selected" : ""}`}
              key={item.id}
              onClick={() => onSelectScreen(item.id)}
              ref={item.id === screen?.id ? selectedRouteRef : undefined}
              title={`${item.routePath} · ${item.source.filePath}`}
              type="button"
            >
              <Route size={11} />
              <span>{item.routePath}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function NoteDetailView(props: NotesWorkspaceProps) {
  const note =
    props.notes.find((item) => item.id === props.selectedNoteId) ??
    props.notes[0];
  const anchoredScreen = selectNoteScreen(props.graph, note);
  const [candidateScreenId, setCandidateScreenId] = useState<
    string | undefined
  >(anchoredScreen?.id);
  const screen = props.graph.screens.find(
    (candidate) => candidate.id === candidateScreenId,
  );
  const evidence = useMemo<ScreenEvidence>(
    () =>
      screen
        ? selectScreenEvidence({
            graph: props.graph,
            notes: props.notes,
            snapshots: props.snapshots,
            selectedScreenId: screen.id,
          })
        : { components: [], findings: [], notes: [] },
    [props.graph, props.notes, props.snapshots, screen],
  );
  const anchorRows = note ? getNoteAnchorSignalRows(note) : [];
  const anchorCount = anchorRows.filter((row) => row.present).length;
  const noteIndex = note
    ? props.notes.findIndex((candidate) => candidate.id === note.id) + 1
    : 0;
  const previousNote = noteIndex > 1 ? props.notes[noteIndex - 2] : undefined;
  const nextNote =
    noteIndex > 0 && noteIndex < props.notes.length
      ? props.notes[noteIndex]
      : undefined;
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [placementMode, setPlacementMode] = useState<NotePlacementMode>();
  const [placementDraft, setPlacementDraft] = useState<{
    start: NormalizedPoint;
    current: NormalizedPoint;
  }>();
  const placementStart = useRef<NormalizedPoint | undefined>(undefined);
  const liveFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [placementPending, setPlacementPending] = useState(false);
  const noteBusy = props.busyAction?.startsWith("note") === true;
  const placementBusy = noteBusy || placementPending;
  const placementCoordinates =
    placementMode && placementDraft
      ? resolveNotePlacement(
          placementMode,
          placementDraft.start,
          placementDraft.current,
        )
      : undefined;

  useEffect(() => {
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
    setEditing(false);
    setConfirmDelete(false);
    setPlacementMode(undefined);
    setPlacementDraft(undefined);
    setPlacementPending(false);
    placementStart.current = undefined;
  }, [note?.id, note?.title, note?.body, note?.updatedAt]);

  useEffect(() => {
    setCandidateScreenId(anchoredScreen?.id);
  }, [anchoredScreen?.id, note?.id]);

  useEffect(() => {
    if (!placementMode) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || placementPending) return;
      setPlacementMode(undefined);
      setPlacementDraft(undefined);
      placementStart.current = undefined;
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [placementMode, placementPending]);

  if (!note) {
    return (
      <div className="notes-empty-detail">
        <strong>No notes yet</strong>
        <p>Create a screen note from the annotation palette to begin.</p>
        <button onClick={() => props.onNavigate("/notes")} type="button">
          Back to notes
        </button>
      </div>
    );
  }

  const save = async () => {
    if (!title.trim()) return;
    const updated = await props.onUpdateNote(note.id, {
      title: title.trim(),
      body,
    });
    if (updated) setEditing(false);
  };
  const closeEditor = () => {
    setTitle(note.title);
    setBody(note.body);
    setConfirmDelete(false);
    setEditing(false);
  };
  const toggleResolved = async () => {
    await props.onUpdateNote(note.id, {
      status: note.status === "resolved" ? "open" : "resolved",
    });
  };
  const reanchor = async () => {
    if (!screen) return;
    await props.onUpdateNote(note.id, {
      targetKind: "screen",
      targetId: screen.id,
      targetRoute: screen.routePath,
      anchor: createScreenNoteAnchor(note, screen, new Date().toISOString()),
    });
  };
  const cancelPlacement = () => {
    setPlacementMode(undefined);
    setPlacementDraft(undefined);
    setPlacementPending(false);
    placementStart.current = undefined;
  };
  const beginPlacement = (mode: NotePlacementMode) => {
    if (!screen || placementBusy) return;
    setPlacementMode(mode);
    setPlacementDraft(undefined);
    placementStart.current = undefined;
  };
  const pointerPoint = (event: ReactPointerEvent<HTMLDivElement>) =>
    normalizeArtboardPoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    );
  const startPlacement = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!placementMode || placementBusy) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPoint(event);
    placementStart.current = point;
    setPlacementDraft({ start: point, current: point });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePlacement = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!placementMode || !placementStart.current || placementBusy) return;
    event.preventDefault();
    event.stopPropagation();
    setPlacementDraft({
      start: placementStart.current,
      current: pointerPoint(event),
    });
  };
  const finishPlacement = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!placementMode || !placementStart.current || !screen || placementBusy) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const start = placementStart.current;
    const current = pointerPoint(event);
    const coordinates = resolveNotePlacement(placementMode, start, current);
    placementStart.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!coordinates) {
      setPlacementDraft(undefined);
      return;
    }

    setPlacementDraft({ start, current });
    setPlacementPending(true);
    try {
      const frame = liveFrameRef.current;
      const inspection =
        placementMode === "point" && frame?.contentWindow
          ? await inspectPreviewAnchor({
              hostWindow: window,
              targetWindow: frame.contentWindow,
              targetOrigin: new URL(frame.src).origin,
              point: coordinates,
            })
          : undefined;
      const updated = await props.onUpdateNote(
        note.id,
        createPlacedNoteUpdate(
          screen,
          coordinates,
          new Date().toISOString(),
          inspection,
        ),
      );
      if (updated) cancelPlacement();
    } finally {
      setPlacementPending(false);
    }
  };
  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (await props.onDeleteNote(note.id)) props.onNavigate("/notes");
  };

  return (
    <div
      className="three-pane note-detail-view"
      data-anchor-status={noteAnchorStatus(note)}
      data-attached-screen-id={anchoredScreen?.id}
      data-candidate-screen-id={screen?.id}
      data-note-id={note.id}
    >
      <MiniRouteTree
        graph={props.graph}
        onNavigate={props.onNavigate}
        onSelectScreen={(id) => {
          cancelPlacement();
          setCandidateScreenId(id);
          props.onSelectScreen(id);
        }}
        screen={screen}
      />
      <ScreenEvidenceStage
        ariaLabel="Topo note evidence canvas. Select a route to inspect or re-anchor the Markdown note."
        artboardOverlay={
          <>
            {!placementMode &&
              anchoredScreen?.id === screen?.id &&
              note.anchor?.coordinates && (
                <span
                  aria-label="Recorded note anchor"
                  className={`note-evidence-anchor ${note.anchor.coordinates.width && note.anchor.coordinates.height ? "is-region" : "is-point"} is-${noteAnchorStatus(note)}`}
                  data-anchor-status={noteAnchorStatus(note)}
                  data-anchor-x={note.anchor.coordinates.x}
                  data-anchor-y={note.anchor.coordinates.y}
                  data-note-id={note.id}
                  style={{
                    left: `${note.anchor.coordinates.x * 100}%`,
                    top: `${note.anchor.coordinates.y * 100}%`,
                    ...(note.anchor.coordinates.width
                      ? { width: `${note.anchor.coordinates.width * 100}%` }
                      : {}),
                    ...(note.anchor.coordinates.height
                      ? { height: `${note.anchor.coordinates.height * 100}%` }
                      : {}),
                  }}
                >
                  <span>{noteIndex}</span>
                </span>
              )}
            {placementMode && (
              <div
                aria-label={
                  placementMode === "point"
                    ? "Click the screen to place this element pin"
                    : "Drag across the screen to place this region note"
                }
                className={`note-placement-surface is-${placementMode}`}
                data-canvas-interactive="true"
                data-note-placement-inspection={
                  placementPending ? "pending" : "ready"
                }
                data-note-placement-mode={placementMode}
                onPointerCancel={() => {
                  placementStart.current = undefined;
                  setPlacementDraft(undefined);
                }}
                onPointerDown={startPlacement}
                onPointerMove={movePlacement}
                onPointerUp={(event) => void finishPlacement(event)}
                role="application"
              >
                <span className="note-placement-instruction">
                  {placementPending
                    ? "Reading live element evidence…"
                    : placementMode === "point"
                      ? "Click to place pin · Esc to cancel"
                      : "Drag to mark region · Esc to cancel"}
                </span>
                {placementCoordinates && (
                  <span
                    aria-label="Note placement preview"
                    className={`note-evidence-anchor is-${placementMode} is-preview`}
                    data-anchor-x={placementCoordinates.x}
                    data-anchor-y={placementCoordinates.y}
                    style={{
                      left: `${placementCoordinates.x * 100}%`,
                      top: `${placementCoordinates.y * 100}%`,
                      ...(placementCoordinates.width
                        ? { width: `${placementCoordinates.width * 100}%` }
                        : {}),
                      ...(placementCoordinates.height
                        ? { height: `${placementCoordinates.height * 100}%` }
                        : {}),
                    }}
                  >
                    <span>{noteIndex}</span>
                  </span>
                )}
              </div>
            )}
          </>
        }
        connected={props.connected}
        contextLabel={
          screen
            ? `${anchoredScreen?.id === screen.id ? "Attached" : "Candidate"} · ${screen.source.filePath}`
            : "Unbound Markdown note"
        }
        evidence={evidence}
        interactionMode={props.interactionMode}
        liveFrameRef={liveFrameRef}
        previewBaseUrl={props.previewBaseUrl}
      />
      <aside className="atlas-inspector note-detail-inspector">
        <div className="inspector-titlebar">
          <div>
            <PanelRight size={13} />
            <strong>Note</strong>
          </div>
          <div className="note-inspector-navigation">
            <button
              aria-label="Previous note"
              disabled={!previousNote}
              onClick={() =>
                previousNote && props.onSelectNote(previousNote.id)
              }
              type="button"
            >
              <ChevronLeft size={12} />
            </button>
            <span>
              {noteIndex} of {props.notes.length}
            </span>
            <button
              aria-label="Next note"
              disabled={!nextNote}
              onClick={() => nextNote && props.onSelectNote(nextNote.id)}
              type="button"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
        <section>
          <span className="section-label">SOURCE</span>
          <div className="well-card">
            <code>.topo/notes/{encodeURIComponent(note.id)}.md</code>
            <span>
              {note.type} · {note.status} · {note.author ?? "local"} ·{" "}
              {formatRelativeTime(note.updatedAt)}
            </span>
          </div>
        </section>
        <section>
          <div className="flow-section-heading">
            <span className="section-label">NOTE</span>
            <button
              aria-expanded={editing}
              className="inspector-inline-action"
              disabled={noteBusy}
              onClick={() => (editing ? closeEditor() : setEditing(true))}
              type="button"
            >
              <Pencil size={10} />
              {editing ? "Close" : "Edit"}
            </button>
          </div>
          {!editing && (
            <article className="note-body-card note-read-card">
              <strong>{note.title}</strong>
              <p>{note.body || "No note body recorded."}</p>
            </article>
          )}
          {editing && (
            <article className="note-body-card note-editor-card">
              <label className="sr-only" htmlFor="topo-note-title">
                Note title
              </label>
              <textarea
                aria-label="Note title"
                className="note-editor-input"
                disabled={noteBusy}
                id="topo-note-title"
                name="note-title"
                onChange={(event) => setTitle(event.target.value)}
                rows={3}
                value={title}
              />
              <label className="sr-only" htmlFor="topo-note-body">
                Note body
              </label>
              <textarea
                aria-label="Note body"
                className="note-editor-body"
                disabled={noteBusy}
                id="topo-note-body"
                name="note-body"
                onChange={(event) => setBody(event.target.value)}
                rows={5}
                value={body}
              />
              <div className="note-editor-actions">
                <button
                  disabled={
                    noteBusy ||
                    !title.trim() ||
                    (title.trim() === note.title && body === note.body)
                  }
                  onClick={() => void save()}
                  type="button"
                >
                  {noteBusy ? "Saving…" : "Save changes"}
                </button>
                <button
                  className="is-subtle"
                  disabled={noteBusy}
                  onClick={closeEditor}
                  type="button"
                >
                  Cancel
                </button>
              </div>
              <button
                className="note-delete-action danger-button"
                disabled={noteBusy}
                onClick={() => void remove()}
                type="button"
              >
                {confirmDelete ? "Confirm delete" : "Delete note"}
              </button>
            </article>
          )}
        </section>
        <section>
          <span className="section-label section-count">
            ANCHOR
            <span className={`anchor-state-chip is-${noteAnchorStatus(note)}`}>
              {anchorCount} of 6 recorded · {noteAnchorStatus(note)}
            </span>
          </span>
          <dl className="property-list anchor-list">
            {anchorRows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd
                  className={row.present ? "" : "is-missing"}
                  title={row.value}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {(note.type === "element" || note.type === "region") && (
            <div className="note-placement-controls">
              <button
                className={placementMode ? "is-active" : ""}
                data-note-placement-action={
                  note.type === "element" ? "point" : "region"
                }
                disabled={placementBusy || !screen}
                onClick={() =>
                  placementMode
                    ? cancelPlacement()
                    : beginPlacement(
                        note.type === "element" ? "point" : "region",
                      )
                }
                type="button"
              >
                {placementPending
                  ? "Reading element…"
                  : placementMode
                    ? "Cancel placement"
                    : note.type === "element"
                      ? note.anchor?.coordinates
                        ? "Move pin"
                        : "Place pin"
                      : note.anchor?.coordinates
                        ? "Redraw region"
                        : "Draw region"}
              </button>
              <span>
                {screen
                  ? note.type === "element"
                    ? `Records normalized coordinates on ${screen.routePath}; live previews also contribute semantic evidence.`
                    : `Records normalized coordinates on ${screen.routePath}.`
                  : "Select a route before placing this note."}
              </span>
            </div>
          )}
          <div className="detail-actions">
            <button
              disabled={noteBusy || !screen}
              onClick={() => void reanchor()}
              type="button"
            >
              Re-anchor
            </button>
            <button
              className="primary-button"
              disabled={noteBusy}
              onClick={() => void toggleResolved()}
              type="button"
            >
              {note.status === "resolved" ? "Reopen" : "Resolve"}
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}

export function NotesWorkspace(props: NotesWorkspaceProps) {
  if (props.view === "detail") return <NoteDetailView {...props} />;
  return <AllNotesView {...props} />;
}
