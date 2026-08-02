import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  Route,
  Search,
  StickyNote,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";

import type { ApplicationGraph } from "@topo/schema";
import type { StudioSearchKind, StudioSearchMatch } from "@topo/studio-api";
import { createStudioSearchIndex } from "@topo/studio-api/search";

import type { ReviewExportOptions } from "../studio-model";
import {
  hasProjectEvidence,
  presentFramework,
  presentProject,
  presentWelcome,
} from "../studio-presentation";
import type { TopoDataMode } from "../useTopoData";
import {
  createStudioProjectSearchRecords,
  type StudioProjectSearchSources,
} from "../studio-search";
import { TopoMark } from "./Chrome";

interface OverlayFrameProps {
  children: ReactNode;
  onClose: () => void;
  className?: string;
}

function OverlayFrame({
  children,
  onClose,
  className = "",
}: OverlayFrameProps) {
  return (
    <div
      className={`modal-scrim ${className}`}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="presentation"
    >
      {children}
    </div>
  );
}

export interface StudioNavigationItem {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
}

export interface StudioCommandItem {
  id: string;
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  closePalette: boolean;
  disabled?: boolean;
  disabledReason?: string;
  run(): void | Promise<void>;
}

export function DestinationMenu({
  active,
  destinations,
  onClose,
  onNavigate,
}: {
  active: string;
  destinations: readonly StudioNavigationItem[];
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <OverlayFrame className="nav-menu-scrim" onClose={onClose}>
      <div className="destination-menu">
        <span className="section-label">GO TO</span>
        {destinations.map((destination) => {
          const Icon = destination.icon;
          return (
            <button
              className={active === destination.id ? "is-selected" : ""}
              key={destination.id}
              onClick={() => onNavigate(destination.path)}
              type="button"
            >
              <Icon size={15} />
              <span>
                <strong>{destination.label}</strong>
                <small>{destination.description}</small>
              </span>
              {active === destination.id && <Check size={13} />}
            </button>
          );
        })}
      </div>
    </OverlayFrame>
  );
}

export function CommandPalette({
  commands,
  destinations,
  onClose,
  onNavigate,
  onSelectResult,
  searchSources,
  destinationIds,
}: {
  commands: readonly StudioCommandItem[];
  destinations: readonly StudioNavigationItem[];
  destinationIds: readonly string[];
  onClose: () => void;
  onNavigate: (path: string) => void;
  onSelectResult: (result: StudioSearchMatch) => void;
  searchSources: StudioProjectSearchSources;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const commandShortcut =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘K"
      : "Ctrl K";
  const searchRecords = useMemo(() => {
    const availableDestinations = new Set(destinationIds);
    return createStudioProjectSearchRecords(searchSources).filter((record) =>
      availableDestinations.has(record.target.destinationId),
    );
  }, [destinationIds, searchSources]);
  const searchIndex = useMemo(
    () => createStudioSearchIndex(searchRecords),
    [searchRecords],
  );
  const needle = query.trim().toLocaleLowerCase();
  const matchingCommands = commands.filter((command) =>
    command.label.toLocaleLowerCase().includes(needle),
  );
  const visibleCommands = matchingCommands.filter(
    (command) => !command.disabled,
  );
  const unavailableCommands = matchingCommands.filter(
    (command) => command.disabled,
  );
  const visibleDestinations = destinations.filter((destination) =>
    `${destination.label} ${destination.description}`
      .toLocaleLowerCase()
      .includes(needle),
  );
  const visibleProjectResults = searchIndex.search(query, { limit: 14 });
  const destinationOffset = visibleCommands.length;
  const projectOffset = destinationOffset + visibleDestinations.length;
  const totalVisible = projectOffset + visibleProjectResults.length;

  useEffect(() => setActiveIndex(0), [query]);

  const runCommand = (command: StudioCommandItem) => {
    if (command.disabled) return;
    void command.run();
    if (command.closePalette) onClose();
  };
  const runDestination = (destination: StudioNavigationItem) => {
    onNavigate(destination.path);
  };
  const runProjectResult = (result: StudioSearchMatch) => {
    onSelectResult(result);
    onClose();
  };
  const runActive = () => {
    if (activeIndex < visibleCommands.length) {
      const command = visibleCommands[activeIndex];
      if (command) runCommand(command);
      return;
    }
    if (activeIndex < projectOffset) {
      const destination = visibleDestinations[activeIndex - destinationOffset];
      if (destination) runDestination(destination);
      return;
    }
    const result = visibleProjectResults[activeIndex - projectOffset];
    if (result) runProjectResult(result);
  };

  return (
    <OverlayFrame onClose={onClose}>
      <div
        aria-label="Search Topo"
        aria-modal="true"
        className="command-palette"
        role="dialog"
      >
        <div className="command-search">
          <label htmlFor="topo-command-search">
            <Search size={16} />
            <input
              aria-label="Search project, destinations, and actions"
              autoFocus
              id="topo-command-search"
              name="command-search"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  if (totalVisible > 0) {
                    setActiveIndex((current) => (current + 1) % totalVisible);
                  }
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  if (totalVisible > 0) {
                    setActiveIndex(
                      (current) => (current - 1 + totalVisible) % totalVisible,
                    );
                  }
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  runActive();
                }
              }}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search routes, components, APIs, flows, notes, findings, and actions..."
              value={query}
            />
          </label>
          <kbd>{commandShortcut}</kbd>
          <button
            aria-label="Close search"
            className="command-close"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
        <div className="command-results">
          {visibleCommands.length > 0 && (
            <section>
              <span className="section-label">ACTIONS</span>
              {visibleCommands.map((command, index) => {
                const Icon = command.icon;
                return (
                  <button
                    aria-disabled={command.disabled}
                    className={index === activeIndex ? "is-selected" : ""}
                    disabled={command.disabled}
                    key={command.id}
                    onClick={() => runCommand(command)}
                    onMouseMove={() => setActiveIndex(index)}
                    title={command.disabledReason}
                    type="button"
                  >
                    <Icon size={14} />
                    <strong>{command.label}</strong>
                    {command.shortcut && <kbd>{command.shortcut}</kbd>}
                  </button>
                );
              })}
            </section>
          )}
          {unavailableCommands.length > 0 && (
            <section className="command-unavailable">
              <span className="section-label">UNAVAILABLE</span>
              {unavailableCommands.map((command) => {
                const Icon = command.icon;
                return (
                  <button
                    disabled
                    key={command.id}
                    title={command.disabledReason}
                    type="button"
                  >
                    <Icon size={14} />
                    <span>
                      <strong>{command.label}</strong>
                      <small>{command.disabledReason}</small>
                    </span>
                  </button>
                );
              })}
            </section>
          )}
          {visibleDestinations.length > 0 && (
            <section>
              <span className="section-label">GO TO</span>
              {visibleDestinations.map((destination, index) => {
                const Icon = destination.icon;
                const resultIndex = destinationOffset + index;
                return (
                  <button
                    className={resultIndex === activeIndex ? "is-selected" : ""}
                    key={destination.id}
                    onClick={() => runDestination(destination)}
                    onMouseMove={() => setActiveIndex(resultIndex)}
                    type="button"
                  >
                    <Icon size={14} />
                    <strong>{destination.label}</strong>
                  </button>
                );
              })}
            </section>
          )}
          {visibleProjectResults.length > 0 && (
            <section className="project-search-results">
              <span className="section-label">PROJECT RESULTS</span>
              {visibleProjectResults.map((result, index) => {
                const resultIndex = projectOffset + index;
                const Icon = searchResultIcon(result.kind);
                return (
                  <button
                    className={resultIndex === activeIndex ? "is-selected" : ""}
                    key={result.id}
                    onClick={() => runProjectResult(result)}
                    onMouseMove={() => setActiveIndex(resultIndex)}
                    type="button"
                  >
                    <Icon size={14} />
                    <span>
                      <strong>{result.title}</strong>
                      <small>{result.description}</small>
                    </span>
                    <code>{searchKindLabel(result.kind)}</code>
                  </button>
                );
              })}
            </section>
          )}
          {totalVisible === 0 && (
            <section className="command-empty-state">
              <span className="section-label">NO MATCHES</span>
              <p>Try a route path, component, note, flow, or source file.</p>
            </section>
          )}
        </div>
      </div>
    </OverlayFrame>
  );
}

function searchResultIcon(kind: StudioSearchKind): LucideIcon {
  switch (kind) {
    case "route":
    case "api-endpoint":
    case "interaction":
      return Route;
    case "component":
      return Box;
    case "flow":
    case "flow-step":
      return GitBranch;
    case "note":
      return StickyNote;
    case "finding":
      return AlertCircle;
    case "doctor-check":
      return CheckCircle2;
  }
}

function searchKindLabel(kind: StudioSearchKind): string {
  return kind.replace("-", " ").toUpperCase();
}

export function WelcomeOverlay({
  graph,
  flows,
  mode,
  onClose,
  onNavigate,
}: {
  graph: ApplicationGraph;
  flows: number;
  mode: TopoDataMode;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const presentation = presentWelcome(mode, graph);
  return (
    <OverlayFrame onClose={onClose}>
      <div className="welcome-card">
        <div className="welcome-mark">
          <TopoMark size={22} />
        </div>
        <h1>Welcome to Topo</h1>
        <p>{presentation.introduction}</p>
        <div className="welcome-stats">
          {[
            [graph.screens.length, "ROUTES"],
            [graph.components.length, "COMPONENTS"],
            [flows, "FLOWS"],
            [graph.findings.length, "FINDINGS"],
          ].map(([value, label], index) => (
            <div key={String(label)}>
              <strong className={index === 3 ? "warning-text" : ""}>
                {value}
              </strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="detected-adapter">
          <span
            className={`connection-dot ${mode === "daemon" ? "is-live" : mode === "demo" ? "is-demo" : ""}`}
          />
          <code>{presentFramework(graph.framework)}</code>
          <span>{presentation.adapterStatus}</span>
        </div>
        <footer>
          <p>{presentation.footer}</p>
          <button
            className={
              hasProjectEvidence(graph) || mode === "demo"
                ? ""
                : "primary-button"
            }
            onClick={() => {
              onClose();
              onNavigate(presentation.primaryPath);
            }}
            type="button"
          >
            {presentation.primaryLabel}
          </button>
          {hasProjectEvidence(graph) || mode === "demo" ? (
            <button
              className="primary-button"
              onClick={() => {
                onClose();
                onNavigate("/atlas/flows");
              }}
              type="button"
            >
              Open flows <ChevronRight size={13} />
            </button>
          ) : null}
        </footer>
      </div>
    </OverlayFrame>
  );
}

export function ExportReviewDialog({
  graph,
  mode,
  notes,
  onClose,
  onExport,
}: {
  graph: ApplicationGraph;
  mode: TopoDataMode;
  notes: number;
  onClose: () => void;
  onExport: (options: ReviewExportOptions) => void;
}) {
  const [format, setFormat] =
    useState<ReviewExportOptions["format"]>("markdown");
  const [include, setInclude] = useState<ReviewExportOptions["include"]>("all");
  const [attachSnapshots, setAttachSnapshots] = useState(false);
  const extension =
    format === "markdown" ? "md" : format === "sarif" ? "sarif" : "html";
  const project = mode === "demo" ? "fieldbase" : presentProject(graph);
  const coverageGaps = graph.components.filter(
    (component) => component.previewStatus !== "renderable",
  ).length;
  const canExport = mode === "demo" || hasProjectEvidence(graph);
  return (
    <OverlayFrame onClose={onClose}>
      <div className="export-dialog">
        <header>
          <h2>
            Export
            <br />
            review
          </h2>
          <button onClick={onClose} type="button">
            <X size={14} />
          </button>
        </header>
        <pre>
          # Topo review — {project}
          {"\n"}
          {graph.screens.length} routes · {graph.components.length} components ·{" "}
          {graph.findings.length} findings{"\n"}────────────────────────────
          {"\n"}## Findings ({graph.findings.length}){"\n"}## Coverage gaps (
          {coverageGaps}){"\n"}
          ## Notes ({notes})
        </pre>
        <div className="export-options">
          <section>
            <span className="section-label">FORMAT</span>
            <div className="segmented-control">
              {(["markdown", "sarif", "html"] as const).map((value) => (
                <button
                  className={format === value ? "is-active" : ""}
                  key={value}
                  onClick={() => setFormat(value)}
                  type="button"
                >
                  {value === "markdown"
                    ? "Markdown"
                    : value === "sarif"
                      ? "SARIF"
                      : "HTML"}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span className="section-label">INCLUDE</span>
            <div className="segmented-control">
              {(["all", "findings", "notes"] as const).map((value) => (
                <button
                  className={include === value ? "is-active" : ""}
                  key={value}
                  onClick={() => setInclude(value)}
                  type="button"
                >
                  {value[0]!.toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="attach-snapshots">
          <div>
            <strong>Attach snapshots</strong>
            <p>Adds stable references to local PNG captures.</p>
          </div>
          <button
            aria-checked={attachSnapshots}
            className={`toggle ${attachSnapshots ? "is-on" : ""}`}
            onClick={() => setAttachSnapshots((current) => !current)}
            role="switch"
            type="button"
          >
            <span />
          </button>
        </div>
        <footer>
          <code>
            TOPO_REVIEW.{extension} · {graph.findings.length} findings
          </code>
          <button onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!canExport}
            onClick={() => {
              onExport({ format, include, attachSnapshots });
              onClose();
            }}
            type="button"
          >
            <Upload size={13} /> {canExport ? "Export" : "No project loaded"}
          </button>
        </footer>
      </div>
    </OverlayFrame>
  );
}
