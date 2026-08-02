import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState as useStateCompat,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  ExternalLink,
  FileText,
  Frame,
  GitBranch,
  Maximize,
  Minus,
  Monitor,
  MoreVertical,
  PanelRight,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";

import {
  type ApplicationGraph,
  type ApiEndpointNode,
  type AtlasOrganization,
  type ComponentNode,
  type Finding,
  type Flow,
  type InferredFlow,
  type InteractionProbeArtifact,
  type RuntimeEffectKind,
  type ScreenNode,
  type UpdateFlowInput,
} from "@topo/schema";
import {
  createComponentGroups,
  createRouteDistricts,
  createRouteSections,
} from "@topo/canvas-engine";
import {
  createAtlasScene,
  createComponentScene,
  createFlowScene,
  type FlowScene,
} from "@topo/layout";
import { useCanvasCamera, type CanvasInteractionMode } from "@topo/react";
import { createPreviewRouteUrl } from "@topo/live-frame-host";
import type { ComponentPreviewScaffoldResult } from "@topo/protocol";
import {
  subscribePreviewEvents,
  type PreviewEventSubscription,
} from "@topo/runtime-bridge";

import {
  findingTone,
  selectInteractionProbe,
  type StudioComponentPreviewArtifact,
  type StudioNote,
  type StudioSnapshot,
  type StudioVisualBaseline,
  type StudioVisualComparison,
} from "../studio-model";
import { createAtlasLiveFrames, studioScreenPreviewPath } from "../live-frames";
import { nextFlowStepId, removeFlowStep } from "../flow-authoring";
import {
  DEFAULT_ROUTE_MAP_FOCUS,
  describeSelectedRouteLocation,
  selectRouteMapFocusTarget,
  type RouteMapFocus,
} from "../route-map-focus";
import {
  selectComponentScreen,
  selectScreenEvidence,
} from "../screen-evidence";
import {
  selectComponentPreviewEvidence,
  type ComponentPreviewEvidence,
} from "../component-preview-evidence";
import {
  apiEndpointGroup,
  apiEndpointOrigin,
  apiEndpointOriginLabel,
  describeApiEndpointUsage,
} from "../api-presentation";
import type { AtlasCanvasMode, SnapshotRenderState } from "../PixiAtlasCanvas";
import { PreviewMock } from "./PreviewMock";
import { ScreenEvidenceStage } from "./ScreenEvidenceStage";
import type { StudioFlowTraceRuntime } from "../studio-runtime";

const PixiAtlasCanvas = lazy(async () => {
  const module = await import("../PixiAtlasCanvas");
  return { default: module.PixiAtlasCanvas };
});

const PixiComponentCanvas = lazy(async () => {
  const module = await import("../PixiTopologyCanvas");
  return { default: module.PixiComponentCanvas };
});

const PixiFlowCanvas = lazy(async () => {
  const module = await import("../PixiTopologyCanvas");
  return { default: module.PixiFlowCanvas };
});

interface AtlasWorkspaceProps {
  view: string;
  canvasView?: "map";
  graph: ApplicationGraph;
  atlasOrganization: AtlasOrganization;
  connected: boolean;
  busyAction?: string;
  flows: Flow[];
  flowTrace: StudioFlowTraceRuntime;
  notes: StudioNote[];
  snapshots: StudioSnapshot[];
  visualBaselines: StudioVisualBaseline[];
  visualComparisons: StudioVisualComparison[];
  previewArtifacts: StudioComponentPreviewArtifact[];
  interactionProbes: InteractionProbeArtifact[];
  interactionMode: CanvasInteractionMode;
  maxLiveScreens: number;
  promoteOnHover: boolean;
  previewBaseUrl: string;
  selectedScreenId?: string;
  selectedFlowId?: string;
  selectedFlowStepId?: string;
  selectedComponentId?: string;
  selectedEndpointId?: string;
  selectedPreviewId?: string;
  selectedProbeId?: string;
  onSelectScreen: (id: string) => void;
  onSelectFlow: (id: string) => void;
  onSelectFlowStep: (id: string) => void;
  onSelectComponent: (id: string) => void;
  onSelectApiEndpoint: (id: string) => void;
  onSelectComponentPreview: (id: string) => void;
  onSelectProbe: (id?: string) => void;
  onCreateFlow: () => Promise<Flow | undefined>;
  onUpdateFlow: (
    id: string,
    input: UpdateFlowInput,
  ) => Promise<Flow | undefined>;
  onDeleteFlow: (id: string) => Promise<boolean | undefined>;
  onNavigate: (path: string) => void;
  onOpenProbe: () => void;
  onRunProbe: (routePath: string) => void;
  onCapture: () => void;
  onCaptureComponents: (componentIds?: string[]) => void;
  onScaffoldComponentPreview: (
    componentId: string,
  ) => Promise<ComponentPreviewScaffoldResult | undefined>;
  onAcceptVisualBaseline: (screenId: string) => void;
}

type AtlasTabId = "routes" | "components" | "apis" | "flows";

interface AtlasTabCounts {
  routes?: number;
  components?: number;
  apis?: number;
  flows?: number;
}

function AtlasTabs({
  active,
  counts,
  onNavigate,
}: {
  active: AtlasTabId;
  counts?: AtlasTabCounts;
  onNavigate: (path: string) => void;
}) {
  const tabs: Array<[AtlasTabId, string]> = [
    ["routes", "Routes"],
    ["components", "Components"],
    ["apis", "APIs"],
    ["flows", "Flows"],
  ];
  return (
    <div className="atlas-tabs" role="tablist" aria-label="Atlas views">
      {tabs.map(([value, label]) => (
        <button
          aria-label={`${label}${counts?.[value] === undefined ? "" : ` · ${counts[value]}`}`}
          aria-selected={active === value}
          className={active === value ? "is-active" : ""}
          data-atlas-tab={value}
          key={value}
          onKeyDown={(event) => {
            const index = tabs.findIndex(([tab]) => tab === value);
            const nextIndex =
              event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft"
                  ? (index - 1 + tabs.length) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : -1;
            if (nextIndex < 0) return;
            event.preventDefault();
            const next = tabs[nextIndex]?.[0];
            if (!next) return;
            onNavigate(`/atlas/${next}`);
            requestAnimationFrame(() => {
              document
                .querySelector<HTMLButtonElement>(
                  `.atlas-tabs button[data-atlas-tab="${next}"]`,
                )
                ?.focus();
            });
          }}
          onClick={() => onNavigate(`/atlas/${value}`)}
          role="tab"
          tabIndex={active === value ? 0 : -1}
          title={`${label}${counts?.[value] === undefined ? "" : ` · ${counts[value]}`}`}
          type="button"
        >
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function atlasTabCounts(
  graph: ApplicationGraph,
  flows: readonly Flow[],
): AtlasTabCounts {
  return {
    routes: graph.screens.length,
    components: graph.components.length,
    apis: graph.apiEndpoints.length,
    flows: flows.length + graph.inferredFlows.length,
  };
}

function CanvasZoom({
  onFit,
  onFitAll,
  onFitGroup,
  fitGroupLabel = "Fit selected group",
  showFitAll = true,
  onZoomIn,
  onZoomOut,
  zoom = 1,
}: {
  onFit?: () => void;
  onFitAll?: () => void;
  onFitGroup?: () => void;
  fitGroupLabel?: string;
  showFitAll?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  zoom?: number;
} = {}) {
  return (
    <div className="canvas-zoom" aria-label="Canvas zoom controls">
      <button aria-label="Zoom out" onClick={onZoomOut} type="button">
        <Minus size={14} />
      </button>
      <button className="zoom-value" onClick={onFit} type="button">
        {Math.round(zoom * 100)}%
      </button>
      <button aria-label="Zoom in" onClick={onZoomIn} type="button">
        <Plus size={14} />
      </button>
      {onFitGroup && (
        <button
          aria-label={fitGroupLabel}
          onClick={onFitGroup}
          title={fitGroupLabel}
          type="button"
        >
          <Frame size={14} />
        </button>
      )}
      {showFitAll && (
        <button
          aria-label="Fit atlas"
          onClick={onFitAll ?? onFit}
          type="button"
        >
          <Maximize size={14} />
        </button>
      )}
    </div>
  );
}

function RouteTree({
  atlasOrganization,
  flows,
  graph,
  selected,
  onSelect,
  onNavigate,
}: {
  atlasOrganization: AtlasOrganization;
  flows: readonly Flow[];
  graph: ApplicationGraph;
  selected?: ScreenNode;
  onSelect: (id: string) => void;
  onNavigate: (path: string) => void;
}) {
  const [query, setQuery] = useStateCompat("");
  const [expanded, setExpanded] = useStateCompat<Record<string, boolean>>({});
  const selectedRouteButtonRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const routeDistricts = useMemo(
    () => createRouteDistricts(graph.screens, atlasOrganization),
    [atlasOrganization, graph.screens],
  );
  const routeSections = useMemo(
    () => createRouteSections(routeDistricts),
    [routeDistricts],
  );
  const sections = useMemo(
    () =>
      routeSections
        .map((section) => ({
          ...section,
          districts: section.districts
            .map((district) => ({
              ...district,
              routes: district.routes.filter((route) => {
                if (!normalizedQuery) return true;
                return [
                  section.label,
                  district.label,
                  route.label,
                  route.routePath,
                  ...route.states,
                  ...route.sourceFilePaths,
                ].some((value) =>
                  value.toLocaleLowerCase().includes(normalizedQuery),
                );
              }),
            }))
            .filter((district) => district.routes.length > 0),
        }))
        .filter((section) => section.districts.length > 0),
    [normalizedQuery, routeSections],
  );
  const screenById = useMemo(
    () => new Map(graph.screens.map((screen) => [screen.id, screen])),
    [graph.screens],
  );
  const routeCount = routeDistricts.reduce(
    (total, district) => total + district.routeCount,
    0,
  );
  useEffect(() => {
    selectedRouteButtonRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  return (
    <aside className="atlas-sidebar">
      <AtlasTabs
        active="routes"
        counts={atlasTabCounts(graph, flows)}
        onNavigate={onNavigate}
      />
      <div
        className="route-index-summary"
        data-area-count={routeDistricts.length}
        data-region-count={routeSections.length}
        data-route-count={routeCount}
      >
        <div>
          <span>ROUTE MAP</span>
          <strong>{routeCount} routes</strong>
        </div>
        <span>
          {routeSections.length} regions · {routeDistricts.length} areas
        </span>
      </div>
      <label className="route-filter" htmlFor="topo-route-filter">
        <Search aria-hidden="true" size={12} />
        <input
          aria-label="Filter routes"
          id="topo-route-filter"
          name="route-filter"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Filter routes"
          type="search"
          value={query}
        />
        {query && (
          <button
            aria-label="Clear route filter"
            onClick={() => setQuery("")}
            type="button"
          >
            <X size={11} />
          </button>
        )}
      </label>
      <div className="tree-scroll route-tree-scroll">
        {sections.map((section) => {
          const sectionCurrent = section.screenIds.includes(selected?.id ?? "");
          const sectionStateKey = `section:${section.id}`;
          const sectionExpanded = normalizedQuery
            ? true
            : (expanded[sectionStateKey] ?? sectionCurrent);
          return (
            <section
              className={`route-section${sectionCurrent ? " is-current" : ""}`}
              key={section.id}
            >
              <button
                aria-expanded={sectionExpanded}
                className="route-section-heading"
                onClick={() =>
                  setExpanded((current) => ({
                    ...current,
                    [sectionStateKey]: !sectionExpanded,
                  }))
                }
                type="button"
              >
                <ChevronRight
                  className={sectionExpanded ? "is-open" : ""}
                  size={12}
                />
                <Box size={13} />
                <span>
                  <strong>{section.label}</strong>
                  <code>
                    {section.routeCount} routes · {section.districts.length}{" "}
                    {section.districts.length === 1 ? "area" : "areas"}
                  </code>
                </span>
                <small>{section.districts.length}</small>
              </button>
              {sectionExpanded && (
                <div
                  aria-label={`${section.label} route areas`}
                  className="route-section-districts"
                  role="group"
                >
                  {section.districts.map((district) => {
                    const isCurrent = district.screens.some(
                      (screen) => screen.id === selected?.id,
                    );
                    const districtStateKey = `district:${district.id}`;
                    const isExpanded = normalizedQuery
                      ? true
                      : (expanded[districtStateKey] ?? isCurrent);
                    return (
                      <section
                        className={`route-district${isCurrent ? " is-current" : ""}`}
                        key={district.id}
                      >
                        <button
                          aria-expanded={isExpanded}
                          className="route-district-heading"
                          onClick={() =>
                            setExpanded((current) => ({
                              ...current,
                              [districtStateKey]: !isExpanded,
                            }))
                          }
                          type="button"
                        >
                          <ChevronRight
                            className={isExpanded ? "is-open" : ""}
                            size={10}
                          />
                          <Frame size={12} />
                          <span>
                            <strong>{district.label}</strong>
                            <code>{district.routePrefixes.join(" · ")}</code>
                          </span>
                          <small>{district.routes.length}</small>
                        </button>
                        {isExpanded && (
                          <div
                            aria-label={`${district.label} routes`}
                            className="route-district-entries"
                            role="group"
                          >
                            {district.routes.map((route) => {
                              const routeScreens = route.screenIds.flatMap(
                                (screenId) => {
                                  const screen = screenById.get(screenId);
                                  return screen ? [screen] : [];
                                },
                              );
                              const routeSelected = route.screenIds.includes(
                                selected?.id ?? "",
                              );
                              const primaryScreen =
                                (routeSelected ? selected : undefined) ??
                                routeScreens.find(
                                  (screen) =>
                                    screen.id === route.primaryScreenId,
                                ) ??
                                routeScreens[0];
                              const renderStatus = route.renderStatusCounts
                                .blocked
                                ? "blocked"
                                : route.renderStatusCounts.live
                                  ? "live"
                                  : route.renderStatusCounts.captured
                                    ? "captured"
                                    : "unseen";
                              return (
                                <div className="route-family" key={route.id}>
                                  <button
                                    aria-label={`${route.label}, ${route.routePath}, hierarchy level ${route.hierarchyLevel + 1}`}
                                    className={`route-tree-entry depth-${Math.min(3, route.hierarchyLevel)} ${routeSelected ? "is-selected" : ""}`}
                                    data-hierarchy-level={route.hierarchyLevel}
                                    ref={
                                      routeSelected
                                        ? selectedRouteButtonRef
                                        : undefined
                                    }
                                    onClick={() =>
                                      primaryScreen &&
                                      onSelect(primaryScreen.id)
                                    }
                                    type="button"
                                  >
                                    {route.dynamic ? (
                                      <Square size={10} />
                                    ) : (
                                      <FileText size={11} />
                                    )}
                                    <span>
                                      <strong>{route.label}</strong>
                                      <code>{route.routePath}</code>
                                    </span>
                                    {route.states.length > 1 && (
                                      <em>{route.states.length}</em>
                                    )}
                                    <i
                                      className={`route-status is-${renderStatus}`}
                                    />
                                  </button>
                                  {routeSelected && routeScreens.length > 1 && (
                                    <div
                                      aria-label={`${route.label} screen states`}
                                      className="route-state-entries"
                                      role="group"
                                    >
                                      {routeScreens.map((screen) => (
                                        <button
                                          className={
                                            screen.id === selected?.id
                                              ? "is-selected"
                                              : undefined
                                          }
                                          key={screen.id}
                                          onClick={() => onSelect(screen.id)}
                                          type="button"
                                        >
                                          <Circle size={7} />
                                          <span>{screen.state}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {sections.length === 0 && (
          <div className="route-filter-empty">No routes match “{query}”.</div>
        )}
      </div>
    </aside>
  );
}

function FindingsList({ findings }: { findings: Finding[] }) {
  return (
    <div className="inspector-stack">
      {findings.slice(0, 2).map((finding) => (
        <article
          className={`finding-card tone-${findingTone(finding)}`}
          key={finding.id}
        >
          <div className="finding-title-row">
            <strong>{finding.title}</strong>
            <code>{finding.confidence.toFixed(2)}</code>
          </div>
          <p>{finding.description}</p>
        </article>
      ))}
    </div>
  );
}

function ScreenInspector({
  heading = "Screen",
  graph,
  screen,
  snapshot,
  baseline,
  comparison,
  notes,
  busyAction,
  onAcceptBaseline,
  onProbe,
}: {
  heading?: "Route" | "Screen";
  graph: ApplicationGraph;
  screen?: ScreenNode;
  snapshot?: StudioSnapshot;
  baseline?: StudioVisualBaseline;
  comparison?: StudioVisualComparison;
  notes: StudioNote[];
  busyAction?: string;
  onAcceptBaseline: () => void;
  onProbe: () => void;
}) {
  const findings = graph.findings.filter(
    (finding) => finding.source?.filePath === screen?.source.filePath,
  );
  const visibleFindings =
    findings.length > 0 ? findings : graph.findings.slice(0, 2);
  const visibleNotes = notes.filter(
    (note) => note.targetRoute === screen?.routePath,
  );
  return (
    <aside className="atlas-inspector">
      <div className="inspector-titlebar">
        <div>
          {heading === "Route" ? <Route size={13} /> : <PanelRight size={13} />}
          <strong>{heading}</strong>
        </div>
        <div>
          <FileText size={13} />
          <MoreVertical size={13} />
        </div>
      </div>
      <section>
        <span className="section-label">ROUTE</span>
        <div className="route-identity-card">
          <strong>{screen?.title ?? "No route selected"}</strong>
          <code>{screen?.routePath ?? "/"}</code>
          <div>
            <span>{screen?.state ?? "default"}</span>
            <span>{screen?.framework ?? graph.framework}</span>
            {screen?.adapterId && <span>via {screen.adapterId}</span>}
          </div>
        </div>
      </section>
      <section>
        <span className="section-label">SOURCE</span>
        <div className="well-card">
          <code>{screen?.source.filePath ?? "app/(marketing)/page.tsx"}</code>
          <span>Server Component · 142 lines</span>
        </div>
      </section>
      <section>
        <span className="section-label">CAPTURE</span>
        <dl className="property-list">
          <div>
            <dt>State</dt>
            <dd
              className={
                screen?.renderStatus === "live" ? "live-text" : "snapshot-text"
              }
            >
              ●{" "}
              {screen?.renderStatus === "live"
                ? "Live iframe"
                : snapshot
                  ? "GPU snapshot"
                  : "Not captured"}
            </dd>
          </div>
          <div>
            <dt>Snapshot</dt>
            <dd>
              {snapshot
                ? `${new Date(snapshot.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${snapshot.width ?? 1440}×${snapshot.height ?? 1024}`
                : "No successful capture"}
            </dd>
          </div>
          <div>
            <dt>Preview path</dt>
            <dd>
              {screen
                ? (studioScreenPreviewPath(screen) ?? "Needs a route example")
                : "No route selected"}
            </dd>
          </div>
        </dl>
      </section>
      <section
        className="visual-baseline-section"
        data-visual-comparison-status={comparison?.status ?? "missing"}
      >
        <span className="section-label section-count">
          VISUAL BASELINE
          <span>{baseline ? "accepted locally" : "not accepted"}</span>
        </span>
        <div className="visual-evidence-card">
          <div className="visual-evidence-summary">
            <span
              className={`visual-status visual-status-${comparison?.status ?? "missing"}`}
            >
              {comparison?.status === "unchanged" ? (
                <Check size={11} />
              ) : comparison ? (
                <AlertTriangle size={11} />
              ) : (
                <Circle size={10} />
              )}
              {comparison?.status === "changed"
                ? `${(comparison.changeRatio * 100).toFixed(2)}% changed`
                : comparison?.status === "dimension-changed"
                  ? "Dimensions changed"
                  : comparison?.status === "failed"
                    ? "Comparison failed"
                    : comparison?.status === "unchanged"
                      ? "Matches baseline"
                      : "No comparison"}
            </span>
            <code>
              {baseline
                ? baseline.contentHash.slice(0, 8)
                : "accept a known-good capture"}
            </code>
          </div>
          {baseline && (
            <dl className="visual-metrics">
              <div>
                <dt>Accepted</dt>
                <dd>
                  {new Date(baseline.acceptedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
              <div>
                <dt>Pixels</dt>
                <dd>
                  {comparison
                    ? `${comparison.changedPixels.toLocaleString()} / ${comparison.totalPixels.toLocaleString()}`
                    : "Awaiting capture"}
                </dd>
              </div>
            </dl>
          )}
          {(baseline?.imageUrl || comparison?.imageUrl) && (
            <div className="visual-evidence-strip">
              {baseline?.imageUrl && (
                <figure>
                  <img alt="Accepted visual baseline" src={baseline.imageUrl} />
                  <figcaption>Baseline</figcaption>
                </figure>
              )}
              {comparison?.imageUrl && (
                <figure>
                  <img
                    alt="Visual pixel difference"
                    src={comparison.imageUrl}
                  />
                  <figcaption>Difference</figcaption>
                </figure>
              )}
            </div>
          )}
          {comparison?.error && <p>{comparison.error}</p>}
        </div>
        <button
          className="wide-button visual-baseline-action"
          disabled={!snapshot || busyAction === "accept-baseline"}
          onClick={onAcceptBaseline}
          type="button"
        >
          {busyAction === "accept-baseline" ? (
            <RefreshCw className="spin" size={12} />
          ) : (
            <Check size={12} />
          )}
          {baseline ? "Accept current as baseline" : "Accept first baseline"}
        </button>
      </section>
      <section>
        <span className="section-label section-count">
          FINDINGS <span>{visibleFindings.length} on this screen</span>
        </span>
        <FindingsList findings={visibleFindings} />
        <button className="text-action" onClick={onProbe} type="button">
          Inspect runtime evidence <ChevronRight size={12} />
        </button>
      </section>
      <section>
        <span className="section-label section-count">
          NOTES <span>.topo/notes</span>
        </span>
        {(visibleNotes.length > 0 ? visibleNotes : notes.slice(0, 1)).map(
          (note) => (
            <article className="note-summary" key={note.id}>
              <span className="note-dot" />
              <div>
                <strong>{note.title}</strong>
                <code>
                  {note.type} · {note.author ?? "local"} · 2d
                </code>
              </div>
            </article>
          ),
        )}
      </section>
    </aside>
  );
}

function RoutesView(props: AtlasWorkspaceProps) {
  const canvasMode: AtlasCanvasMode =
    props.canvasView === "map" ? "map" : "screen";
  const [mapFocus, setMapFocus] = useStateCompat<RouteMapFocus>(
    DEFAULT_ROUTE_MAP_FOCUS,
  );
  const [hoveredScreenId, setHoveredScreenId] = useStateCompat<
    string | undefined
  >();
  const [renderedSnapshot, setRenderedSnapshot] = useStateCompat<{
    id?: string;
    state: SnapshotRenderState;
  }>({ state: "unavailable" });
  const [traceFrame, setTraceFrame] = useStateCompat<HTMLIFrameElement | null>(
    null,
  );
  const traceSubscription = useRef<PreviewEventSubscription | undefined>(
    undefined,
  );
  const selected =
    props.graph.screens.find(
      (screen) => screen.id === props.selectedScreenId,
    ) ?? props.graph.screens[0];
  const snapshot = props.snapshots.find(
    (item) => item.screenId === selected?.id && item.status === "captured",
  );
  const baseline = props.visualBaselines.find(
    (item) => item.screenId === selected?.id,
  );
  const comparison = props.visualComparisons.find(
    (item) => item.screenId === selected?.id,
  );
  const scene = useMemo(
    () =>
      createAtlasScene(props.graph, selected?.id, {
        routeOrganization: props.atlasOrganization,
      }),
    [props.atlasOrganization, props.graph, selected?.id],
  );
  const mapFocusTarget = selectRouteMapFocusTarget(scene, mapFocus);
  const routeLocation = describeSelectedRouteLocation(scene);
  const snapshotIsReady =
    renderedSnapshot.id === snapshot?.id && renderedSnapshot.state === "ready";
  const {
    camera,
    fit,
    fitBounds,
    isPanning,
    onViewportResize,
    viewportBindings,
    zoomBy,
  } = useCanvasCamera({
    alignY: canvasMode === "map" ? mapFocusTarget.alignY : "center",
    bounds: canvasMode === "map" ? mapFocusTarget.bounds : scene.selectedBounds,
    fitMaxZoom: canvasMode === "map" ? mapFocusTarget.maxZoom : 1,
    initialCamera: { x: 74, y: 54, zoom: 1 },
    initialViewport: { width: 928, height: 778 },
    interactionMode: props.interactionMode,
    maxZoom: 2.5,
    minZoom: 0.02,
    padding: 24,
    pointerIgnoreSelector: "[data-canvas-interactive], [data-canvas-control]",
  });
  const liveFrames = useMemo(
    () =>
      createAtlasLiveFrames({
        baseUrl: props.previewBaseUrl,
        connected: props.connected,
        graph: props.graph,
        hoveredScreenId,
        maxFrames: props.maxLiveScreens,
        promoteOnHover: props.promoteOnHover,
        scene,
        selectedScreenId: selected?.id,
      }),
    [
      hoveredScreenId,
      props.connected,
      props.graph,
      props.maxLiveScreens,
      props.previewBaseUrl,
      props.promoteOnHover,
      scene,
      selected?.id,
    ],
  );
  const selectedLiveFrame = liveFrames.find(
    (frame) => frame.id === selected?.id,
  );
  const nearbyLiveFrames =
    canvasMode === "screen" && camera.zoom < 0.8
      ? liveFrames.filter((frame) => frame.id !== selected?.id)
      : [];
  const renderDomPreview =
    Boolean(selectedLiveFrame) || !snapshot?.imageUrl || !snapshotIsReady;
  const traceActive = Boolean(props.flowTrace.session);
  useEffect(() => {
    traceSubscription.current?.close();
    traceSubscription.current = undefined;
    if (!traceActive || !traceFrame?.contentWindow || !selectedLiveFrame) {
      return;
    }
    const subscription = subscribePreviewEvents({
      hostWindow: window,
      targetWindow: traceFrame.contentWindow,
      targetOrigin: new URL(selectedLiveFrame.src).origin,
      onEvents: props.flowTrace.record,
    });
    traceSubscription.current = subscription;
    return () => {
      subscription?.close();
      if (traceSubscription.current === subscription) {
        traceSubscription.current = undefined;
      }
    };
  }, [props.flowTrace.record, selectedLiveFrame, traceActive, traceFrame]);
  const handleCanvasPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    viewportBindings.onPointerMove(event);
    if (
      canvasMode !== "screen" ||
      !props.promoteOnHover ||
      event.buttons !== 0
    ) {
      if (hoveredScreenId) setHoveredScreenId(undefined);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const worldX = (event.clientX - bounds.left - camera.x) / camera.zoom;
    const worldY = (event.clientY - bounds.top - camera.y) / camera.zoom;
    const hovered = [...scene.layout.screens]
      .reverse()
      .find(
        (screen) =>
          worldX >= screen.position.x &&
          worldX <= screen.position.x + screen.width &&
          worldY >= screen.position.y &&
          worldY <= screen.position.y + screen.height,
      );
    const nextId = hovered?.id === selected?.id ? undefined : hovered?.id;
    if (nextId !== hoveredScreenId) setHoveredScreenId(nextId);
  };
  const presentationKey = `${canvasMode}:${mapFocus}:${selected?.id ?? "none"}`;
  const previousPresentationKey = useRef(presentationKey);
  useEffect(() => {
    if (previousPresentationKey.current === presentationKey) return;
    previousPresentationKey.current = presentationKey;
    if (canvasMode === "map") {
      fitBounds(mapFocusTarget.bounds, {
        alignY: mapFocusTarget.alignY,
        maxZoom: mapFocusTarget.maxZoom,
        minZoom: 0.02,
        padding: mapFocusTarget.padding,
      });
      return;
    }
    fitBounds(scene.selectedBounds, {
      maxZoom: 1,
      minZoom: 0.02,
      padding: 24,
    });
  }, [
    canvasMode,
    fitBounds,
    mapFocusTarget.alignY,
    mapFocusTarget.bounds,
    mapFocusTarget.maxZoom,
    mapFocusTarget.padding,
    presentationKey,
    scene.selectedBounds,
  ]);
  const showRouteMap = (focus: RouteMapFocus = DEFAULT_ROUTE_MAP_FOCUS) => {
    const target = selectRouteMapFocusTarget(scene, focus);
    setMapFocus(focus);
    if (canvasMode !== "map") {
      props.onNavigate("/atlas/routes?canvas=map");
      return;
    }
    if (mapFocus !== focus) return;
    fitBounds(target.bounds, {
      alignY: target.alignY,
      maxZoom: target.maxZoom,
      minZoom: 0.02,
      padding: target.padding,
    });
  };
  const inspectScreen = (screenId: string) => {
    props.onSelectScreen(screenId);
    if (canvasMode !== "screen") {
      props.onNavigate("/atlas/routes");
      return;
    }
    if (selected?.id !== screenId) return;
    fitBounds(scene.selectedBounds, {
      maxZoom: 1,
      minZoom: 0.02,
      padding: 24,
    });
  };
  return (
    <div className="three-pane atlas-routes-view">
      <RouteTree
        atlasOrganization={props.atlasOrganization}
        flows={props.flows}
        graph={props.graph}
        onNavigate={props.onNavigate}
        onSelect={inspectScreen}
        selected={selected}
      />
      <section className="atlas-canvas-panel">
        <div className="canvas-titlebar">
          <div
            className="route-canvas-context"
            data-route-location={
              routeLocation || `${scene.routeMap.sections.length} regions`
            }
          >
            <span>{canvasMode === "map" ? "ROUTE MAP" : "SCREEN"}</span>
            <strong>
              {canvasMode === "map"
                ? `${scene.routeMap.routes.length} routes`
                : (selected?.routePath ?? "/")}
            </strong>
            <code>
              {canvasMode === "map"
                ? routeLocation || `${scene.routeMap.sections.length} regions`
                : (selected?.state ?? "default")}
            </code>
          </div>
          <div className="route-canvas-actions">
            <div
              aria-label="Route canvas view"
              className="route-canvas-mode"
              data-canvas-control
              role="group"
            >
              <button
                aria-pressed={canvasMode === "map"}
                className={canvasMode === "map" ? "is-active" : undefined}
                onClick={() => showRouteMap()}
                type="button"
              >
                <Route size={13} /> Map
              </button>
              <button
                aria-pressed={canvasMode === "screen"}
                className={canvasMode === "screen" ? "is-active" : undefined}
                disabled={!selected}
                onClick={() => selected && inspectScreen(selected.id)}
                type="button"
              >
                <Monitor size={13} /> Screen
              </button>
            </div>
            {canvasMode === "map" && (
              <div
                aria-label="Route map focus"
                className="route-map-focus"
                data-canvas-control
                role="group"
              >
                {(["area", "region", "atlas"] as const).map((focus) => (
                  <button
                    aria-pressed={mapFocus === focus}
                    className={mapFocus === focus ? "is-active" : undefined}
                    key={focus}
                    onClick={() => showRouteMap(focus)}
                    title={`Fit ${focus}`}
                    type="button"
                  >
                    {focus.charAt(0).toUpperCase() + focus.slice(1)}
                  </button>
                ))}
              </div>
            )}
            <CanvasZoom
              onFit={fit}
              onZoomIn={() => zoomBy(1.2)}
              onZoomOut={() => zoomBy(1 / 1.2)}
              showFitAll={canvasMode !== "map"}
              zoom={camera.zoom}
            />
          </div>
        </div>
        <div
          {...viewportBindings}
          aria-label="Topo route canvas. Drag to pan, scroll to zoom, and press 0 to fit."
          className={`screen-canvas${isPanning ? " is-panning" : ""}`}
          data-camera-x={Math.round(camera.x * 100) / 100}
          data-camera-y={Math.round(camera.y * 100) / 100}
          data-camera-zoom={Math.round(camera.zoom * 1000) / 1000}
          data-canvas-mode={canvasMode}
          data-map-focus={mapFocus}
          data-route-area-count={scene.routeMap.groups.length}
          data-route-map-aspect={
            Math.round(
              (scene.routeMap.bounds.width / scene.routeMap.bounds.height) *
                1000,
            ) / 1000
          }
          data-route-map-height={Math.round(scene.routeMap.bounds.height)}
          data-route-map-width={Math.round(scene.routeMap.bounds.width)}
          data-route-region-count={scene.routeMap.sections.length}
          data-selected-screen-id={selected?.id}
          data-live-frame-count={
            canvasMode === "screen" ? liveFrames.length : 0
          }
          data-nearby-live-frame-count={nearbyLiveFrames.length}
          data-renderer="pixi-hybrid"
          onPointerLeave={() => setHoveredScreenId(undefined)}
          onPointerMove={handleCanvasPointerMove}
          role="application"
          tabIndex={0}
        >
          <Suspense
            fallback={
              <div className="atlas-pixi-fallback" aria-hidden="true" />
            }
          >
            <PixiAtlasCanvas
              camera={camera}
              mode={canvasMode}
              onResize={onViewportResize}
              onSelectScreen={inspectScreen}
              onSnapshotStateChange={(id, state) =>
                setRenderedSnapshot({ id, state })
              }
              scene={scene}
              selectedScreenId={selected?.id}
              snapshots={props.snapshots}
            />
          </Suspense>
          {nearbyLiveFrames.length > 0 && (
            <div
              aria-hidden="true"
              className="atlas-live-world"
              style={{
                transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
              }}
            >
              {nearbyLiveFrames.map((frame) => (
                <div
                  className="nearby-live-frame"
                  data-canvas-interactive={
                    frame.interactive ? "true" : undefined
                  }
                  data-live-frame-id={frame.id}
                  data-live-frame-reason={frame.reason}
                  key={frame.id}
                  onPointerLeave={() =>
                    frame.reason === "hover" && setHoveredScreenId(undefined)
                  }
                  style={{
                    height: frame.height,
                    transform: `translate3d(${frame.position.x}px, ${frame.position.y}px, 0)`,
                    width: frame.width,
                  }}
                >
                  <span>● LIVE · {frame.routePath}</span>
                  <iframe
                    sandbox={frame.sandbox}
                    src={frame.src}
                    title={frame.title}
                  />
                </div>
              ))}
            </div>
          )}
          {canvasMode === "screen" && (
            <div
              className="atlas-screen-world"
              data-screen-id={selected?.id}
              style={{
                transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
              }}
            >
              <div className="screen-frame-meta">
                <span
                  className={selectedLiveFrame ? "live-pill" : "snapshot-pill"}
                >
                  ● {selectedLiveFrame ? "LIVE" : "SNAPSHOT"}
                </span>
                <code>{selected?.source.filePath}</code>
                <span>1440 × 1024</span>
              </div>
              {renderDomPreview && (
                <div
                  className="screen-preview-shell"
                  data-canvas-interactive={
                    selectedLiveFrame ? "true" : undefined
                  }
                  data-snapshot-fallback={
                    !snapshot?.imageUrl ? "true" : undefined
                  }
                >
                  {selectedLiveFrame ? (
                    <iframe
                      data-live-frame-id={selectedLiveFrame.id}
                      data-live-frame-reason={selectedLiveFrame.reason}
                      onLoad={() => traceSubscription.current?.refresh()}
                      ref={setTraceFrame}
                      sandbox={selectedLiveFrame.sandbox}
                      src={selectedLiveFrame.src}
                      title={selectedLiveFrame.title}
                    />
                  ) : (
                    <PreviewMock />
                  )}
                </div>
              )}
              {!renderDomPreview && (
                <span className="screen-snapshot-a11y">
                  Captured screen {selected?.routePath} rendered from snapshot{" "}
                  {snapshot?.id}.
                </span>
              )}
              <button
                aria-label="Open note detail"
                className="canvas-note-pin"
                data-canvas-control
                onClick={() => props.onNavigate("/notes/detail")}
                type="button"
              >
                ▣
              </button>
              <button
                className="possibly-inert-pin"
                data-canvas-control
                onClick={props.onOpenProbe}
                type="button"
              >
                !
              </button>
            </div>
          )}
          {props.flowTrace.session && (
            <aside
              aria-live="polite"
              className="flow-trace-hud"
              data-canvas-control
              data-flow-trace-state="recording"
              data-flow-trace-step-count={props.flowTrace.session.routes.length}
            >
              <span className="flow-trace-pulse" aria-hidden="true" />
              <div>
                <strong>Recording flow</strong>
                <code>
                  {props.flowTrace.session.routes.at(-1)?.path ??
                    "Waiting for a route"}
                </code>
              </div>
              <span className="flow-trace-count">
                {props.flowTrace.session.routes.length} step
                {props.flowTrace.session.routes.length === 1 ? "" : "s"}
              </span>
              <button onClick={props.flowTrace.cancel} type="button">
                Cancel
              </button>
              <button
                className="is-primary"
                disabled={props.flowTrace.session.routes.length === 0}
                onClick={() => void props.flowTrace.finish()}
                type="button"
              >
                <Square size={9} /> Finish
              </button>
            </aside>
          )}
        </div>
      </section>
      <ScreenInspector
        baseline={baseline}
        busyAction={props.busyAction}
        comparison={comparison}
        graph={props.graph}
        heading={canvasMode === "map" ? "Route" : "Screen"}
        notes={props.notes}
        onAcceptBaseline={() =>
          selected && props.onAcceptVisualBaseline(selected.id)
        }
        onProbe={props.onOpenProbe}
        screen={selected}
        snapshot={snapshot}
      />
    </div>
  );
}

function flowBreaks(flow: Flow, routePaths: Set<string>) {
  return flow.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.routePath && !routePaths.has(step.routePath));
}

function FlowInspector({
  busyAction,
  flow,
  graph,
  onDeleteFlow,
  onSelectStep,
  onUpdateFlow,
  scene,
}: {
  busyAction?: string;
  flow?: Flow;
  graph: ApplicationGraph;
  onDeleteFlow: (id: string) => Promise<boolean | undefined>;
  onSelectStep: (id: string) => void;
  onUpdateFlow: (
    id: string,
    input: UpdateFlowInput,
  ) => Promise<Flow | undefined>;
  scene: FlowScene;
}) {
  const [definitionDraft, setDefinitionDraft] = useStateCompat({
    title: flow?.title ?? "",
    description: flow?.description ?? "",
    status: flow?.status ?? ("draft" as Flow["status"]),
  });
  const selectedSceneStep =
    scene.steps.find(
      (step) =>
        step.flowId === flow?.id && step.stepId === scene.selectedStepId,
    ) ?? scene.steps.find((step) => step.flowId === flow?.id);
  const selectedFlowStep = flow?.steps.find(
    (step) => step.id === selectedSceneStep?.stepId,
  );
  const [stepDraft, setStepDraft] = useStateCompat({
    title: selectedFlowStep?.title ?? "",
    routePath: selectedFlowStep?.routePath ?? "",
    action: selectedFlowStep?.action ?? "",
    expected: selectedFlowStep?.expected ?? "",
    nextStepIds: selectedFlowStep?.nextStepIds ?? [],
  });
  const [deleteArmed, setDeleteArmed] = useStateCompat(false);
  const [editing, setEditing] = useStateCompat<"definition" | "step" | null>(
    null,
  );

  useEffect(() => {
    setDefinitionDraft({
      title: flow?.title ?? "",
      description: flow?.description ?? "",
      status: flow?.status ?? "draft",
    });
    setDeleteArmed(false);
    setEditing(null);
  }, [flow?.description, flow?.id, flow?.status, flow?.title]);

  useEffect(() => {
    setStepDraft({
      title: selectedFlowStep?.title ?? "",
      routePath: selectedFlowStep?.routePath ?? "",
      action: selectedFlowStep?.action ?? "",
      expected: selectedFlowStep?.expected ?? "",
      nextStepIds: selectedFlowStep?.nextStepIds ?? [],
    });
  }, [selectedFlowStep]);

  useEffect(() => {
    setEditing((current) => (current === "step" ? null : current));
  }, [selectedFlowStep?.id]);

  if (!flow) {
    return (
      <aside className="atlas-inspector flow-inspector">
        <div className="inspector-titlebar">
          <div>
            <Route size={13} />
            <strong>Flow</strong>
          </div>
        </div>
        <section className="empty-inspector-state">
          <span className="section-label">NO FLOW SELECTED</span>
          <p>
            Add a versioned flow under <code>.topo/flows</code> or import an
            existing Playwright journey. Topo will render it here without
            inventing missing steps.
          </p>
        </section>
      </aside>
    );
  }
  const sceneSteps = scene.steps.filter((step) => step.flowId === flow.id);
  const unresolved = sceneSteps.filter(
    (step) => step.resolution === "unresolved",
  );
  const firstBreak = unresolved[0];
  const selectedStep = selectedSceneStep;
  const saveDefinition = () =>
    void onUpdateFlow(flow.id, {
      title: definitionDraft.title,
      description: definitionDraft.description,
      status: definitionDraft.status,
    }).then((updated) => {
      if (updated) setEditing(null);
    });
  const saveStep = () => {
    if (!selectedFlowStep) return;
    void onUpdateFlow(flow.id, {
      steps: flow.steps.map((step) =>
        step.id === selectedFlowStep.id
          ? {
              ...step,
              title: stepDraft.title,
              routePath: stepDraft.routePath || undefined,
              action: stepDraft.action || undefined,
              expected: stepDraft.expected || undefined,
              nextStepIds: stepDraft.nextStepIds,
            }
          : step,
      ),
    }).then((updated) => {
      if (updated) setEditing(null);
    });
  };
  const addStep = () => {
    const id = nextFlowStepId(flow);
    void onUpdateFlow(flow.id, {
      entryStepId: flow.entryStepId ?? id,
      steps: [
        ...flow.steps,
        {
          id,
          title: `Step ${flow.steps.length + 1}`,
          noteIds: [],
          nextStepIds: [],
        },
      ],
    }).then((updated) => {
      if (updated) {
        onSelectStep(id);
        setEditing("step");
      }
    });
  };
  const deleteStep = () => {
    if (!selectedFlowStep) return;
    const revised = removeFlowStep(
      flow,
      selectedFlowStep.id,
      new Date().toISOString(),
    );
    void onUpdateFlow(flow.id, {
      entryStepId: revised.entryStepId ?? null,
      steps: revised.steps,
    }).then((updated) => {
      if (updated) {
        onSelectStep(updated.entryStepId ?? updated.steps[0]?.id ?? "");
        setEditing(null);
      }
    });
  };
  const closeDefinitionEditor = () => {
    setDefinitionDraft({
      title: flow.title,
      description: flow.description,
      status: flow.status,
    });
    setEditing(null);
  };
  const closeStepEditor = () => {
    setStepDraft({
      title: selectedFlowStep?.title ?? "",
      routePath: selectedFlowStep?.routePath ?? "",
      action: selectedFlowStep?.action ?? "",
      expected: selectedFlowStep?.expected ?? "",
      nextStepIds: selectedFlowStep?.nextStepIds ?? [],
    });
    setEditing(null);
  };
  return (
    <aside className="atlas-inspector flow-inspector">
      <div className="inspector-titlebar">
        <div>
          <Route size={13} />
          <strong>Flow</strong>
        </div>
        <button
          aria-label="Add flow step"
          className="icon-button flow-add-step"
          disabled={Boolean(busyAction)}
          onClick={addStep}
          title="Add step"
          type="button"
        >
          <Plus size={13} />
        </button>
      </div>
      <section className="flow-author-section">
        <div className="flow-section-heading">
          <span className="section-label">DEFINITION</span>
          <button
            aria-expanded={editing === "definition"}
            className="inspector-inline-action"
            disabled={Boolean(busyAction)}
            onClick={() =>
              editing === "definition"
                ? closeDefinitionEditor()
                : setEditing("definition")
            }
            type="button"
          >
            <Pencil size={10} />
            {editing === "definition" ? "Close" : "Edit"}
          </button>
        </div>
        <div className="well-card flow-source-card">
          <code>.topo/flows/{flow.id}.json</code>
          <span className="flow-source-meta">
            {flow.status} flow · {flow.steps.length} steps
          </span>
        </div>
        {flow.description && !editing && (
          <p className="flow-definition-copy">{flow.description}</p>
        )}
        {editing === "definition" && (
          <div className="flow-author-fields flow-editor-surface">
            <label className="sr-only" htmlFor="topo-flow-title">
              Flow title
            </label>
            <input
              aria-label="Flow title"
              disabled={Boolean(busyAction)}
              id="topo-flow-title"
              name="flow-title"
              onChange={(event) =>
                setDefinitionDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Flow title"
              value={definitionDraft.title}
            />
            <label className="sr-only" htmlFor="topo-flow-description">
              Flow description
            </label>
            <textarea
              aria-label="Flow description"
              disabled={Boolean(busyAction)}
              id="topo-flow-description"
              name="flow-description"
              onChange={(event) =>
                setDefinitionDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="What does this journey prove?"
              rows={2}
              value={definitionDraft.description}
            />
            <label className="sr-only" htmlFor="topo-flow-status">
              Flow status
            </label>
            <select
              aria-label="Flow status"
              disabled={Boolean(busyAction)}
              id="topo-flow-status"
              name="flow-status"
              onChange={(event) =>
                setDefinitionDraft((current) => ({
                  ...current,
                  status: event.target.value as Flow["status"],
                }))
              }
              value={definitionDraft.status}
            >
              <option value="draft">Draft</option>
              <option value="verified">Verified</option>
              <option value="deprecated">Deprecated</option>
            </select>
            <div className="flow-editor-actions">
              <button
                className="inspector-action"
                disabled={Boolean(busyAction) || !definitionDraft.title.trim()}
                onClick={saveDefinition}
                type="button"
              >
                {busyAction === "flow-update" ? "Saving…" : "Save"}
              </button>
              <button
                className="inspector-action is-subtle"
                disabled={Boolean(busyAction)}
                onClick={closeDefinitionEditor}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
      <section>
        <span className="section-label">COVERAGE</span>
        <dl className="property-list">
          <div>
            <dt>Steps captured</dt>
            <dd>
              {Math.max(0, flow.steps.length - unresolved.length)} of{" "}
              {flow.steps.length}
            </dd>
          </div>
          <div>
            <dt>Last traced</dt>
            <dd>{new Date(flow.updatedAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      </section>
      <section>
        <span className="section-label">
          {firstBreak ? "BREAK IN FLOW" : "FLOW HEALTH"}
        </span>
        {firstBreak ? (
          <article className="finding-card tone-error">
            <div className="finding-title-row">
              <strong>Unresolved route</strong>
              <code>0.97</code>
            </div>
            <p>
              Step {firstBreak.order + 1} links to {firstBreak.routePath}, which
              matches no route in the generated tree.
            </p>
          </article>
        ) : (
          <article className="finding-card flow-clean-card">
            <div className="finding-title-row">
              <strong>All steps resolve</strong>
              <code>clean</code>
            </div>
            <p>Every route in this flow exists in the current graph.</p>
          </article>
        )}
      </section>
      {selectedStep && (
        <section className="flow-author-section">
          <div className="flow-section-heading">
            <span className="section-label">SELECTED STEP</span>
            <button
              aria-expanded={editing === "step"}
              className="inspector-inline-action"
              disabled={Boolean(busyAction)}
              onClick={() =>
                editing === "step" ? closeStepEditor() : setEditing("step")
              }
              type="button"
            >
              <Pencil size={10} />
              {editing === "step" ? "Close" : "Edit"}
            </button>
          </div>
          <div className="well-card flow-step-well">
            <strong>{selectedStep.title}</strong>
            <code>{selectedStep.routePath ?? "No route binding"}</code>
            <span>
              {selectedStep.action ?? "No action recorded"} ·{" "}
              {selectedStep.resolution}
              {" · "}
              {selectedStep.nextStepIds.length} next
            </span>
          </div>
          {editing === "step" && (
            <div className="flow-author-fields flow-step-editor">
              <label className="sr-only" htmlFor="topo-flow-step-title">
                Step title
              </label>
              <input
                aria-label="Step title"
                disabled={Boolean(busyAction)}
                id="topo-flow-step-title"
                name="flow-step-title"
                onChange={(event) =>
                  setStepDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Step title"
                value={stepDraft.title}
              />
              <label className="sr-only" htmlFor="topo-flow-step-route">
                Step route
              </label>
              <input
                aria-label="Step route"
                disabled={Boolean(busyAction)}
                id="topo-flow-step-route"
                list="topo-flow-routes"
                name="flow-step-route"
                onChange={(event) =>
                  setStepDraft((current) => ({
                    ...current,
                    routePath: event.target.value,
                  }))
                }
                placeholder="/route or unbound"
                value={stepDraft.routePath}
              />
              <datalist id="topo-flow-routes">
                {[
                  ...new Set(graph.screens.map((screen) => screen.routePath)),
                ].map((routePath) => (
                  <option key={routePath} value={routePath} />
                ))}
              </datalist>
              <label className="sr-only" htmlFor="topo-flow-step-action">
                Step action
              </label>
              <input
                aria-label="Step action"
                disabled={Boolean(busyAction)}
                id="topo-flow-step-action"
                name="flow-step-action"
                onChange={(event) =>
                  setStepDraft((current) => ({
                    ...current,
                    action: event.target.value,
                  }))
                }
                placeholder="Action"
                value={stepDraft.action}
              />
              <label className="sr-only" htmlFor="topo-flow-step-expected">
                Expected result
              </label>
              <input
                aria-label="Expected result"
                disabled={Boolean(busyAction)}
                id="topo-flow-step-expected"
                name="flow-step-expected"
                onChange={(event) =>
                  setStepDraft((current) => ({
                    ...current,
                    expected: event.target.value,
                  }))
                }
                placeholder="Expected result"
                value={stepDraft.expected}
              />
              {flow.steps.length > 1 && (
                <div className="flow-next-step-list">
                  <span>NEXT STEPS</span>
                  {flow.steps
                    .filter((step) => step.id !== selectedFlowStep?.id)
                    .map((step) => (
                      <label key={step.id}>
                        <input
                          checked={stepDraft.nextStepIds.includes(step.id)}
                          disabled={Boolean(busyAction)}
                          name="flow-next-step"
                          onChange={(event) =>
                            setStepDraft((current) => ({
                              ...current,
                              nextStepIds: event.target.checked
                                ? [...current.nextStepIds, step.id]
                                : current.nextStepIds.filter(
                                    (candidate) => candidate !== step.id,
                                  ),
                            }))
                          }
                          type="checkbox"
                        />
                        {step.title}
                      </label>
                    ))}
                </div>
              )}
              <div className="flow-step-actions">
                <button
                  className="inspector-action"
                  disabled={Boolean(busyAction) || !stepDraft.title.trim()}
                  onClick={saveStep}
                  type="button"
                >
                  Save step
                </button>
                <button
                  className="inspector-action is-subtle"
                  disabled={Boolean(busyAction)}
                  onClick={closeStepEditor}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="inspector-action is-subtle"
                  disabled={
                    Boolean(busyAction) ||
                    flow.entryStepId === selectedFlowStep?.id
                  }
                  onClick={() =>
                    selectedFlowStep &&
                    void onUpdateFlow(flow.id, {
                      entryStepId: selectedFlowStep.id,
                    })
                  }
                  type="button"
                >
                  {flow.entryStepId === selectedFlowStep?.id
                    ? "Entry step"
                    : "Set as entry"}
                </button>
                <button
                  className="inspector-action is-danger-subtle"
                  disabled={Boolean(busyAction)}
                  onClick={deleteStep}
                  type="button"
                >
                  Remove step
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      <section className="flow-step-index-section">
        <div className="flow-section-heading">
          <span className="section-label">STEPS</span>
          <span className="flow-section-count">{sceneSteps.length}</span>
        </div>
        <div className="flow-step-index">
          {sceneSteps.map((step) => (
            <button
              aria-current={step.nodeId === selectedStep?.nodeId}
              className={`flow-step-index-item${
                step.nodeId === selectedStep?.nodeId ? " is-selected" : ""
              }`}
              data-flow-step-id={step.stepId}
              key={step.nodeId}
              onClick={() => {
                onSelectStep(step.stepId);
                setEditing(null);
              }}
              type="button"
            >
              <span className="flow-step-order">{step.order + 1}</span>
              <span className="flow-step-index-copy">
                <strong>{step.title}</strong>
                <code>{step.routePath ?? "No route binding"}</code>
              </span>
              <i
                aria-hidden
                className={`flow-step-resolution is-${step.resolution}`}
                title={step.resolution}
              />
            </button>
          ))}
        </div>
      </section>
      <section className="flow-danger-zone">
        <span className="section-label">FLOW SOURCE</span>
        <button
          className={`inspector-action ${deleteArmed ? "is-danger" : "is-danger-subtle"}`}
          disabled={Boolean(busyAction)}
          onClick={() => {
            if (!deleteArmed) {
              setDeleteArmed(true);
              return;
            }
            void onDeleteFlow(flow.id);
          }}
          type="button"
        >
          {deleteArmed ? "Confirm delete flow" : "Delete flow"}
        </button>
      </section>
    </aside>
  );
}

function inferredFlowDisplay(flow: InferredFlow, generatedAt: string): Flow {
  return {
    version: 1,
    id: flow.id,
    title: flow.title,
    description: flow.description,
    status: "draft",
    entryStepId: flow.entryStepId,
    tags: ["inferred", "read-only"],
    steps: flow.steps.map((step) => ({
      id: step.id,
      title: step.title,
      ...(step.routePath ? { routePath: step.routePath } : {}),
      ...(step.screenId ? { screenId: step.screenId } : {}),
      ...(step.action ? { action: step.action } : {}),
      noteIds: [],
      nextStepIds: step.nextStepIds,
    })),
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

function InferredFlowInspector({
  flow,
  scene,
}: {
  flow: InferredFlow;
  scene: FlowScene;
}) {
  const selectedStep =
    flow.steps.find((step) => step.id === scene.selectedStepId) ??
    flow.steps.find((step) => step.id === flow.entryStepId) ??
    flow.steps[0];
  return (
    <aside
      className="atlas-inspector flow-inspector"
      data-inferred-flow-id={flow.id}
      data-inferred-flow-read-only="true"
    >
      <div className="inspector-titlebar">
        <div>
          <Route size={13} />
          <strong>Inferred flow</strong>
        </div>
      </div>
      <section className="flow-author-section">
        <span className="section-label">SOURCE UNDERSTANDING</span>
        <div className="well-card flow-source-card">
          <code>{flow.adapterIds.join(", ")}</code>
          <span className="flow-source-meta">
            read-only candidate · {Math.round(flow.confidence * 100)}%
          </span>
        </div>
        <p className="flow-definition-copy">{flow.description}</p>
      </section>
      <section className="flow-author-section">
        <span className="section-label">EVIDENCE</span>
        <dl className="inspector-facts-grid">
          <div>
            <dt>Transitions</dt>
            <dd>{flow.transitionCount}</dd>
          </div>
          <div>
            <dt>Steps</dt>
            <dd>{flow.steps.length}</dd>
          </div>
          <div>
            <dt>Traversal</dt>
            <dd>{flow.truncated ? "bounded" : "complete"}</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>derived</dd>
          </div>
        </dl>
      </section>
      {selectedStep && (
        <section className="flow-author-section">
          <span className="section-label">SELECTED STEP</span>
          <div className="well-card flow-step-well">
            <strong>{selectedStep.title}</strong>
            <code>
              {selectedStep.routePath ??
                selectedStep.endpointId ??
                selectedStep.kind}
            </code>
            {selectedStep.action && <span>{selectedStep.action}</span>}
          </div>
          <div className="flow-evidence-list">
            {selectedStep.sources.map((source) => (
              <code key={`${source.filePath}:${source.line ?? 1}`}>
                {source.filePath}:{source.line ?? 1}
              </code>
            ))}
          </div>
        </section>
      )}
      <section className="flow-author-section">
        <span className="section-label">PROMOTION</span>
        <p className="flow-definition-copy">
          This candidate never edits project source or masquerades as a recorded
          journey. Record or trace the flow to create an authoritative file in{" "}
          <code>.topo/flows</code>.
        </p>
      </section>
    </aside>
  );
}

function FlowsView(props: AtlasWorkspaceProps) {
  const [selectedInferredFlowId, setSelectedInferredFlowId] = useStateCompat<
    string | undefined
  >(props.flows.length === 0 ? props.graph.inferredFlows[0]?.id : undefined);
  const [selectedInferredStepId, setSelectedInferredStepId] = useStateCompat<
    string | undefined
  >(
    props.flows.length === 0
      ? props.graph.inferredFlows[0]?.entryStepId
      : undefined,
  );
  const selectedRecorded =
    props.flows.find((flow) => flow.id === props.selectedFlowId) ??
    props.flows[0];
  const selectedInferred = props.graph.inferredFlows.find(
    (flow) => flow.id === selectedInferredFlowId,
  );
  const inferredDisplayFlows = useMemo(
    () =>
      props.graph.inferredFlows.map((flow) =>
        inferredFlowDisplay(flow, props.graph.generatedAt),
      ),
    [props.graph.generatedAt, props.graph.inferredFlows],
  );
  const displayFlows = useMemo(
    () => [...props.flows, ...inferredDisplayFlows],
    [inferredDisplayFlows, props.flows],
  );
  const selected = selectedInferred
    ? inferredDisplayFlows.find((flow) => flow.id === selectedInferred.id)
    : (selectedRecorded ?? inferredDisplayFlows[0]);
  const routePaths = new Set(
    props.graph.screens.map((screen) => screen.routePath),
  );
  const scene = useMemo(
    () =>
      createFlowScene(
        props.graph,
        displayFlows,
        selected?.id,
        selectedInferred
          ? (selectedInferredStepId ?? selectedInferred.entryStepId)
          : props.selectedFlowStepId,
      ),
    [
      displayFlows,
      props.graph,
      props.selectedFlowStepId,
      selected?.id,
      selectedInferred?.entryStepId,
      selectedInferredStepId,
    ],
  );
  const selectedLane = scene.lanes.find((lane) => lane.id === selected?.id);
  const selectedFlowRef = useRef<HTMLButtonElement>(null);
  const {
    camera,
    fit,
    fitBounds,
    isPanning,
    onViewportResize,
    viewportBindings,
    zoomBy,
  } = useCanvasCamera({
    bounds: scene.selectedBounds,
    fitMaxZoom: 1,
    initialCamera: { x: 30, y: 92, zoom: 1 },
    initialViewport: { width: 928, height: 778 },
    interactionMode: props.interactionMode,
    maxZoom: 2.5,
    minZoom: 0.04,
    padding: 16,
  });
  useEffect(() => {
    fit();
  }, [fit, scene.selectedFlowId]);
  useEffect(() => {
    selectedFlowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);
  useEffect(() => {
    if (props.selectedFlowId && selectedRecorded?.id === props.selectedFlowId) {
      setSelectedInferredFlowId(undefined);
      setSelectedInferredStepId(undefined);
    }
  }, [props.selectedFlowId, selectedRecorded?.id]);
  useEffect(() => {
    if (selectedRecorded) return;
    if (
      selectedInferredFlowId &&
      props.graph.inferredFlows.some(
        (flow) => flow.id === selectedInferredFlowId,
      )
    ) {
      return;
    }
    const first = props.graph.inferredFlows[0];
    if (!first) return;
    setSelectedInferredFlowId(first.id);
    setSelectedInferredStepId(first.entryStepId);
  }, [props.graph.inferredFlows, selectedInferredFlowId, selectedRecorded]);
  return (
    <div className="three-pane atlas-flows-view">
      <aside className="atlas-sidebar">
        <AtlasTabs
          active="flows"
          counts={atlasTabCounts(props.graph, props.flows)}
          onNavigate={props.onNavigate}
        />
        <div className="sidebar-section-label flow-list-heading">
          <span>RECORDED FLOWS</span>
          <button
            aria-label="Create flow"
            disabled={Boolean(props.busyAction)}
            onClick={() => void props.onCreateFlow()}
            title="Create flow"
            type="button"
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="flow-list">
          {props.flows.map((flow) => (
            <button
              className={flow.id === selected?.id ? "is-selected" : ""}
              data-flow-id={flow.id}
              key={flow.id}
              onClick={() => {
                setSelectedInferredFlowId(undefined);
                setSelectedInferredStepId(undefined);
                props.onSelectFlow(flow.id);
                props.onSelectFlowStep(
                  flow.entryStepId ?? flow.steps[0]?.id ?? "",
                );
              }}
              ref={flow.id === selected?.id ? selectedFlowRef : undefined}
              type="button"
            >
              <span className="flow-list-dot" />
              <strong>{flow.title}</strong>
              <span>{flow.steps.length}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-section-label flow-list-heading">
          <span>INFERRED JOURNEYS</span>
          <small>{props.graph.inferredFlows.length}</small>
        </div>
        <div
          className="flow-list"
          data-inferred-flow-count={props.graph.inferredFlows.length}
        >
          {props.graph.inferredFlows.map((flow) => (
            <button
              className={flow.id === selectedInferred?.id ? "is-selected" : ""}
              data-flow-id={flow.id}
              data-flow-provenance="inferred"
              key={flow.id}
              onClick={() => {
                setSelectedInferredFlowId(flow.id);
                setSelectedInferredStepId(flow.entryStepId);
              }}
              ref={flow.id === selected?.id ? selectedFlowRef : undefined}
              type="button"
            >
              <span className="flow-list-dot" />
              <strong>{flow.title}</strong>
              <span>{Math.round(flow.confidence * 100)}%</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="atlas-canvas-panel flow-canvas-panel">
        <div className="canvas-titlebar">
          <strong>
            {selected?.title ?? "Book a job"}
            {selected && (
              <small>
                {selected.steps.length} steps ·{" "}
                {selectedLane?.breakCount
                  ? `${selectedLane.breakCount} break${selectedLane.breakCount === 1 ? "" : "s"}`
                  : "clean"}
              </small>
            )}
          </strong>
          <CanvasZoom
            onFit={fit}
            onFitAll={() =>
              fitBounds(scene.bounds, {
                maxZoom: 0.72,
                minZoom: 0.04,
                padding: 56,
              })
            }
            onZoomIn={() => zoomBy(1.2)}
            onZoomOut={() => zoomBy(1 / 1.2)}
            zoom={camera.zoom}
          />
        </div>
        <div
          {...viewportBindings}
          aria-label="Topo flow canvas. Drag to pan, scroll to zoom, select a step, and press 0 to fit."
          className={`screen-canvas flow-topology-canvas${isPanning ? " is-panning" : ""}`}
          data-camera-x={Math.round(camera.x * 100) / 100}
          data-camera-y={Math.round(camera.y * 100) / 100}
          data-camera-zoom={Math.round(camera.zoom * 1000) / 1000}
          data-flow-focus-count={scene.focusFlowIds.length}
          data-flow-lane-count={scene.lanes.length}
          data-flow-provenance={selectedInferred ? "inferred" : "recorded"}
          data-flow-scene-aspect={
            Math.round(
              (scene.bounds.width / Math.max(1, scene.bounds.height)) * 1_000,
            ) / 1_000
          }
          data-flow-scene-height={Math.round(scene.bounds.height)}
          data-flow-scene-version={scene.version}
          data-flow-scene-width={Math.round(scene.bounds.width)}
          data-renderer="pixi-topology"
          data-selected-flow-id={scene.selectedFlowId}
          data-selected-flow-step-id={scene.selectedStepId}
          role="application"
          tabIndex={0}
        >
          {displayFlows.length === 0 && (
            <div className="empty-workspace-state">
              <Route size={22} />
              <h2>No flows recorded</h2>
              <p>
                Add a JSON flow in <code>.topo/flows</code> or trace a
                Playwright journey to make this workspace live.
              </p>
            </div>
          )}
          {selected && (
            <Suspense
              fallback={<div className="atlas-pixi-fallback" aria-hidden />}
            >
              <PixiFlowCanvas
                camera={camera}
                onResize={onViewportResize}
                onSelectStep={(flowId, stepId) => {
                  if (
                    props.graph.inferredFlows.some((flow) => flow.id === flowId)
                  ) {
                    setSelectedInferredFlowId(flowId);
                    setSelectedInferredStepId(stepId);
                  } else {
                    setSelectedInferredFlowId(undefined);
                    setSelectedInferredStepId(undefined);
                    props.onSelectFlow(flowId);
                    props.onSelectFlowStep(stepId);
                  }
                }}
                scene={scene}
                snapshots={props.snapshots}
              />
            </Suspense>
          )}
          <span className="screen-snapshot-a11y">
            {props.flows.length} recorded flows and{" "}
            {props.graph.inferredFlows.length} inferred journey candidates;{" "}
            {selected ? flowBreaks(selected, routePaths).length : 0} unresolved
            routes in the selected journey.
          </span>
        </div>
      </section>
      {selectedInferred ? (
        <InferredFlowInspector flow={selectedInferred} scene={scene} />
      ) : (
        <FlowInspector
          busyAction={props.busyAction}
          flow={selectedRecorded}
          graph={props.graph}
          onDeleteFlow={props.onDeleteFlow}
          onSelectStep={props.onSelectFlowStep}
          onUpdateFlow={props.onUpdateFlow}
          scene={scene}
        />
      )}
    </div>
  );
}

function previewFilePath(component?: ComponentNode): string {
  if (!component) return "Component.topo.tsx";
  return component.source.filePath.replace(/\.(tsx|jsx|ts|js)$/, ".topo.$1");
}

function ComponentInspector({
  artifacts,
  component,
  connected,
  graph,
  busyAction,
  onCaptureComponent,
  onScaffoldComponentPreview,
  onSelectComponentPreview,
  onSelectScreen,
  selectedPreviewId,
}: {
  artifacts: StudioComponentPreviewArtifact[];
  component?: ComponentNode;
  connected: boolean;
  graph: ApplicationGraph;
  busyAction?: string;
  onCaptureComponent: (componentId: string) => void;
  onScaffoldComponentPreview: (
    componentId: string,
  ) => Promise<ComponentPreviewScaffoldResult | undefined>;
  onSelectComponentPreview: (previewId: string) => void;
  onSelectScreen: (screenId: string) => void;
  selectedPreviewId?: string;
}) {
  const [copied, setCopied] = useStateCompat(false);
  const [scaffoldResult, setScaffoldResult] =
    useStateCompat<ComponentPreviewScaffoldResult>();
  useEffect(() => {
    setCopied(false);
    setScaffoldResult(undefined);
  }, [component?.id]);
  const consumers = component?.usedBy.map((screenId) => ({
    screenId,
    screen: graph.screens.find((screen) => screen.id === screenId),
  }));
  const componentArtifacts = component
    ? artifacts.filter((artifact) => artifact.targetId === component.id)
    : [];
  const capturedArtifacts = componentArtifacts.filter(
    (artifact) => artifact.status === "captured",
  );
  const activePreviewId =
    component?.previewSources.find(
      (preview) => preview.id === selectedPreviewId,
    )?.id ?? component?.previewSources[0]?.id;
  const previewDraftFinding = component
    ? graph.findings.find(
        (finding) => finding.id === `component-preview-draft:${component.id}`,
      )
    : undefined;
  const reason = previewDraftFinding
    ? previewDraftFinding.description
    : component?.previewStatus === "renderable"
      ? "A story, colocated preview, configured fixture, accepted generated stub, or safe zero-required-prop export was detected."
      : component?.previewStatus === "blocked"
        ? "A preview source exists, but the current preview environment cannot render it."
        : component?.previewStatus === "unknown"
          ? "Preview coverage has not been classified by the active adapter."
          : "No explicit preview source was detected. Topo will not guess required fixtures or props.";
  return (
    <aside
      className="atlas-inspector component-detail"
      data-preview-scaffold-state={
        scaffoldResult?.mode ??
        (previewDraftFinding
          ? "fixture-required"
          : connected
            ? "available"
            : "offline")
      }
    >
      <div className="component-detail-kicker">
        <PanelRight size={13} />
        <strong>Component</strong>
      </div>
      <h1>{component?.name ?? "CustomerSummaryCard"}</h1>
      <code>
        {component?.source.filePath ??
          "components/ui/customer-summary-card.tsx"}
      </code>
      <dl>
        <div>
          <dt>Used by</dt>
          <dd>{component?.usedBy.length ?? 0} routes</dd>
        </div>
        <div>
          <dt>Preview status</dt>
          <dd
            className={
              component?.previewStatus === "renderable"
                ? "live-text"
                : "warning-text"
            }
          >
            {component?.previewStatus ?? "Unknown"}
          </dd>
        </div>
      </dl>
      <span className="section-label">REASON</span>
      <p className="component-preview-reason">{reason}</p>
      {scaffoldResult && (
        <div className="component-preview-scaffold-result" role="status">
          <Check size={14} />
          <span>
            <strong>
              {scaffoldResult.mode === "ready"
                ? "Preview created and discovered"
                : "Fixture draft created"}
            </strong>
            <small>
              {scaffoldResult.mode === "ready"
                ? "Topo refreshed the component graph immediately."
                : "Add deterministic prop values, then export the prepared preview function."}
            </small>
          </span>
        </div>
      )}
      {component && component.previewSources.length > 0 && (
        <>
          <span className="section-label">PREVIEW VARIANTS</span>
          <div className="component-preview-variants">
            {component.previewSources.map((preview) => {
              const artifact = componentArtifacts.find(
                (candidate) => candidate.previewId === preview.id,
              );
              return (
                <button
                  aria-pressed={preview.id === activePreviewId}
                  className={
                    preview.id === activePreviewId ? "is-selected" : undefined
                  }
                  data-component-preview-id={preview.id}
                  key={preview.id}
                  onClick={() => onSelectComponentPreview(preview.id)}
                  type="button"
                >
                  <span
                    className={
                      artifact?.status === "captured"
                        ? "success-dot"
                        : artifact?.status === "failed"
                          ? "warning-dot"
                          : "muted-dot"
                    }
                  />
                  <span>
                    <strong>{preview.title}</strong>
                    <code>
                      {preview.discovery ?? "adapter"} · {preview.adapterId}
                    </code>
                  </span>
                  <small>{artifact?.status ?? "not captured"}</small>
                </button>
              );
            })}
          </div>
          {connected && (
            <button
              className="secondary-button wide-button"
              onClick={() => onCaptureComponent(component.id)}
              type="button"
            >
              <RefreshCw size={13} />
              {capturedArtifacts.length > 0
                ? "Refresh preview capture"
                : "Capture preview"}
            </button>
          )}
        </>
      )}
      {(consumers?.length ?? 0) > 0 && (
        <>
          <span className="section-label">USED BY</span>
          <div className="component-consumers">
            {consumers?.map(({ screenId, screen }) => (
              <button
                disabled={!screen}
                key={screenId}
                onClick={() => onSelectScreen(screenId)}
                type="button"
              >
                <code>{screen?.routePath ?? screenId}</code>
                <span>{screen ? "Open route" : "Unresolved"}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {component?.previewStatus !== "renderable" && (
        <>
          <span className="section-label">ACTION</span>
          {connected ? (
            <button
              className="primary-button wide-button"
              disabled={
                !component ||
                Boolean(previewDraftFinding) ||
                busyAction === "scaffold-component-preview"
              }
              onClick={() => {
                if (!component) return;
                void onScaffoldComponentPreview(component.id).then((result) => {
                  if (result) setScaffoldResult(result);
                });
              }}
              type="button"
            >
              {busyAction === "scaffold-component-preview"
                ? "Creating preview draft…"
                : previewDraftFinding
                  ? "Fixture draft exists"
                  : "Create preview draft"}
            </button>
          ) : (
            <button
              className="primary-button wide-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(previewFilePath(component))
                  .then(() => setCopied(true));
              }}
              type="button"
            >
              {copied ? "Preview path copied" : "Copy preview path"}
            </button>
          )}
          <code>{previewFilePath(component)}</code>
        </>
      )}
    </aside>
  );
}

function selectedAtlasComponent(props: AtlasWorkspaceProps) {
  return (
    props.graph.components.find(
      (item) => item.id === props.selectedComponentId,
    ) ??
    props.graph.components.find(
      (item) => item.previewStatus !== "renderable",
    ) ??
    props.graph.components[0]
  );
}

type ComponentCanvasView = "preview" | "map";

function ComponentViewSwitch({
  mode,
  onNavigate,
}: {
  mode: ComponentCanvasView;
  onNavigate: (path: string) => void;
}) {
  return (
    <div
      aria-label="Component canvas view"
      className="component-view-switch"
      role="group"
    >
      <button
        aria-pressed={mode === "preview"}
        className={mode === "preview" ? "is-active" : ""}
        onClick={() => onNavigate("/atlas/components")}
        type="button"
      >
        <Monitor size={11} /> Preview
      </button>
      <button
        aria-pressed={mode === "map"}
        className={mode === "map" ? "is-active" : ""}
        onClick={() => onNavigate("/atlas/components?canvas=map")}
        type="button"
      >
        <Box size={11} /> Map
      </button>
    </div>
  );
}

function boundedCoverageRows(
  components: readonly ComponentNode[],
  selected: ComponentNode | undefined,
  limit: number,
): ComponentNode[] {
  const visible = components.slice(0, limit);
  if (!selected || !components.some((item) => item.id === selected.id)) {
    return visible;
  }
  if (visible.some((item) => item.id === selected.id)) return visible;
  return [...visible.slice(0, Math.max(0, limit - 1)), selected];
}

function ComponentCoverageSection({
  components,
  count,
  label,
  onSelect,
  selected,
}: {
  components: ComponentNode[];
  count: number;
  label: string;
  onSelect: (id: string) => void;
  selected?: ComponentNode;
}) {
  return (
    <section className="component-coverage-section">
      <div className="component-coverage-heading">
        <strong>{label}</strong>
        <span>{count}</span>
      </div>
      <div className="component-compact-list">
        {components.map((component) => (
          <button
            className={component.id === selected?.id ? "is-selected" : ""}
            data-component-id={component.id}
            key={component.id}
            onClick={() => onSelect(component.id)}
            title={component.source.filePath}
            type="button"
          >
            <span
              aria-label={component.previewStatus}
              className={`component-status-dot is-${component.previewStatus}`}
            />
            <code>{component.name}</code>
            <small>
              {component.previewStatus === "renderable"
                ? `${component.usedBy.length} uses`
                : component.previewStatus}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function componentPreviewTimestamp(value: string): string {
  return `${value.replace("T", " ").slice(0, 16)} UTC`;
}

function ComponentPreviewArtifactStage({
  component,
  connected,
  evidence,
  onCapture,
  onNavigate,
}: {
  component: ComponentNode;
  connected: boolean;
  evidence: ComponentPreviewEvidence;
  onCapture: () => void;
  onNavigate: (path: string) => void;
}) {
  const artifact = evidence.artifact;
  const preview = evidence.preview;
  const hasImage = evidence.state === "captured" && Boolean(artifact?.imageUrl);
  return (
    <section
      className="atlas-canvas-panel component-artifact-panel"
      data-component-preview-kind={
        evidence.state === "captured" && !hasImage
          ? "artifact-unavailable"
          : evidence.state
      }
      data-selected-component-id={component.id}
      data-selected-preview-id={evidence.previewId}
    >
      <div className="canvas-titlebar">
        <strong>
          {preview?.source.filePath ?? component.source.filePath}
          {preview && <small>{preview.title}</small>}
        </strong>
        <div className="component-canvas-actions">
          <ComponentViewSwitch mode="preview" onNavigate={onNavigate} />
          <span className="component-preview-scale">100%</span>
        </div>
      </div>
      <div
        aria-label={`Topo component preview for ${component.name}${preview ? `, ${preview.title}` : ""}.`}
        className="component-artifact-canvas"
        role="application"
        tabIndex={0}
      >
        {hasImage && artifact?.imageUrl ? (
          <figure
            className="component-artifact-frame"
            style={{
              aspectRatio: `${artifact.width ?? 720} / ${artifact.height ?? 420}`,
            }}
          >
            <figcaption>
              <span>
                <i /> Captured
              </span>
              <strong>{preview?.title ?? artifact.title}</strong>
              <code>
                {artifact.width ?? "?"} × {artifact.height ?? "?"}
              </code>
            </figcaption>
            <div className="component-artifact-image">
              <img
                alt={`${component.name} · ${preview?.title ?? artifact.title} component preview`}
                draggable={false}
                src={artifact.imageUrl}
              />
            </div>
            <footer>
              <code>{preview?.adapterId ?? artifact.adapterId}</code>
              <span>{componentPreviewTimestamp(artifact.capturedAt)}</span>
            </footer>
          </figure>
        ) : (
          <div
            className={`component-preview-state is-${
              evidence.state === "captured"
                ? "artifact-unavailable"
                : evidence.state
            }`}
            role="status"
          >
            {evidence.state === "failed" ? (
              <AlertTriangle size={22} />
            ) : (
              <Box size={22} />
            )}
            <strong>
              {evidence.state === "failed"
                ? "Preview capture failed"
                : evidence.state === "captured"
                  ? "Captured artifact is unavailable"
                  : "Preview is ready to capture"}
            </strong>
            <p>
              {evidence.state === "failed"
                ? (artifact?.error ??
                  "The preview adapter returned an explicit failure without additional detail.")
                : evidence.state === "captured"
                  ? "The artifact metadata exists, but its local image resource could not be resolved."
                  : "Topo discovered this exact preview source but has not captured its pixels yet."}
            </p>
            <code>{preview?.locator ?? component.source.filePath}</code>
            <button
              className="primary-button"
              disabled={!connected}
              onClick={onCapture}
              type="button"
            >
              <RefreshCw size={13} />
              {connected ? "Capture preview" : "Connect daemon to capture"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ComponentEvidenceView(props: AtlasWorkspaceProps) {
  const selected = selectedAtlasComponent(props);
  const renderable = props.graph.components.filter(
    (item) => item.previewStatus === "renderable",
  );
  const gaps = props.graph.components.filter(
    (item) => item.previewStatus !== "renderable",
  );
  const totalComponents = Math.max(1, props.graph.components.length);
  const screen = selectComponentScreen(
    props.graph,
    selected,
    props.selectedScreenId,
  );
  const evidence = useMemo(
    () =>
      selectScreenEvidence({
        graph: props.graph,
        notes: props.notes,
        snapshots: props.snapshots,
        selectedScreenId: screen?.id,
      }),
    [props.graph, props.notes, props.snapshots, screen?.id],
  );
  const demoScreen = props.graph.rootDir.startsWith("demo://");
  const previewEvidence = useMemo(
    () =>
      selectComponentPreviewEvidence(
        selected,
        props.previewArtifacts,
        props.selectedPreviewId,
      ),
    [props.previewArtifacts, props.selectedPreviewId, selected],
  );

  return (
    <div
      className="three-pane components-view component-evidence-view"
      data-component-view="preview"
      data-selected-component-id={selected?.id}
      data-selected-preview-id={previewEvidence.previewId}
      data-selected-screen-id={evidence.screen?.id}
    >
      <aside className="atlas-sidebar component-coverage-sidebar">
        <AtlasTabs
          active="components"
          counts={atlasTabCounts(props.graph, props.flows)}
          onNavigate={props.onNavigate}
        />
        <div className="coverage-block">
          <div>
            <span className="section-label">PREVIEW COVERAGE</span>
            <span>
              {renderable.length} / {props.graph.components.length}
            </span>
          </div>
          <div className="coverage-track">
            {(["renderable", "missing", "blocked", "unknown"] as const).map(
              (status) => (
                <span
                  className={`is-${status}`}
                  key={status}
                  style={{
                    width: `${
                      (props.graph.components.filter(
                        (component) => component.previewStatus === status,
                      ).length /
                        totalComponents) *
                      100
                    }%`,
                  }}
                  title={`${status} components`}
                />
              ),
            )}
          </div>
        </div>
        <div className="component-coverage-sections">
          <ComponentCoverageSection
            components={boundedCoverageRows(renderable, selected, 5)}
            count={renderable.length}
            label="Renderable"
            onSelect={props.onSelectComponent}
            selected={selected}
          />
          <ComponentCoverageSection
            components={boundedCoverageRows(gaps, selected, 3)}
            count={gaps.length}
            label="Coverage gaps"
            onSelect={props.onSelectComponent}
            selected={selected}
          />
        </div>
        <button
          className="component-open-map"
          onClick={() => props.onNavigate("/atlas/components?canvas=map")}
          type="button"
        >
          <Box size={12} /> Browse all {props.graph.components.length} on map
        </button>
      </aside>
      {selected && previewEvidence.preview ? (
        <ComponentPreviewArtifactStage
          component={selected}
          connected={props.connected}
          evidence={previewEvidence}
          onCapture={() => props.onCaptureComponents([selected.id])}
          onNavigate={props.onNavigate}
        />
      ) : (
        <ScreenEvidenceStage
          ariaLabel="Topo component usage canvas. The selected component is shown in an exact consuming application screen."
          artboardOverlay={
            demoScreen ? (
              <div className="component-demo-screen">
                <PreviewMock decorative />
              </div>
            ) : undefined
          }
          className="component-screen-evidence-panel"
          connected={props.connected}
          contextLabel={
            evidence.screen?.source.filePath ?? "No consuming screen"
          }
          evidence={evidence}
          interactionMode={props.interactionMode}
          previewBaseUrl={props.previewBaseUrl}
          toolbarActions={
            <ComponentViewSwitch mode="preview" onNavigate={props.onNavigate} />
          }
        />
      )}
      <ComponentInspector
        artifacts={props.previewArtifacts}
        busyAction={props.busyAction}
        component={selected}
        connected={props.connected}
        graph={props.graph}
        onCaptureComponent={(componentId) =>
          props.onCaptureComponents([componentId])
        }
        onScaffoldComponentPreview={props.onScaffoldComponentPreview}
        onSelectComponentPreview={props.onSelectComponentPreview}
        onSelectScreen={(screenId) => {
          props.onSelectScreen(screenId);
          props.onNavigate("/atlas/routes");
        }}
        selectedPreviewId={previewEvidence.previewId}
      />
    </div>
  );
}

function ComponentsView(props: AtlasWorkspaceProps) {
  return props.canvasView === "map" ? (
    <ComponentMapView {...props} />
  ) : (
    <ComponentEvidenceView {...props} />
  );
}

function endpointSourceText(source: {
  filePath: string;
  line?: number;
}): string {
  return `${source.filePath}${source.line ? `:${source.line}` : ""}`;
}

function ApiEndpointsView(props: AtlasWorkspaceProps) {
  const [query, setQuery] = useStateCompat("");
  const [method, setMethod] = useStateCompat("ALL");
  const [origin, setOrigin] = useStateCompat<"ALL" | "SOURCE" | "CONTRACT">(
    "ALL",
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const methods = useMemo(
    () => [
      "ALL",
      ...new Set(props.graph.apiEndpoints.map((endpoint) => endpoint.method)),
    ],
    [props.graph.apiEndpoints],
  );
  const endpointStats = useMemo(() => {
    let source = 0;
    let contract = 0;
    for (const endpoint of props.graph.apiEndpoints) {
      const endpointOrigin = apiEndpointOrigin(endpoint);
      if (endpointOrigin === "source" || endpointOrigin === "mixed") {
        source += 1;
      }
      if (endpointOrigin === "contract" || endpointOrigin === "mixed") {
        contract += 1;
      }
    }
    return { source, contract };
  }, [props.graph.apiEndpoints]);
  const matches = useMemo(
    () =>
      props.graph.apiEndpoints.filter((endpoint) => {
        if (method !== "ALL" && endpoint.method !== method) return false;
        const endpointOrigin = apiEndpointOrigin(endpoint);
        if (
          origin === "SOURCE" &&
          endpointOrigin !== "source" &&
          endpointOrigin !== "mixed"
        ) {
          return false;
        }
        if (
          origin === "CONTRACT" &&
          endpointOrigin !== "contract" &&
          endpointOrigin !== "mixed"
        ) {
          return false;
        }
        if (!normalizedQuery) return true;
        return [
          endpoint.method,
          endpoint.path,
          endpoint.operationId,
          endpoint.summary,
          endpoint.description,
          ...endpoint.tags,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      }),
    [method, normalizedQuery, origin, props.graph.apiEndpoints],
  );
  const visible = matches.slice(0, 200);
  const selectedFromUrl = props.graph.apiEndpoints.find(
    (endpoint) => endpoint.id === props.selectedEndpointId,
  );
  const selected = selectedFromUrl ?? matches[0];
  const selectedIsFilteredOut = Boolean(
    selectedFromUrl &&
    !matches.some((endpoint) => endpoint.id === selectedFromUrl.id),
  );
  const groups = useMemo(() => {
    const result = new Map<string, ApiEndpointNode[]>();
    for (const endpoint of visible) {
      const group = apiEndpointGroup(endpoint);
      result.set(group, [...(result.get(group) ?? []), endpoint]);
    }
    return [...result.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [visible]);

  useEffect(() => {
    if (selected && selected.id !== props.selectedEndpointId) {
      props.onSelectApiEndpoint(selected.id);
    }
  }, [props.onSelectApiEndpoint, selected?.id, props.selectedEndpointId]);

  const clearFilters = () => {
    setQuery("");
    setMethod("ALL");
    setOrigin("ALL");
  };
  const usage = selected
    ? describeApiEndpointUsage(selected, props.graph)
    : undefined;
  const selectedOrigin = selected ? apiEndpointOrigin(selected) : undefined;
  const selectedOriginLabel = selectedOrigin
    ? apiEndpointOriginLabel(selectedOrigin)
    : undefined;

  return (
    <div
      className="api-endpoints-workspace"
      data-api-endpoint-count={props.graph.apiEndpoints.length}
      data-visible-api-endpoint-count={visible.length}
    >
      <aside className="api-endpoints-sidebar">
        <AtlasTabs
          active="apis"
          counts={atlasTabCounts(props.graph, props.flows)}
          onNavigate={props.onNavigate}
        />
        <div className="api-endpoints-heading">
          <div className="api-heading-kicker">
            <span className="section-label">API ATLAS</span>
            <span className="api-index-status">
              <span className="success-dot" /> Indexed
            </span>
          </div>
          <strong>{props.graph.apiEndpoints.length} operations</strong>
          <p>Follow an operation from contract to source and user journey.</p>
          <div className="api-sidebar-stats">
            <span>
              <strong>{endpointStats.source}</strong> source
            </span>
            <span>
              <strong>{endpointStats.contract}</strong> contract
            </span>
          </div>
        </div>
        <label className="api-endpoint-search">
          <Search size={13} />
          <input
            aria-label="Filter API endpoints"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Path, operation, tag…"
            value={query}
          />
        </label>
        <div
          className="api-method-filters"
          role="group"
          aria-label="HTTP method"
        >
          {methods.map((item) => (
            <button
              aria-pressed={method === item}
              className={method === item ? "is-active" : undefined}
              key={item}
              onClick={() => setMethod(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div
          className="api-origin-filters"
          role="group"
          aria-label="Evidence origin"
        >
          {(
            [
              ["ALL", "All evidence"],
              ["SOURCE", "Source"],
              ["CONTRACT", "Contract"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={origin === value}
              className={origin === value ? "is-active" : undefined}
              key={value}
              onClick={() => setOrigin(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {(query || method !== "ALL" || origin !== "ALL") && (
          <div className="api-filter-summary">
            <span>
              {matches.length} matching operation
              {matches.length === 1 ? "" : "s"}
            </span>
            <button onClick={clearFilters} type="button">
              Clear
            </button>
          </div>
        )}
        {selectedIsFilteredOut && (
          <button
            className="api-selection-notice"
            onClick={clearFilters}
            type="button"
          >
            <span>Selected operation is outside these filters.</span>
            <strong>Show it</strong>
          </button>
        )}
        <div className="api-endpoint-list">
          {visible.slice(0, 80).map((endpoint) => (
            <button
              className={
                endpoint.id === selected?.id ? "is-selected" : undefined
              }
              key={endpoint.id}
              onClick={() => props.onSelectApiEndpoint(endpoint.id)}
              type="button"
            >
              <span data-method={endpoint.method}>{endpoint.method}</span>
              <span className="api-endpoint-row-copy">
                <code>{endpoint.path}</code>
                <small>
                  {endpoint.summary ??
                    endpoint.operationId ??
                    apiEndpointOriginLabel(apiEndpointOrigin(endpoint))}
                </small>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <main className="api-endpoints-canvas">
        <header className="api-canvas-header">
          <div>
            <span className="section-label">APPLICATION INTERFACE</span>
            <h1>
              API operations <small>{matches.length} shown</small>
            </h1>
            <p>
              A searchable map of what the application exposes and what Topo can
              prove about each operation.
            </p>
          </div>
          <div className="api-canvas-summary" aria-label="API atlas summary">
            <div>
              <strong>{props.graph.apiEndpoints.length}</strong>
              <span>total</span>
            </div>
            <div>
              <strong>{endpointStats.source}</strong>
              <span>source</span>
            </div>
            <div>
              <strong>{endpointStats.contract}</strong>
              <span>contract</span>
            </div>
          </div>
        </header>
        {groups.length === 0 ? (
          <div className="api-empty-state">
            {props.graph.apiEndpoints.length === 0 ? (
              <>
                <Code2 size={22} />
                <strong>No API endpoints discovered</strong>
                <p>
                  Add a route handler, literal router registration, or OpenAPI
                  contract and rescan the project.
                </p>
              </>
            ) : (
              <>
                <Search size={22} />
                <strong>No operations match these filters</strong>
                <p>
                  Try a broader search or clear the active method and evidence
                  filters.
                </p>
                <button
                  className="secondary-button"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : (
          groups.map(([group, endpoints]) => (
            <section className="api-endpoint-group" key={group}>
              <header>
                <div>
                  <strong>/{group}</strong>
                  <small>API domain</small>
                </div>
                <span>{endpoints.length} ops</span>
              </header>
              <div>
                {endpoints.map((endpoint) => (
                  <button
                    className={
                      endpoint.id === selected?.id ? "is-selected" : undefined
                    }
                    key={endpoint.id}
                    onClick={() => props.onSelectApiEndpoint(endpoint.id)}
                    type="button"
                  >
                    <span data-method={endpoint.method}>{endpoint.method}</span>
                    <span className="api-endpoint-row-copy">
                      <code>{endpoint.path}</code>
                      <small>
                        {endpoint.summary ??
                          endpoint.operationId ??
                          endpoint.frameworks.join(" · ")}
                      </small>
                    </span>
                    <span
                      className="api-origin-pill"
                      data-origin={apiEndpointOrigin(endpoint)}
                    >
                      {apiEndpointOriginLabel(apiEndpointOrigin(endpoint))}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
        {matches.length > visible.length && (
          <p className="api-render-limit">
            Showing 200 of {matches.length} operations. Search to narrow the
            canvas.
          </p>
        )}
      </main>
      <aside className="api-endpoint-inspector">
        {selected ? (
          <>
            <div className="api-inspector-kicker">
              <span className="section-label">OPERATION</span>
              <span className="api-origin-pill" data-origin={selectedOrigin}>
                {selectedOriginLabel}
              </span>
            </div>
            <div className="api-selected-title">
              <span data-method={selected.method}>{selected.method}</span>
              <code>{selected.path}</code>
            </div>
            <h2>
              {selected.summary ?? selected.operationId ?? selected.title}
            </h2>
            {selected.description && <p>{selected.description}</p>}
            <dl>
              <div>
                <dt>Security</dt>
                <dd>{selected.security.status}</dd>
              </div>
              <div>
                <dt>Parameters</dt>
                <dd>{selected.parameters.length}</dd>
              </div>
              <div>
                <dt>Responses</dt>
                <dd>{selected.responses.length}</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>{selected.discoveries.length}</dd>
              </div>
            </dl>
            {selected.tags.length > 0 && (
              <div className="api-tag-list" aria-label="Endpoint tags">
                {selected.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            )}
            {usage && (
              <section className="api-usage-section">
                <div className="api-inspector-section-heading">
                  <span className="section-label">SURFACE USAGE</span>
                  <small>
                    {usage.transitions.length} detected transition
                    {usage.transitions.length === 1 ? "" : "s"}
                  </small>
                </div>
                <div className="api-usage-stats">
                  <span>
                    <strong>{usage.sourceScreens.length}</strong> screens
                  </span>
                  <span>
                    <strong>{usage.inferredFlows.length}</strong> inferred
                    journeys
                  </span>
                </div>
                {usage.sourceScreens.length > 0 && (
                  <div className="api-usage-list">
                    {usage.sourceScreens.slice(0, 4).map((screen) => (
                      <button
                        key={screen.id}
                        onClick={() => {
                          props.onSelectScreen(screen.id);
                          props.onNavigate("/atlas/routes");
                        }}
                        type="button"
                      >
                        <Route size={13} />
                        <span>
                          <strong>{screen.title}</strong>
                          <code>{screen.routePath}</code>
                        </span>
                        <ChevronRight size={12} />
                      </button>
                    ))}
                    {usage.sourceScreens.length > 4 && (
                      <small className="api-usage-more">
                        +{usage.sourceScreens.length - 4} more source screens
                      </small>
                    )}
                  </div>
                )}
                {usage.inferredFlows.length > 0 && (
                  <div className="api-usage-list">
                    {usage.inferredFlows.map((flow) => (
                      <button
                        key={flow.id}
                        onClick={() => props.onNavigate("/atlas/flows")}
                        type="button"
                      >
                        <GitBranch size={13} />
                        <span>
                          <strong>{flow.title}</strong>
                          <code>
                            {Math.round(flow.confidence * 100)}% inferred · open
                            flows
                          </code>
                        </span>
                        <ChevronRight size={12} />
                      </button>
                    ))}
                  </div>
                )}
                {usage.sourceScreens.length === 0 &&
                  usage.inferredFlows.length === 0 && (
                    <p className="api-usage-empty">
                      No source transition or inferred journey is linked to this
                      operation yet.
                    </p>
                  )}
              </section>
            )}
            <span className="section-label">SOURCE EVIDENCE</span>
            <div className="api-source-list">
              {selected.discoveries.map((discovery) => (
                <article
                  key={`${discovery.adapterId}:${discovery.source.filePath}`}
                >
                  <strong>{discovery.adapterId}</strong>
                  <code>{endpointSourceText(discovery.source)}</code>
                  <small>
                    {discovery.kind} · {Math.round(discovery.confidence * 100)}%
                  </small>
                </article>
              ))}
            </div>
            {selected.responses.length > 0 && (
              <>
                <span className="section-label">RESPONSES</span>
                <div className="api-response-list">
                  {selected.responses.map((response) => (
                    <article key={response.status}>
                      <strong>{response.status}</strong>
                      <span>
                        {response.description ?? "Documented response"}
                      </span>
                      <small>
                        {response.contentTypes.join(", ") ||
                          "content type unspecified"}
                      </small>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="api-empty-inspector">
            <ShieldCheck size={18} />
            <strong>Select an operation</strong>
            <p>
              Its source, contract, security, and journey evidence will appear
              here.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function ComponentMapView(props: AtlasWorkspaceProps) {
  const [componentQuery, setComponentQuery] = useStateCompat("");
  const [expandedGroups, setExpandedGroups] = useStateCompat<
    Record<string, boolean>
  >({});
  const selectedComponentButtonRef = useRef<HTMLButtonElement>(null);
  const selected = selectedAtlasComponent(props);
  const renderable = props.graph.components.filter(
    (item) => item.previewStatus === "renderable",
  );
  const gaps = props.graph.components.filter(
    (item) => item.previewStatus !== "renderable",
  );
  const componentGroups = useMemo(
    () =>
      createComponentGroups(props.graph.components, props.atlasOrganization),
    [props.atlasOrganization, props.graph.components],
  );
  const normalizedQuery = componentQuery.trim().toLocaleLowerCase();
  const visibleComponentGroups = useMemo(
    () =>
      componentGroups
        .map((group) => ({
          ...group,
          components: group.components.filter((component) => {
            if (!normalizedQuery) return true;
            return [
              component.name,
              component.source.filePath,
              component.previewStatus,
              group.label,
              group.sourcePrefix,
            ].some((value) =>
              value.toLocaleLowerCase().includes(normalizedQuery),
            );
          }),
        }))
        .filter((group) => group.components.length > 0),
    [componentGroups, normalizedQuery],
  );
  const scene = useMemo(
    () =>
      createComponentScene(props.graph, selected?.id, {
        organization: props.atlasOrganization,
      }),
    [props.atlasOrganization, props.graph, selected?.id],
  );
  const {
    camera,
    fit,
    fitBounds,
    isPanning,
    onViewportResize,
    viewportBindings,
    zoomBy,
  } = useCanvasCamera({
    bounds: scene.selectedBounds,
    fitMaxZoom: 1,
    initialCamera: { x: 80, y: 180, zoom: 1 },
    initialViewport: { width: 928, height: 778 },
    interactionMode: props.interactionMode,
    maxZoom: 2.5,
    minZoom: 0.025,
    padding: 36,
  });
  const selectedGroup = scene.groups.find(
    (group) => group.id === scene.selectedGroupId,
  );
  const totalComponents = Math.max(1, props.graph.components.length);
  useEffect(() => {
    fit();
  }, [fit, scene.selectedComponentId]);
  useEffect(() => {
    selectedComponentButtonRef.current?.scrollIntoView({ block: "nearest" });
  }, [scene.selectedComponentId, scene.selectedGroupId]);
  return (
    <div
      className="three-pane components-view component-map-view"
      data-component-view="map"
    >
      <aside className="atlas-sidebar">
        <AtlasTabs
          active="components"
          counts={atlasTabCounts(props.graph, props.flows)}
          onNavigate={props.onNavigate}
        />
        <div className="coverage-block">
          <div>
            <span className="section-label">PREVIEW COVERAGE</span>
            <span>
              {renderable.length} / {props.graph.components.length}
            </span>
          </div>
          <div className="coverage-track">
            {(["renderable", "missing", "blocked", "unknown"] as const).map(
              (status) => (
                <span
                  className={`is-${status}`}
                  key={status}
                  style={{
                    width: `${
                      (props.graph.components.filter(
                        (component) => component.previewStatus === status,
                      ).length /
                        totalComponents) *
                      100
                    }%`,
                  }}
                  title={`${status} components`}
                />
              ),
            )}
          </div>
          <div className="coverage-legend" aria-label="Preview coverage detail">
            <span>
              <i className="is-renderable" /> {renderable.length} ready
            </span>
            <span>
              <i className="is-missing" /> {gaps.length} gaps
            </span>
          </div>
        </div>
        <label className="component-search">
          <Search aria-hidden size={13} />
          <input
            aria-label="Filter components"
            id="topo-component-filter"
            name="component-filter"
            onChange={(event) => setComponentQuery(event.currentTarget.value)}
            placeholder="Filter components"
            type="search"
            value={componentQuery}
          />
          <kbd>{componentGroups.length} groups</kbd>
        </label>
        <div
          className="component-sidebar-scroll"
          data-component-group-count={componentGroups.length}
        >
          {visibleComponentGroups.map((group) => {
            const isCurrent = group.id === scene.selectedGroupId;
            const isExpanded = normalizedQuery
              ? true
              : (expandedGroups[group.id] ?? isCurrent);
            return (
              <section
                className={`component-domain${isCurrent ? " is-current" : ""}`}
                data-component-group-id={group.id}
                key={group.id}
              >
                <button
                  aria-expanded={isExpanded}
                  className="component-domain-heading"
                  onClick={() =>
                    setExpandedGroups((current) => ({
                      ...current,
                      [group.id]: !isExpanded,
                    }))
                  }
                  type="button"
                >
                  <ChevronRight
                    className={isExpanded ? "is-open" : undefined}
                    size={11}
                  />
                  <div>
                    <strong>{group.label}</strong>
                    <small title={group.sourcePrefixes.join(", ")}>
                      {group.source === "configured"
                        ? "configured"
                        : group.sourcePrefix}
                    </small>
                  </div>
                  <span>{group.componentCount}</span>
                </button>
                {isExpanded && (
                  <div className="component-list">
                    {group.components.map((component) => (
                      <button
                        aria-label={`${component.previewStatus} ${component.name} ${component.previewStatus === "renderable" ? `${component.usedBy.length} uses` : component.previewStatus}`}
                        className={
                          component.id === selected?.id ? "is-selected" : ""
                        }
                        data-component-id={component.id}
                        key={component.id}
                        onClick={() => props.onSelectComponent(component.id)}
                        ref={
                          component.id === selected?.id
                            ? selectedComponentButtonRef
                            : undefined
                        }
                        title={component.source.filePath}
                        type="button"
                      >
                        <span
                          aria-label={component.previewStatus}
                          className={`component-status-dot is-${component.previewStatus}`}
                        />
                        <code>{component.name}</code>
                        <small>
                          {component.previewStatus === "renderable"
                            ? `${component.usedBy.length} uses`
                            : component.previewStatus}
                        </small>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {visibleComponentGroups.length === 0 && (
            <div className="component-search-empty">
              No components match “{componentQuery}”.
            </div>
          )}
        </div>
      </aside>
      <section className="atlas-canvas-panel component-canvas-panel">
        <div className="canvas-titlebar">
          <strong>
            {selected?.name ?? "Components"}
            {selectedGroup && <small>{selectedGroup.label}</small>}
          </strong>
          <div className="component-canvas-actions">
            <ComponentViewSwitch mode="map" onNavigate={props.onNavigate} />
            <CanvasZoom
              onFit={fit}
              onFitAll={() =>
                fitBounds(scene.bounds, {
                  maxZoom: 0.68,
                  minZoom: 0.025,
                  padding: 64,
                })
              }
              onFitGroup={() =>
                fitBounds(scene.selectedGroupBounds, {
                  maxZoom: 0.78,
                  minZoom: 0.025,
                  padding: 44,
                })
              }
              onZoomIn={() => zoomBy(1.2)}
              onZoomOut={() => zoomBy(1 / 1.2)}
              zoom={camera.zoom}
            />
          </div>
        </div>
        <div
          {...viewportBindings}
          aria-label="Topo component canvas. Drag to pan, scroll to zoom, select a component, and press 0 to fit."
          className={`screen-canvas component-topology-canvas${isPanning ? " is-panning" : ""}`}
          data-camera-x={Math.round(camera.x * 100) / 100}
          data-camera-y={Math.round(camera.y * 100) / 100}
          data-camera-zoom={Math.round(camera.zoom * 1000) / 1000}
          data-component-group-count={scene.groups.length}
          data-component-scene-aspect={
            Math.round(
              (scene.bounds.width / Math.max(1, scene.bounds.height)) * 1_000,
            ) / 1_000
          }
          data-component-scene-height={Math.round(scene.bounds.height)}
          data-component-scene-version={scene.version}
          data-component-scene-width={Math.round(scene.bounds.width)}
          data-renderer="pixi-topology"
          data-selected-component-id={scene.selectedComponentId}
          data-selected-component-group={scene.selectedGroupId}
          role="application"
          tabIndex={0}
        >
          <Suspense
            fallback={<div className="atlas-pixi-fallback" aria-hidden />}
          >
            <PixiComponentCanvas
              camera={camera}
              onResize={onViewportResize}
              onSelectComponent={props.onSelectComponent}
              onSelectScreen={(screenId) => {
                props.onSelectScreen(screenId);
                props.onNavigate("/atlas/routes");
              }}
              previewArtifacts={props.previewArtifacts}
              scene={scene}
            />
          </Suspense>
          <span className="screen-snapshot-a11y">
            {scene.components.length} components across {scene.groups.length}
            source groups; selected component belongs to{" "}
            {selectedGroup?.label ?? "no group"} and has{" "}
            {scene.routeNodes.length} route consumers.
          </span>
        </div>
      </section>
      <ComponentInspector
        artifacts={props.previewArtifacts}
        busyAction={props.busyAction}
        component={selected}
        connected={props.connected}
        graph={props.graph}
        onCaptureComponent={(componentId) =>
          props.onCaptureComponents([componentId])
        }
        onScaffoldComponentPreview={props.onScaffoldComponentPreview}
        onSelectComponentPreview={props.onSelectComponentPreview}
        onSelectScreen={(screenId) => {
          props.onSelectScreen(screenId);
          props.onNavigate("/atlas/routes");
        }}
        selectedPreviewId={props.selectedPreviewId}
      />
    </div>
  );
}

function LiveScreenView({
  connected,
  onCapture,
  onNavigate,
  previewUrl,
  previewPath,
  routePath,
  unresolvedReason,
}: {
  connected: boolean;
  onCapture: () => void;
  onNavigate: (path: string) => void;
  previewUrl: string;
  previewPath?: string;
  routePath: string;
  unresolvedReason?: string;
}) {
  const [device, setDevice] = useStateCompat<"desktop" | "tablet" | "mobile">(
    "desktop",
  );
  return (
    <div className="live-screen-view">
      <div className="live-toolbar">
        <button onClick={() => onNavigate("/atlas/routes")} type="button">
          <ChevronLeft size={13} /> Atlas
        </button>
        <span className="tool-separator" />
        <button
          className={device === "desktop" ? "is-active" : ""}
          onClick={() => setDevice("desktop")}
          type="button"
        >
          <Monitor size={13} /> Desktop
        </button>
        <button
          aria-label="Tablet"
          className={device === "tablet" ? "is-active" : ""}
          onClick={() => setDevice("tablet")}
          type="button"
        >
          <Frame size={13} />
        </button>
        <button
          aria-label="Mobile"
          className={device === "mobile" ? "is-active" : ""}
          onClick={() => setDevice("mobile")}
          type="button"
        >
          <PanelRight size={13} />
        </button>
        <span className="tool-separator" />
        <button aria-label="Refresh" onClick={onCapture} type="button">
          <RefreshCw size={13} />
        </button>
        <button
          className="primary-button"
          disabled={!previewPath}
          onClick={() =>
            previewPath &&
            window.open(
              createPreviewRouteUrl(previewUrl, previewPath),
              "_blank",
              "noopener,noreferrer",
            )
          }
          type="button"
        >
          <ExternalLink size={12} /> Open
        </button>
      </div>
      <div className="browser-preview" data-device={device}>
        <div className="browser-chrome">
          <span />
          <span />
          <span />
          <code>
            ♙ {new URL(previewUrl).host}
            {previewPath ?? routePath}
          </code>
        </div>
        {connected && previewPath ? (
          <iframe
            src={createPreviewRouteUrl(previewUrl, previewPath)}
            title={`Live preview of ${routePath}`}
          />
        ) : unresolvedReason ? (
          <div className="route-preview-missing">
            <AlertTriangle size={18} />
            <strong>Concrete route example required</strong>
            <code>{routePath}</code>
            <p>{unresolvedReason}</p>
          </div>
        ) : (
          <PreviewMock />
        )}
      </div>
    </div>
  );
}

const probeEffectLabels: Array<[RuntimeEffectKind, string]> = [
  ["navigation", "URL / history"],
  ["network", "Network request"],
  ["dom", "DOM / accessibility"],
  ["dialog", "Dialog / drawer"],
  ["form-submit", "Form submit"],
  ["download", "Download"],
  ["focus", "Focus change"],
  ["storage", "Storage write"],
  ["app-event", "App event"],
  ["runtime-error", "Runtime error"],
];

function ProbeView({
  busyAction,
  connected,
  onRunProbe,
  onSelectProbe,
  probes,
  routePath,
  selectedProbeId,
}: {
  busyAction?: string;
  connected: boolean;
  onRunProbe: (routePath: string) => void;
  onSelectProbe: (id?: string) => void;
  probes: InteractionProbeArtifact[];
  routePath: string;
  selectedProbeId?: string;
}) {
  const routeProbes = probes
    .filter((probe) => probe.routePath === routePath)
    .sort(
      (left, right) =>
        left.control.index - right.control.index ||
        left.id.localeCompare(right.id),
    );
  const selected = selectInteractionProbe(
    routeProbes,
    routePath,
    selectedProbeId,
  );
  const selectedIndex = selected
    ? routeProbes.findIndex((probe) => probe.id === selected.id)
    : -1;
  const skipped = routeProbes.filter((probe) => probe.status === "skipped");
  const effectKinds = new Set(
    selected?.effects.map((effect) => effect.kind) ?? [],
  );
  const isRunning = busyAction === "probe";
  const presentation = selected
    ? {
        "possibly-inert": {
          badge: "ϟ Possibly inert · 0.82",
          verdict: "Possibly inert",
          tone: "warning",
          summary: "No recognized effect was observed.",
          detail:
            "Topo never declares a control broken. This is evidence for review; confirm before filing.",
        },
        "effect-observed": {
          badge: `✓ ${selected.effects.length} effect${selected.effects.length === 1 ? "" : "s"} observed`,
          verdict: "Effect observed",
          tone: "success",
          summary: selected.effects[0]?.summary ?? "The control responded.",
          detail:
            "The isolated activation produced recognized runtime evidence. Inspect every effect below.",
        },
        skipped: {
          badge: "⊘ Safety skip",
          verdict: "Not activated",
          tone: "muted",
          summary:
            selected.evidence[0] ?? "The safety policy skipped this control.",
          detail:
            "Topo records why a control was skipped without activating it.",
        },
        "activation-error": {
          badge: "! Probe error",
          verdict: "Probe incomplete",
          tone: "error",
          summary: selected.error ?? "The control could not be activated.",
          detail:
            "The failure remains durable evidence and is not treated as an inert-control verdict.",
        },
      }[selected.status]
    : {
        badge: "○ Not probed",
        verdict: "No evidence yet",
        tone: "muted",
        summary: `No runtime probe has been recorded for ${routePath}.`,
        detail:
          "Run an isolated local probe to observe controls on this selected route.",
      };

  useEffect(() => {
    if (selected && selected.id !== selectedProbeId) {
      onSelectProbe(selected.id);
    }
  }, [onSelectProbe, selected, selectedProbeId]);

  return (
    <div
      className="probe-view"
      data-probe-count={routeProbes.length}
      data-selected-probe-id={selected?.id}
    >
      <section className="probe-stage">
        <div
          className={`probe-selected-card tone-${presentation.tone}`}
          data-probe-status={selected?.status ?? "not-probed"}
        >
          <span className="probe-badge">{presentation.badge}</span>
          <i />
          <strong>{selected?.control.label ?? routePath}</strong>
          <p>
            {selected
              ? `Probed ${selected.control.locator} in an isolated browser context.`
              : "Awaiting isolated runtime evidence."}
            <br />
            {presentation.summary}
          </p>
        </div>
      </section>
      <aside className="probe-inspector">
        <div className="probe-heading">
          <div>
            <AlertTriangle size={14} />
            <strong>Interaction probe</strong>
          </div>
          <button
            disabled={!connected || isRunning}
            onClick={() => onRunProbe(routePath)}
            type="button"
          >
            <RefreshCw className={isRunning ? "is-spinning" : ""} size={12} />
            {isRunning ? "Probing" : selected ? "Re-run" : "Run probe"}
          </button>
        </div>
        <section>
          <span className="section-label section-count">
            TARGET
            <span>
              {selectedIndex >= 0 ? selectedIndex + 1 : 0} of{" "}
              {routeProbes.length}
            </span>
          </span>
          <div className="well-card horizontal probe-target-picker">
            <label className="probe-target-select-label">
              <span className="sr-only">
                Interaction probe target for {routePath}
              </span>
              <select
                aria-label={`Interaction probe target for ${routePath}`}
                disabled={routeProbes.length === 0}
                name="interaction-probe-target"
                onChange={(event) => onSelectProbe(event.currentTarget.value)}
                value={selected?.id ?? ""}
              >
                {routeProbes.length === 0 && (
                  <option value="">No recorded controls</option>
                )}
                {routeProbes.map((probe) => (
                  <option key={probe.id} value={probe.id}>
                    {probe.control.role} · “{probe.control.label}”
                  </option>
                ))}
              </select>
            </label>
            <span className="probe-target-meta">
              <span>{selected?.status ?? "unobserved"}</span>
              <ChevronDown aria-hidden="true" size={11} />
            </span>
          </div>
        </section>
        <section>
          <span className="section-label section-count">
            OBSERVED EFFECTS <span>{effectKinds.size} of 10</span>
          </span>
          <div className="effect-chips">
            {probeEffectLabels.map(([kind, label]) => {
              const observed = effectKinds.has(kind);
              const effect = selected?.effects.find(
                (candidate) => candidate.kind === kind,
              );
              return (
                <span
                  className={observed ? "is-observed" : ""}
                  key={kind}
                  title={effect?.summary}
                >
                  {observed ? <Check size={9} /> : <X size={9} />} {label}
                </span>
              );
            })}
          </div>
        </section>
        <section className={`probe-verdict tone-${presentation.tone}`}>
          <span className="section-label">VERDICT</span>
          <h2>{presentation.verdict}</h2>
          <strong>
            {selected?.status === "possibly-inert"
              ? "confidence · 0.82"
              : `${selected?.effects.length ?? 0} typed effects`}
          </strong>
          <p>{presentation.detail}</p>
          {selected && (
            <div className="probe-evidence-list">
              {selected.evidence.map((item) => (
                <code key={item}>{item}</code>
              ))}
            </div>
          )}
          {skipped.length > 0 && (
            <article>
              <strong>
                ⊘ &nbsp; {skipped.length} control
                {skipped.length === 1 ? "" : "s"} not probed
              </strong>
              <p>
                {skipped.map((probe) => probe.control.label).join(", ")}. Topo
                records the safety decision without activation.
              </p>
            </article>
          )}
        </section>
      </aside>
    </div>
  );
}

export function AtlasWorkspace(props: AtlasWorkspaceProps) {
  const selectedScreen =
    props.graph.screens.find(
      (screen) => screen.id === props.selectedScreenId,
    ) ?? props.graph.screens[0];
  const selectedPreviewPath = selectedScreen
    ? studioScreenPreviewPath(selectedScreen)
    : "/";
  if (props.view === "live")
    return (
      <LiveScreenView
        connected={props.connected}
        onCapture={props.onCapture}
        onNavigate={props.onNavigate}
        previewUrl={props.previewBaseUrl}
        previewPath={selectedPreviewPath}
        routePath={selectedScreen?.routePath ?? "/"}
        unresolvedReason={
          selectedScreen?.previewRoute?.status === "unresolved"
            ? selectedScreen.previewRoute.reason
            : undefined
        }
      />
    );
  if (props.view === "probe")
    return (
      <ProbeView
        busyAction={props.busyAction}
        connected={props.connected}
        onRunProbe={props.onRunProbe}
        onSelectProbe={props.onSelectProbe}
        probes={props.interactionProbes}
        routePath={selectedScreen?.routePath ?? "/"}
        selectedProbeId={props.selectedProbeId}
      />
    );
  if (props.view === "components") return <ComponentsView {...props} />;
  if (props.view === "apis") return <ApiEndpointsView {...props} />;
  if (props.view === "routes") return <RoutesView {...props} />;
  return <FlowsView {...props} />;
}
