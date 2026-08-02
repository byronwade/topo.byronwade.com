import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { CanvasInteractionMode } from "@topo/react";
import type { RuntimeBridgeEvent } from "@topo/runtime-bridge";
import type { WriteNoteInput } from "@topo/schema";
import {
  findStudioBoard,
  parseStudioSelection,
  patchStudioSelectionHref,
  STUDIO_SELECTION_QUERY_KEYS,
  type StudioSearchMatch,
  type StudioSelectionState,
} from "@topo/studio-api";

import { StatusBar, StudioTopbar } from "./components/Chrome";
import type { StudioLocation, StudioOverlay } from "./design/boards";
import {
  studio as configuredStudio,
  type TopoStudioDefinition,
} from "./studio-config";
import { parseStudioLocation } from "./studio-location";
import { composeProjectStudio } from "./project-studio";
import { TopoStudioProvider, type TopoStudioRuntime } from "./studio-runtime";
import {
  appendFlowTraceEvents,
  createFlowTraceSession,
  flowTraceToWriteInput,
  type FlowTraceSession,
} from "./flow-trace";
import { normalizeStudioSettings, type StudioSettings } from "./studio-model";
import { useTopoData } from "./useTopoData";

const AnnotatePopover = lazy(() =>
  import("./components/AnnotatePopover").then((module) => ({
    default: module.AnnotatePopover,
  })),
);

const CommandPalette = lazy(() =>
  import("./components/Overlays").then((module) => ({
    default: module.CommandPalette,
  })),
);

const DestinationMenu = lazy(() =>
  import("./components/Overlays").then((module) => ({
    default: module.DestinationMenu,
  })),
);

const ExportReviewDialog = lazy(() =>
  import("./components/Overlays").then((module) => ({
    default: module.ExportReviewDialog,
  })),
);

const WelcomeOverlay = lazy(() =>
  import("./components/Overlays").then((module) => ({
    default: module.WelcomeOverlay,
  })),
);

function readSettings(): StudioSettings {
  try {
    return normalizeStudioSettings(
      JSON.parse(localStorage.getItem("topo:studio-settings") ?? "{}"),
    );
  } catch {
    return normalizeStudioSettings(undefined);
  }
}

function withOverlay(
  location: StudioLocation,
  overlay?: StudioOverlay,
): StudioLocation {
  return { ...location, overlay };
}

function preserveSessionQuery(path: string): string {
  const current = new URL(window.location.href);
  const next = new URL(path, current.origin);
  for (const key of [
    "demo",
    "embed",
    "studio",
    ...STUDIO_SELECTION_QUERY_KEYS,
  ]) {
    const value = current.searchParams.get(key);
    if (value && !next.searchParams.has(key)) next.searchParams.set(key, value);
  }
  return `${next.pathname}${next.search}`;
}

function presentCommandShortcut(shortcut?: string): string | undefined {
  if (!shortcut) return undefined;
  const isApple =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  return isApple
    ? shortcut
      : shortcut.replaceAll("⌘", "Ctrl").replaceAll("↵", "Enter");
}

export interface AppProps {
  studio?: TopoStudioDefinition;
}

interface DestinationErrorBoundaryProps {
  children: ReactNode;
  label: string;
}

interface DestinationErrorBoundaryState {
  error?: string;
}

class DestinationErrorBoundary extends Component<
  DestinationErrorBoundaryProps,
  DestinationErrorBoundaryState
> {
  override state: DestinationErrorBoundaryState = {};

  static getDerivedStateFromError(
    error: unknown,
  ): DestinationErrorBoundaryState {
    return {
      error:
        error instanceof Error ? error.message : "Unknown destination error",
    };
  }

  override render() {
    if (this.state.error) {
      return (
        <section className="destination-load-state is-error" role="alert">
          <span className="destination-load-mark" aria-hidden="true">
            !
          </span>
          <div>
            <strong>{this.props.label} could not load</strong>
            <small>{this.state.error}</small>
          </div>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Studio
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}

function DestinationLoading({ label }: { label: string }) {
  return (
    <section
      className="destination-load-state"
      role="status"
      aria-live="polite"
    >
      <span className="destination-load-mark" aria-hidden="true" />
      <div>
        <strong>Loading {label}</strong>
        <small>Preparing this Studio destination…</small>
      </div>
    </section>
  );
}

export function App({ studio: sourceDefinition = configuredStudio }: AppProps) {
  const data = useTopoData();
  const projectStudio = useMemo(
    () => composeProjectStudio(sourceDefinition, data.studioCustomization),
    [data.studioCustomization, sourceDefinition],
  );
  const definition = projectStudio.definition;
  const [location, setLocation] = useState<StudioLocation>(() =>
    parseStudioLocation(definition),
  );
  const [settings, setSettings] = useState<StudioSettings>(() =>
    readSettings(),
  );
  const initialSelection = useMemo<StudioSelectionState>(
    () =>
      parseStudioSelection(
        typeof window === "undefined" ? "/" : window.location.href,
      ),
    [],
  );
  const [selectedScreenId, setSelectedScreenId] = useState<string | undefined>(
    initialSelection.screenId,
  );
  const [selectedFlowId, setSelectedFlowId] = useState<string | undefined>(
    initialSelection.flowId,
  );
  const [selectedFlowStepId, setSelectedFlowStepId] = useState<
    string | undefined
  >(initialSelection.flowStepId);
  const [selectedComponentId, setSelectedComponentId] = useState<
    string | undefined
  >(initialSelection.componentId);
  const [selectedEndpointId, setSelectedEndpointId] = useState<
    string | undefined
  >(initialSelection.endpointId);
  const [selectedPreviewId, setSelectedPreviewId] = useState<
    string | undefined
  >(initialSelection.previewId);
  const [selectedNoteId, setSelectedNoteId] = useState<string | undefined>(
    initialSelection.noteId,
  );
  const [selectedFindingId, setSelectedFindingId] = useState<
    string | undefined
  >(initialSelection.findingId);
  const [selectedProbeId, setSelectedProbeId] = useState<string | undefined>(
    initialSelection.probeId,
  );
  const [canvasMode, setCanvasMode] = useState<CanvasInteractionMode>("select");
  const [flowTrace, setFlowTrace] = useState<FlowTraceSession | undefined>();

  const navigate = useCallback(
    (path: string) => {
      const nextPath = preserveSessionQuery(path);
      window.history.pushState({}, "", nextPath);
      setLocation(parseStudioLocation(definition, nextPath));
    },
    [definition],
  );

  const go = useCallback(
    (destinationOrPath: string, view?: string) => {
      const registered = definition.destinations[destinationOrPath];
      let target = registered?.path ?? destinationOrPath;
      if (!target.startsWith("/")) {
        throw new Error(
          `Unknown Studio destination "${destinationOrPath}"; use a registered id or absolute path`,
        );
      }
      if (view !== undefined) {
        const normalizedView = view.replace(/^\/+|\/+$/g, "");
        if (
          !normalizedView ||
          normalizedView.includes("?") ||
          normalizedView.includes("#") ||
          normalizedView.split("/").includes("..")
        ) {
          throw new Error(`Invalid Studio view "${view}"`);
        }
        const root = target.split("/").filter(Boolean)[0];
        target = `/${root}/${normalizedView}`;
      }
      navigate(target);
    },
    [definition, navigate],
  );

  const closeOverlay = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("overlay");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    setLocation((current) => withOverlay(current, undefined));
  }, []);

  const openOverlay = useCallback(
    (overlay: Exclude<StudioOverlay, undefined>) => {
      const url = new URL(window.location.href);
      url.searchParams.set("overlay", overlay);
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      setLocation((current) => withOverlay(current, overlay));
    },
    [],
  );

  const patchSelection = useCallback(
    (selection: Partial<StudioSelectionState>) => {
      const nextPath = patchStudioSelectionHref(
        window.location.href,
        selection,
      );
      window.history.replaceState({}, "", nextPath);
    },
    [],
  );

  const selectScreen = useCallback(
    (id: string) => {
      setSelectedScreenId(id);
      setSelectedProbeId(undefined);
      patchSelection({ screenId: id, probeId: undefined });
    },
    [patchSelection],
  );
  const selectFlow = useCallback(
    (id: string) => {
      setSelectedFlowId(id);
      patchSelection({ flowId: id });
    },
    [patchSelection],
  );
  const selectFlowStep = useCallback(
    (id: string) => {
      setSelectedFlowStepId(id);
      patchSelection({ flowStepId: id });
    },
    [patchSelection],
  );
  const selectComponent = useCallback(
    (id: string) => {
      setSelectedComponentId(id);
      setSelectedPreviewId(undefined);
      patchSelection({ componentId: id, previewId: undefined });
    },
    [patchSelection],
  );
  const selectComponentPreview = useCallback(
    (id: string) => {
      setSelectedPreviewId(id);
      patchSelection({ previewId: id });
    },
    [patchSelection],
  );
  const selectApiEndpoint = useCallback(
    (id: string) => {
      setSelectedEndpointId(id);
      patchSelection({ endpointId: id });
    },
    [patchSelection],
  );
  const selectNote = useCallback(
    (id: string) => {
      setSelectedNoteId(id);
      patchSelection({ noteId: id });
    },
    [patchSelection],
  );
  const selectFinding = useCallback(
    (id?: string) => {
      setSelectedFindingId(id);
      patchSelection({ findingId: id });
    },
    [patchSelection],
  );
  const selectProbe = useCallback(
    (id?: string) => {
      setSelectedProbeId(id);
      patchSelection({ probeId: id });
    },
    [patchSelection],
  );

  useEffect(() => {
    setLocation(parseStudioLocation(definition));
  }, [definition]);

  useEffect(() => {
    const apply = () => {
      setLocation(parseStudioLocation(definition));
      const selection = parseStudioSelection(window.location.href);
      setSelectedScreenId(selection.screenId);
      setSelectedFlowId(selection.flowId);
      setSelectedFlowStepId(selection.flowStepId);
      setSelectedComponentId(selection.componentId);
      setSelectedEndpointId(selection.endpointId);
      setSelectedPreviewId(selection.previewId);
      setSelectedNoteId(selection.noteId);
      setSelectedFindingId(selection.findingId);
      setSelectedProbeId(selection.probeId);
    };
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, [definition]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openOverlay("command");
      }
      if (event.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOverlay, openOverlay]);

  useEffect(() => {
    localStorage.setItem("topo:studio-settings", JSON.stringify(settings));
    const theme = location.view === "light" ? "light" : settings.theme;
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : theme;
    document.documentElement.dataset.theme = resolved;
  }, [location.view, settings]);

  useEffect(() => {
    let active = true;
    const componentIds = [
      ...data.graph.components.filter(
        (component) => component.previewStatus !== "renderable",
      ),
      ...data.graph.components.filter(
        (component) => component.previewStatus === "renderable",
      ),
    ].map((component) => component.id);
    void import("./studio-selection").then(({ reconcileStudioSelection }) => {
      if (!active) return;
      const reconciled = reconcileStudioSelection(
        {
          screenId: selectedScreenId,
          flowId: selectedFlowId,
          flowStepId: selectedFlowStepId,
          componentId: selectedComponentId,
          endpointId: selectedEndpointId,
          previewId: selectedPreviewId,
          noteId: selectedNoteId,
          findingId: selectedFindingId,
          probeId: selectedProbeId,
        },
        {
          screenIds: data.graph.screens.map((screen) => screen.id),
          componentIds,
          endpointIds: data.graph.apiEndpoints.map((endpoint) => endpoint.id),
          componentPreviews: data.graph.components.map((component) => ({
            componentId: component.id,
            previewIds: component.previewSources.map((preview) => preview.id),
          })),
          noteIds: data.notes.map((note) => note.id),
          findingIds: data.graph.findings.map((finding) => finding.id),
          probes: data.interactionProbes.map((probe) => ({
            id: probe.id,
            screenId:
              probe.screenId ??
              data.graph.screens.find(
                (screen) =>
                  screen.routePath === probe.routePath &&
                  screen.state === "default",
              )?.id,
          })),
          flows: data.flows.map((flow) => ({
            id: flow.id,
            entryStepId: flow.entryStepId,
            stepIds: flow.steps.map((step) => step.id),
          })),
        },
      );
      if (selectedScreenId !== reconciled.selection.screenId)
        setSelectedScreenId(reconciled.selection.screenId);
      if (selectedFlowId !== reconciled.selection.flowId)
        setSelectedFlowId(reconciled.selection.flowId);
      if (selectedFlowStepId !== reconciled.selection.flowStepId)
        setSelectedFlowStepId(reconciled.selection.flowStepId);
      if (selectedComponentId !== reconciled.selection.componentId)
        setSelectedComponentId(reconciled.selection.componentId);
      if (selectedEndpointId !== reconciled.selection.endpointId)
        setSelectedEndpointId(reconciled.selection.endpointId);
      if (selectedPreviewId !== reconciled.selection.previewId)
        setSelectedPreviewId(reconciled.selection.previewId);
      if (selectedNoteId !== reconciled.selection.noteId)
        setSelectedNoteId(reconciled.selection.noteId);
      if (selectedFindingId !== reconciled.selection.findingId)
        setSelectedFindingId(reconciled.selection.findingId);
      if (selectedProbeId !== reconciled.selection.probeId)
        setSelectedProbeId(reconciled.selection.probeId);
      if (Object.keys(reconciled.urlPatch).length > 0) {
        patchSelection(reconciled.urlPatch);
      }
    });
    return () => {
      active = false;
    };
  }, [
    data.flows,
    data.graph.components,
    data.graph.apiEndpoints,
    data.graph.findings,
    data.graph.screens,
    data.interactionProbes,
    data.notes,
    patchSelection,
    selectedComponentId,
    selectedEndpointId,
    selectedPreviewId,
    selectedFlowId,
    selectedFlowStepId,
    selectedFindingId,
    selectedNoteId,
    selectedProbeId,
    selectedScreenId,
  ]);

  const createStudioNote = useCallback(
    async (input: WriteNoteInput) => {
      const created = await data.createNote(input);
      if (created) {
        selectNote(created.id);
        closeOverlay();
        navigate("/notes/detail");
      }
      return created;
    },
    [closeOverlay, data, navigate, selectNote],
  );

  const startFlowTrace = useCallback(() => {
    const sourceFlow = data.flows.find((flow) => flow.id === selectedFlowId);
    const next = createFlowTraceSession({
      graph: data.graph,
      sourceFlow,
      selectedScreenId,
    });
    setFlowTrace(next);
    const firstScreenId = next.routes[0]?.screenId;
    if (firstScreenId) selectScreen(firstScreenId);
    navigate("/atlas/routes");
  }, [
    data.flows,
    data.graph,
    navigate,
    selectScreen,
    selectedFlowId,
    selectedScreenId,
  ]);

  const recordFlowTrace = useCallback(
    (events: readonly RuntimeBridgeEvent[]) => {
      setFlowTrace((current) =>
        current
          ? appendFlowTraceEvents(current, events, data.graph)
          : undefined,
      );
    },
    [data.graph],
  );

  const cancelFlowTrace = useCallback(() => setFlowTrace(undefined), []);

  const finishFlowTrace = useCallback(async () => {
    if (!flowTrace || flowTrace.routes.length === 0) return undefined;
    const created = await data.createFlow(flowTraceToWriteInput(flowTrace));
    if (!created) return undefined;
    setFlowTrace(undefined);
    selectFlow(created.id);
    selectFlowStep(created.entryStepId ?? created.steps[0]?.id ?? "");
    navigate("/atlas/flows");
    return created;
  }, [data, flowTrace, navigate, selectFlow, selectFlowStep]);

  const fitCanvas = useCallback(() => {
    const canvas = document.querySelector<HTMLElement>(
      ".studio-body [role='application']",
    );
    if (!canvas) return;
    canvas.focus();
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "0" }),
    );
  }, []);

  const selectSearchResult = useCallback(
    (result: StudioSearchMatch) => {
      void import("./studio-search").then(({ activateStudioSearchResult }) =>
        activateStudioSearchResult(result, {
          go,
          selectScreen,
          selectComponent,
          selectApiEndpoint,
          selectFlow,
          selectFlowStep,
          selectNote,
          selectFinding,
          selectProbe,
        }),
      );
    },
    [
      go,
      selectComponent,
      selectApiEndpoint,
      selectFinding,
      selectFlow,
      selectFlowStep,
      selectNote,
      selectProbe,
      selectScreen,
    ],
  );

  const runtime: TopoStudioRuntime = {
    data,
    location,
    selection: {
      screenId: selectedScreenId,
      flowId: selectedFlowId,
      flowStepId: selectedFlowStepId,
      componentId: selectedComponentId,
      endpointId: selectedEndpointId,
      previewId: selectedPreviewId,
      noteId: selectedNoteId,
      findingId: selectedFindingId,
      probeId: selectedProbeId,
    },
    actions: {
      navigate,
      go,
      closeOverlay,
      openOverlay,
      createNote: createStudioNote,
      selectScreen,
      selectFlow,
      selectFlowStep,
      selectComponent,
      selectApiEndpoint,
      selectComponentPreview,
      selectNote,
      selectFinding,
      selectProbe,
    },
    canvas: {
      mode: canvasMode,
      setMode: setCanvasMode,
      fit: fitCanvas,
    },
    flowTrace: {
      session: flowTrace,
      start: startFlowTrace,
      record: recordFlowTrace,
      finish: finishFlowTrace,
      cancel: cancelFlowTrace,
    },
    settings,
    setSettings,
  };

  const activeDestination =
    definition.destinations[location.destination] ??
    definition.destinations[definition.defaultDestination]!;
  const ActiveDestination = activeDestination.component;
  const isImmersive =
    activeDestination.immersiveViews?.includes(location.view) ?? false;
  const chromeTitle =
    activeDestination.chromeTitleByView?.[location.view] ??
    activeDestination.label;
  const statusRight =
    activeDestination.status?.(runtime) ?? "All changes saved";
  const destinations = Object.entries(definition.destinations).map(
    ([id, destination]) => ({
      id,
      label: destination.label,
      description:
        destination.navigationDescription?.(runtime) ?? destination.description,
      path: destination.path,
      icon: destination.icon,
    }),
  );
  const commands = Object.entries(definition.commands).map(([id, command]) => {
    const needsConnection =
      id === "rescan" || id === "capture" || id === "doctor";
    const disabled =
      needsConnection && (!data.connected || Boolean(data.busyAction));
    return {
      id,
      label: command.label,
      shortcut: presentCommandShortcut(command.shortcut),
      icon: command.icon,
      closePalette: command.closePalette ?? true,
      disabled,
      disabledReason: disabled
        ? data.mode === "demo"
          ? "Unavailable in demo data"
          : data.busyAction
            ? "Another Studio action is running"
            : "Connect the local daemon to use this action"
        : undefined,
      run: () => command.run(runtime),
    };
  });
  const activeBoard = findStudioBoard(
    `${window.location.pathname}${window.location.search}`,
  );
  const contextAction = flowTrace
    ? {
        kind: "finish" as const,
        label: `${flowTrace.routes.length} step${flowTrace.routes.length === 1 ? "" : "s"} · Finish`,
        active: true,
        onClick: () => void finishFlowTrace(),
      }
    : location.destination === "atlas" && location.view === "flows"
      ? {
          kind: "trace" as const,
          label: "Trace flow",
          onClick: startFlowTrace,
        }
      : {
          kind: "note" as const,
          label: "Note",
          onClick: () => openOverlay("annotate"),
        };

  return (
    <TopoStudioProvider runtime={runtime}>
      <main
        className={`topo-studio destination-${location.destination}`}
        data-studio-board={activeBoard?.id ?? "custom"}
        data-studio-board-name={activeBoard?.name ?? "Custom Studio view"}
        data-studio-destination={location.destination}
        data-studio-overlay={location.overlay ?? "none"}
        data-studio-view={location.view}
        data-topo-component-count={data.graph.components.length}
        data-topo-data-mode={data.mode}
        data-topo-finding-count={data.graph.findings.length}
        data-topo-note-count={data.notes.length}
        data-topo-route-count={data.graph.screens.length}
      >
        {!isImmersive && (
          <StudioTopbar
            busyAction={data.busyAction}
            canvasMode={canvasMode}
            connected={data.connected}
            contextAction={contextAction}
            destinationLabel={chromeTitle}
            onCommand={() => openOverlay("command")}
            onCanvasModeChange={setCanvasMode}
            onDestinationMenu={() => openOverlay("navigation")}
            onFilter={() => navigate("/doctor/findings")}
            onFitCanvas={fitCanvas}
            onPreview={() => navigate("/atlas/live")}
            onRescan={() => void data.rescan()}
            primaryAction={activeDestination.primaryAction}
            tools={activeDestination.tools}
            workspaceName={data.projectSettings.name}
          />
        )}

        <div className={`studio-body ${isImmersive ? "is-immersive" : ""}`}>
          <DestinationErrorBoundary
            key={location.destination}
            label={activeDestination.label}
          >
            <Suspense
              fallback={<DestinationLoading label={activeDestination.label} />}
            >
              <div
                className="studio-destination-content"
                data-studio-ready="true"
              >
                <ActiveDestination />
              </div>
            </Suspense>
          </DestinationErrorBoundary>
        </div>

        {!isImmersive && activeDestination.statusBar !== false && (
          <StatusBar
            components={data.graph.components.length}
            graph={data.graph}
            lastScannedAt={data.lastScannedAt}
            mode={data.mode}
            rightLabel={statusRight}
            routes={data.graph.screens.length}
          />
        )}

        {location.overlay === "navigation" && (
          <Suspense fallback={null}>
            <DestinationMenu
              active={location.destination}
              destinations={destinations}
              onClose={closeOverlay}
              onNavigate={navigate}
            />
          </Suspense>
        )}
        {location.overlay === "command" && (
          <Suspense fallback={null}>
            <CommandPalette
              commands={commands}
              destinations={destinations}
              onClose={closeOverlay}
              onNavigate={navigate}
              onSelectResult={selectSearchResult}
              searchSources={{
                graph: data.graph,
                notes: data.notes,
                flows: data.flows,
                interactionProbes: data.interactionProbes,
                doctorReport: data.doctorReport,
              }}
              destinationIds={Object.keys(definition.destinations)}
            />
          </Suspense>
        )}
        {location.overlay === "welcome" && (
          <Suspense fallback={null}>
            <WelcomeOverlay
              flows={data.flows.length}
              graph={data.graph}
              mode={data.mode}
              onClose={closeOverlay}
              onNavigate={navigate}
            />
          </Suspense>
        )}
        {location.overlay === "annotate" && (
          <Suspense fallback={null}>
            <AnnotatePopover
              context={{
                graph: data.graph,
                flows: data.flows,
                selection: {
                  screenId: selectedScreenId,
                  flowId: selectedFlowId,
                  flowStepId: selectedFlowStepId,
                },
              }}
              onClose={closeOverlay}
              onCreate={createStudioNote}
            />
          </Suspense>
        )}
        {location.overlay === "export" && (
          <Suspense fallback={null}>
            <ExportReviewDialog
              graph={data.graph}
              mode={data.mode}
              notes={data.notes.length}
              onClose={closeOverlay}
              onExport={(options) => void data.exportReview(options)}
            />
          </Suspense>
        )}
        {data.error && (
          <div className="global-error" role="alert">
            {data.error}
          </div>
        )}
        {projectStudio.issues.length > 0 && (
          <div className="global-error" role="alert">
            {projectStudio.issues.join(" ")}
          </div>
        )}
      </main>
    </TopoStudioProvider>
  );
}
