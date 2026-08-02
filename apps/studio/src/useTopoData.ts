import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ApplicationGraph,
  AtlasOrganization,
  Flow,
  InteractionProbeArtifact,
  UpdateFlowInput,
  UpdateNoteInput,
  WriteFlowInput,
  WriteNoteInput,
} from "@topo/schema";
import { emptyApplicationGraph } from "@topo/schema/factories";
import type {
  CacheCleanResult,
  CacheReport,
  AdapterInventoryResponse,
  DoctorReport,
  ComponentPreviewScaffoldResult,
  PreviewGatewaySession,
  ProjectSettingsResponse,
  StudioCustomizationResponse,
} from "@topo/protocol";

import { resolveDaemonUrl } from "./daemon-url";
import {
  createExclusiveActionGate,
  createLatestCommitGate,
} from "./async-coordination";
import {
  fixtureFlows,
  fixtureGraph,
  fixtureDoctorReport,
  fixtureInteractionProbes,
  fixtureNotes,
  fixturePreviewArtifacts,
  fixtureSnapshots,
  fixtureVisualBaselines,
  fixtureVisualComparisons,
  applyNotePatch,
  type ReviewExportOptions,
  type StudioNote,
  type StudioComponentPreviewArtifact,
  type StudioSnapshot,
  type StudioVisualBaseline,
  type StudioVisualComparison,
} from "./studio-model";
import { parseGraphUpdate, parseResourceUpdate } from "./topo-events";
import { applyFlowPatch, createLocalFlow } from "./flow-authoring";

const loadStudioValidation = () => import("./studio-validation");
const loadReviewExporter = () => import("@topo/exporter");

const daemonUrl = resolveDaemonUrl({
  environmentUrl: import.meta.env.VITE_TOPO_DAEMON_URL,
  embeddedUrl:
    typeof document === "undefined"
      ? undefined
      : (document
          .querySelector<HTMLMetaElement>('meta[name="topo-daemon-url"]')
          ?.getAttribute("content") ?? undefined),
  currentOrigin:
    typeof window === "undefined" ? undefined : window.location.origin,
  production: import.meta.env.PROD,
});

export interface TopoDataState {
  graph: ApplicationGraph;
  projectSettings: ProjectSettingsResponse;
  adapterInventory: AdapterInventoryResponse;
  atlasOrganization: AtlasOrganization;
  notes: StudioNote[];
  flows: Flow[];
  snapshots: StudioSnapshot[];
  visualBaselines: StudioVisualBaseline[];
  visualComparisons: StudioVisualComparison[];
  previewArtifacts: StudioComponentPreviewArtifact[];
  interactionProbes: InteractionProbeArtifact[];
  previewSessions: PreviewGatewaySession[];
  doctorReport: DoctorReport;
  cacheReport: CacheReport;
  studioCustomization: StudioCustomizationResponse;
  connected: boolean;
  lastScannedAt?: string;
}

export type TopoDataMode = "daemon" | "demo" | "connecting" | "offline";

function emptyCacheReport(projectRoot: string): CacheReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    cacheRoot: ".topo/cache",
    exists: false,
    totals: { bytes: 0, files: 0, directories: 0, symlinks: 0 },
    entries: [],
  };
}

function disconnectedProjectSettings(): ProjectSettingsResponse {
  return {
    schemaVersion: 1,
    name: "Workspace",
    projectRoot: "Not connected",
    sourceRoot: "Not connected",
    configPath: "topo.config.ts",
    capture: {
      version: 1,
      autoCapture: false,
      headless: true,
      viewport: { width: 1440, height: 1000 },
    },
  };
}

const fixtureProjectSettings: ProjectSettingsResponse = {
  schemaVersion: 1,
  name: "fieldbase-web",
  projectRoot: "demo://fieldbase-web",
  sourceRoot: "demo://fieldbase-web",
  configPath: "topo.config.ts",
  capture: {
    version: 1,
    autoCapture: true,
    headless: true,
    viewport: { width: 1440, height: 1024 },
  },
};

const emptyFlowInventoryMembership = {
  transitionCount: 0,
  inferredFlowCount: 0,
  flowTransitionIds: [],
  inferredFlowIds: [],
};

const fixtureAdapterInventory: AdapterInventoryResponse = {
  schemaVersion: 1,
  adapters: [
    {
      id: "builtin:framework:topo.next",
      adapterId: "topo.next",
      displayName: "Next.js",
      kind: "framework",
      provenance: "built-in",
      status: "active",
      active: true,
      registered: false,
      routeCount: fixtureGraph.screens.length,
      previewCount: 0,
      endpointCount: 0,
      ...emptyFlowInventoryMembership,
      screenIds: fixtureGraph.screens.map((screen) => screen.id),
      componentIds: [],
      endpointIds: [],
    },
    {
      id: "builtin:framework:topo.tanstack",
      adapterId: "topo.tanstack",
      displayName: "TanStack Router",
      kind: "framework",
      provenance: "built-in",
      status: "available",
      active: false,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: 0,
      ...emptyFlowInventoryMembership,
      screenIds: [],
      componentIds: [],
      endpointIds: [],
    },
    ...(
      [
        ["topo.react", "React"],
        ["topo.vue", "Vue"],
        ["topo.nuxt", "Nuxt"],
        ["topo.svelte", "Svelte"],
      ] as const
    ).map(([adapterId, displayName]) => ({
      id: `builtin:framework:${adapterId}`,
      adapterId,
      displayName,
      kind: "framework" as const,
      provenance: "built-in" as const,
      status: "available" as const,
      active: false,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: 0,
      ...emptyFlowInventoryMembership,
      screenIds: [],
      componentIds: [],
      endpointIds: [],
    })),
    {
      id: "builtin:component-preview:storybook",
      adapterId: "storybook",
      displayName: "Storybook",
      kind: "component-preview",
      provenance: "built-in",
      status: "active",
      active: true,
      registered: false,
      routeCount: 0,
      previewCount: 103,
      endpointCount: 0,
      ...emptyFlowInventoryMembership,
      screenIds: [],
      componentIds: fixtureGraph.components
        .filter((component) =>
          component.previewSources.some(
            (preview) => preview.adapterId === "storybook",
          ),
        )
        .map((component) => component.id),
      endpointIds: [],
    },
    {
      id: "builtin:component-preview:topo",
      adapterId: "topo",
      displayName: "Topo previews",
      kind: "component-preview",
      provenance: "built-in",
      status: "active",
      active: true,
      registered: false,
      routeCount: 0,
      previewCount: 1,
      endpointCount: 0,
      ...emptyFlowInventoryMembership,
      screenIds: [],
      componentIds: fixtureGraph.components
        .filter((component) =>
          component.previewSources.some(
            (preview) => preview.adapterId === "topo",
          ),
        )
        .map((component) => component.id),
      endpointIds: [],
    },
    ...(["source-api", "openapi"] as const).map((adapterId) => ({
      id: `builtin:api-endpoint:${adapterId}`,
      adapterId,
      displayName:
        adapterId === "source-api"
          ? "Framework and router source APIs"
          : "OpenAPI contracts",
      kind: "api-endpoint" as const,
      provenance: "built-in" as const,
      status: "active" as const,
      active: true,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: fixtureGraph.apiEndpoints.length,
      screenIds: [],
      componentIds: [],
      endpointIds: fixtureGraph.apiEndpoints.map((endpoint) => endpoint.id),
      ...emptyFlowInventoryMembership,
    })),
    {
      id: "builtin:flow-discovery:source-flow",
      adapterId: "source-flow",
      displayName: "Source flow discovery",
      kind: "flow-discovery",
      provenance: "built-in",
      status: "active",
      active: true,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: 0,
      transitionCount: fixtureGraph.flowTransitions.length,
      inferredFlowCount: fixtureGraph.inferredFlows.length,
      screenIds: [],
      componentIds: [],
      endpointIds: [],
      flowTransitionIds: fixtureGraph.flowTransitions.map(
        (transition) => transition.id,
      ),
      inferredFlowIds: fixtureGraph.inferredFlows.map((flow) => flow.id),
    },
    ...(
      [
        ["next", "Next.js development server"],
        ["tanstack", "TanStack development server"],
        ["nuxt", "Nuxt development server"],
        ["vite", "Vite development server"],
        ["package-script", "Package script"],
      ] as const
    ).map(([adapterId, displayName]) => ({
      id: `builtin:application-runtime:${adapterId}`,
      adapterId,
      displayName,
      kind: "application-runtime" as const,
      provenance: "built-in" as const,
      status: "available" as const,
      active: false,
      registered: false,
      routeCount: 0,
      previewCount: 0,
      endpointCount: 0,
      ...emptyFlowInventoryMembership,
      screenIds: [],
      componentIds: [],
      endpointIds: [],
    })),
  ],
  issues: [],
  summary: { total: 16, active: 6, registered: 0, declared: 0, issues: 0 },
};

function createDisconnectedDoctorReport(): DoctorReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot: "Not connected",
    sourceRoot: "Not connected",
    ok: false,
    summary: { total: 1, passed: 0, warnings: 1, errors: 0 },
    checks: [
      {
        id: "environment.daemon-connection",
        scope: "environment",
        title: "Local daemon is not connected",
        status: "warning",
        severity: "warning",
        detail:
          "Studio has no current environment evidence. Start Topo locally, then re-run Doctor.",
        action: "pnpm topo",
        evidence: { connected: false },
      },
    ],
  };
}

const emptyAdapterInventory: AdapterInventoryResponse = {
  schemaVersion: 1,
  adapters: [],
  issues: [],
  summary: { total: 0, active: 0, registered: 0, declared: 0, issues: 0 },
};

const emptyStudioCustomization: StudioCustomizationResponse = {
  schemaVersion: 1,
  remove: { destinations: [], commands: [] },
  destinations: {},
  commands: {},
};

export function createInitialTopoDataState(demoMode: boolean): TopoDataState {
  if (demoMode) {
    return {
      graph: fixtureGraph,
      projectSettings: fixtureProjectSettings,
      adapterInventory: fixtureAdapterInventory,
      atlasOrganization: { version: 1, routeGroups: {}, componentGroups: {} },
      notes: fixtureNotes,
      flows: fixtureFlows,
      snapshots: fixtureSnapshots,
      visualBaselines: fixtureVisualBaselines,
      visualComparisons: fixtureVisualComparisons,
      previewArtifacts: fixturePreviewArtifacts,
      interactionProbes: fixtureInteractionProbes,
      previewSessions: [],
      doctorReport: fixtureDoctorReport,
      cacheReport: emptyCacheReport("Demo project"),
      studioCustomization: emptyStudioCustomization,
      connected: false,
    };
  }

  return {
    graph: emptyApplicationGraph("Not connected"),
    projectSettings: disconnectedProjectSettings(),
    adapterInventory: emptyAdapterInventory,
    atlasOrganization: { version: 1, routeGroups: {}, componentGroups: {} },
    notes: [],
    flows: [],
    snapshots: [],
    visualBaselines: [],
    visualComparisons: [],
    previewArtifacts: [],
    interactionProbes: [],
    previewSessions: [],
    doctorReport: createDisconnectedDoctorReport(),
    cacheReport: emptyCacheReport("Not connected"),
    studioCustomization: emptyStudioCustomization,
    connected: false,
  };
}

export function resolveTopoDataMode(options: {
  demoMode: boolean;
  connected: boolean;
  connectionAttempted: boolean;
}): TopoDataMode {
  if (options.demoMode) return "demo";
  if (options.connected) return "daemon";
  return options.connectionAttempted ? "offline" : "connecting";
}

export function canPersistStudioChanges(options: {
  demoMode: boolean;
  connected: boolean;
}): boolean {
  return options.demoMode || options.connected;
}

const offlineWriteMessage =
  "The local daemon is offline. Reconnect Topo before changing project notes or flows.";

async function readJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${daemonUrl}${path}`, { signal });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

export function useTopoData() {
  const [demoMode] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "1",
  );
  const [state, setState] = useState<TopoDataState>(() =>
    createInitialTopoDataState(demoMode),
  );
  const [connectionAttempted, setConnectionAttempted] = useState(demoMode);
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [hydrationGate] = useState(createLatestCommitGate);
  const [actionGate] = useState(createExclusiveActionGate);

  const hydrate = useCallback(
    async (signal?: AbortSignal) => {
      const lease = hydrationGate.begin();
      const validation = loadStudioValidation();
      const [
        graphResult,
        projectSettingsResult,
        adapterInventoryResult,
        atlasOrganizationResult,
        notesResult,
        flowsResult,
        snapshotsResult,
        visualsResult,
        previewArtifactsResult,
        interactionProbesResult,
        doctorResult,
        previewSessionsResult,
        cacheResult,
        studioResult,
      ] = await Promise.allSettled([
        readJson("/graph", signal).then(async (value) =>
          (await validation).parseApplicationGraph(value),
        ),
        readJson("/project", signal).then(async (value) =>
          (await validation).parseProjectSettings(value),
        ),
        readJson("/adapters", signal).then(async (value) =>
          (await validation).parseAdapterInventory(value),
        ),
        readJson("/atlas/organization", signal).then(async (value) =>
          (await validation).parseAtlasOrganization(value),
        ),
        readJson("/notes", signal).then(async (value) =>
          (await validation).parseNotesResponse(value),
        ),
        readJson("/flows", signal).then(async (value) =>
          (await validation).parseFlowsResponse(value),
        ),
        readJson("/snapshots", signal).then(async (value) =>
          (await validation).parseSnapshotsResponse(value),
        ),
        readJson("/visuals", signal).then(async (value) =>
          (await validation).parseVisualEvidence(value),
        ),
        readJson("/component-previews", signal).then(async (value) =>
          (await validation).parseComponentPreviewsResponse(value),
        ),
        readJson("/interaction-probes", signal).then(async (value) =>
          (await validation).parseInteractionProbesResponse(value),
        ),
        readJson("/doctor", signal).then(async (value) =>
          (await validation).parseDoctorReport(value),
        ),
        readJson("/preview/sessions", signal).then(
          async (value) =>
            (await validation).parsePreviewSessions(value).sessions,
        ),
        readJson("/cache", signal).then(async (value) =>
          (await validation).parseCacheReport(value),
        ),
        readJson("/studio", signal).then(async (value) =>
          (await validation).parseStudioCustomization(value),
        ),
      ]);
      if (graphResult.status === "rejected") {
        if (!signal?.aborted && lease.isCurrent()) {
          setState((current) => ({ ...current, connected: false }));
          setConnectionAttempted(true);
          setError(
            "Topo could not load a valid daemon graph. Studio stayed offline.",
          );
        }
        return;
      }
      if (signal?.aborted || !lease.isCurrent()) return;
      const resourceResults: Array<[string, PromiseSettledResult<unknown>]> = [
        ["adapters", adapterInventoryResult],
        ["project settings", projectSettingsResult],
        ["atlas organization", atlasOrganizationResult],
        ["notes", notesResult],
        ["flows", flowsResult],
        ["snapshots", snapshotsResult],
        ["visual evidence", visualsResult],
        ["component previews", previewArtifactsResult],
        ["interaction probes", interactionProbesResult],
        ["Doctor", doctorResult],
        ["preview sessions", previewSessionsResult],
        ["cache", cacheResult],
        ["Studio customization", studioResult],
      ];
      const failedResources = resourceResults
        .filter(([, result]) => result.status === "rejected")
        .map(([name]) => name);
      const sourceIssueCount =
        (notesResult.status === "fulfilled"
          ? notesResult.value.issues.length
          : 0) +
        (flowsResult.status === "fulfilled"
          ? flowsResult.value.issues.length
          : 0);
      const warnings = [
        ...(failedResources.length > 0
          ? [`rejected resources: ${failedResources.join(", ")}`]
          : []),
        ...(sourceIssueCount > 0
          ? [
              `${sourceIssueCount} malformed note or flow source record${sourceIssueCount === 1 ? "" : "s"}`,
            ]
          : []),
      ];
      setError(
        warnings.length > 0
          ? `Topo loaded the valid graph with resource warnings (${warnings.join("; ")}). Last valid values remain visible.`
          : undefined,
      );
      setConnectionAttempted(true);
      setState((current) => ({
        graph: graphResult.value,
        projectSettings:
          projectSettingsResult.status === "fulfilled"
            ? projectSettingsResult.value
            : current.projectSettings,
        adapterInventory:
          adapterInventoryResult.status === "fulfilled"
            ? adapterInventoryResult.value
            : current.adapterInventory,
        atlasOrganization:
          atlasOrganizationResult.status === "fulfilled"
            ? atlasOrganizationResult.value
            : current.atlasOrganization,
        notes:
          notesResult.status === "fulfilled"
            ? notesResult.value.notes
            : current.notes,
        flows:
          flowsResult.status === "fulfilled"
            ? flowsResult.value.flows
            : current.flows,
        snapshots:
          snapshotsResult.status === "fulfilled"
            ? snapshotsResult.value.snapshots
            : current.snapshots,
        visualBaselines:
          visualsResult.status === "fulfilled"
            ? visualsResult.value.baselines
            : current.visualBaselines,
        visualComparisons:
          visualsResult.status === "fulfilled"
            ? visualsResult.value.comparisons
            : current.visualComparisons,
        previewArtifacts:
          previewArtifactsResult.status === "fulfilled"
            ? previewArtifactsResult.value.previewArtifacts
            : current.previewArtifacts,
        interactionProbes:
          interactionProbesResult.status === "fulfilled"
            ? interactionProbesResult.value.interactionProbes
            : current.interactionProbes,
        previewSessions:
          previewSessionsResult.status === "fulfilled"
            ? previewSessionsResult.value
            : current.previewSessions,
        doctorReport:
          doctorResult.status === "fulfilled"
            ? doctorResult.value
            : current.doctorReport,
        cacheReport:
          cacheResult.status === "fulfilled"
            ? cacheResult.value
            : current.cacheReport,
        studioCustomization:
          studioResult.status === "fulfilled"
            ? studioResult.value
            : current.studioCustomization,
        connected: true,
        lastScannedAt: graphResult.value.generatedAt,
      }));
    },
    [hydrationGate],
  );

  useEffect(() => {
    if (demoMode) return;

    const controller = new AbortController();
    void hydrate(controller.signal);
    const events = new EventSource(`${daemonUrl}/events`);
    const applyGraph = (event: Event) => {
      void parseGraphUpdate((event as MessageEvent<string>).data).then(
        (graph) => {
          if (!graph) return;
          setState((current) => ({
            ...current,
            graph,
            // A graph event can arrive before the initial resource hydrate.
            // Keep live frames gated until capability resources are hydrated.
            connected: current.connected,
            lastScannedAt: graph.generatedAt,
          }));
        },
      );
    };
    const refreshResource = (event: Event) => {
      void parseResourceUpdate((event as MessageEvent<string>).data).then(
        (resource) => {
          if (resource) void hydrate();
        },
      );
    };
    // Rehydrate on every successful connection, including reconnects. Merely
    // opening SSE is not enough to mount capability-protected live frames.
    events.onopen = () => void hydrate();
    events.addEventListener("graph.snapshot", applyGraph);
    events.addEventListener("graph.updated", applyGraph);
    events.addEventListener("resource.updated", refreshResource);
    events.onerror = () => {
      setConnectionAttempted(true);
      setState((current) => ({ ...current, connected: false }));
    };
    return () => {
      controller.abort();
      hydrationGate.invalidate();
      events.removeEventListener("graph.snapshot", applyGraph);
      events.removeEventListener("graph.updated", applyGraph);
      events.removeEventListener("resource.updated", refreshResource);
      events.close();
    };
  }, [demoMode, hydrate, hydrationGate]);

  const runAction = useCallback(
    async <T>(
      name: string,
      action: () => Promise<T>,
    ): Promise<T | undefined> => {
      const lease = actionGate.tryStart();
      if (!lease) return undefined;
      setBusyAction(name);
      setError(undefined);
      try {
        return await action();
      } catch (actionError) {
        setError(
          actionError instanceof Error ? actionError.message : `${name} failed`,
        );
        return undefined;
      } finally {
        if (lease.release()) setBusyAction(undefined);
      }
    },
    [actionGate],
  );

  const rescan = useCallback(
    () =>
      runAction("rescan", async () => {
        if (demoMode) return;
        const response = await fetch(`${daemonUrl}/scan`, { method: "POST" });
        if (!response.ok)
          throw new Error("The daemon could not rescan this workspace.");
        await hydrate();
      }),
    [demoMode, hydrate, runAction],
  );

  const capture = useCallback(
    (profile?: string) =>
      runAction("capture", async () => {
        if (demoMode) return;
        const response = await fetch(`${daemonUrl}/capture`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(profile ? { profile } : {}),
        });
        if (!response.ok) throw new Error("Screen capture did not complete.");
        await hydrate();
      }),
    [demoMode, hydrate, runAction],
  );

  const captureComponents = useCallback(
    (componentIds?: string[], profile?: string) =>
      runAction("capture-components", async () => {
        if (demoMode) return;
        const response = await fetch(`${daemonUrl}/capture/components`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            componentIds,
            ...(profile ? { profile } : {}),
          }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            detail.error ?? "Component preview capture did not complete.",
          );
        }
        await hydrate();
      }),
    [demoMode, hydrate, runAction],
  );

  const scaffoldComponentPreview = useCallback(
    (componentId: string) =>
      runAction("scaffold-component-preview", async () => {
        if (demoMode) {
          throw new Error(
            "Preview scaffolding is available when Studio is connected to a local Topo project.",
          );
        }
        if (!state.connected) {
          throw new Error(
            "The local daemon is offline. Reconnect Topo before creating a preview draft.",
          );
        }
        const response = await fetch(
          `${daemonUrl}/components/previews/scaffold`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ componentId }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as unknown;
        if (!response.ok) {
          const detail = payload as { error?: string };
          throw new Error(
            detail.error ??
              "Topo could not create the component preview draft.",
          );
        }
        const result = (
          await loadStudioValidation()
        ).parseComponentPreviewScaffoldResponse(payload);
        setState((current) => ({ ...current, graph: result.graph }));
        return result.result satisfies ComponentPreviewScaffoldResult;
      }),
    [demoMode, runAction, state.connected],
  );

  const acceptVisualBaseline = useCallback(
    (screenId: string) =>
      runAction("accept-baseline", async () => {
        if (demoMode) {
          setState((current) => {
            const snapshot = current.snapshots.find(
              (candidate) =>
                candidate.screenId === screenId &&
                candidate.status === "captured",
            );
            if (!snapshot) return current;
            const acceptedAt = new Date().toISOString();
            const contentHash = (snapshot.contentHash ?? screenId)
              .replace(/[^a-f0-9]/gi, "a")
              .toLowerCase()
              .padEnd(64, "a")
              .slice(0, 64);
            const baseline: StudioVisualBaseline = {
              version: 1,
              id: `demo-visual-baseline-${screenId}`,
              screenId,
              routePath: snapshot.routePath,
              sourceSnapshotId: snapshot.id,
              acceptedAt,
              artifactPath:
                snapshot.artifactPath ?? `.topo/snapshots/${snapshot.id}.png`,
              contentHash,
              width: snapshot.width ?? 1440,
              height: snapshot.height ?? 1024,
              imageUrl: snapshot.imageUrl,
            };
            const comparison: StudioVisualComparison = {
              version: 1,
              id: `demo-visual-comparison-${screenId}`,
              screenId,
              routePath: snapshot.routePath,
              baselineId: baseline.id,
              baselineHash: contentHash,
              currentSnapshotId: snapshot.id,
              currentHash: contentHash,
              comparedAt: acceptedAt,
              status: "unchanged",
              threshold: 0.1,
              changedPixels: 0,
              totalPixels: baseline.width * baseline.height,
              changeRatio: 0,
              baselineSize: { width: baseline.width, height: baseline.height },
              currentSize: { width: baseline.width, height: baseline.height },
            };
            return {
              ...current,
              visualBaselines: [
                baseline,
                ...current.visualBaselines.filter(
                  (item) => item.screenId !== screenId,
                ),
              ],
              visualComparisons: [
                comparison,
                ...current.visualComparisons.filter(
                  (item) => item.screenId !== screenId,
                ),
              ],
            };
          });
          return;
        }
        const response = await fetch(`${daemonUrl}/visuals/baseline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ screenId }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(detail.error ?? "Visual baseline was not accepted.");
        }
        await hydrate();
      }),
    [demoMode, hydrate, runAction],
  );

  const runChecks = useCallback(
    (
      options: { runtime?: boolean; routes?: string[]; profile?: string } = {},
    ) =>
      runAction(options.runtime ? "probe" : "doctor", async () => {
        if (demoMode) return;
        const response = await fetch(
          `${daemonUrl}${options.runtime ? "/diagnostics" : "/doctor"}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            ...(options.runtime
              ? {
                  body: JSON.stringify({
                    runtime: true,
                    ...(options.routes ? { routes: options.routes } : {}),
                    ...(options.profile ? { profile: options.profile } : {}),
                  }),
                }
              : {}),
          },
        );
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            detail.error ??
              (options.runtime
                ? "Interaction probe did not complete."
                : "Doctor checks did not complete."),
          );
        }
        await hydrate();
      }),
    [demoMode, hydrate, runAction],
  );

  const cleanCache = useCallback(
    (options: { dryRun?: boolean } = {}) =>
      runAction(
        "cache-clean",
        async (): Promise<CacheCleanResult | undefined> => {
          if (demoMode || !state.connected) return undefined;
          const response = await fetch(`${daemonUrl}/cache/clean`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(options),
          });
          if (!response.ok) {
            const detail = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(
              detail.error ?? "The derived cache could not be cleaned.",
            );
          }
          const result = (await loadStudioValidation()).parseCacheCleanResult(
            await response.json(),
          );
          setState((current) => ({
            ...current,
            cacheReport: result.after,
          }));
          return result;
        },
      ),
    [demoMode, runAction, state.connected],
  );

  const createNote = useCallback(
    async (input: WriteNoteInput) => {
      const created = await runAction("note", async () => {
        if (demoMode) {
          const timestamp = new Date().toISOString();
          return {
            ...input,
            version: 1,
            id: input.id ?? `local-${crypto.randomUUID()}`,
            type: input.type ?? "screen",
            body: input.body ?? "",
            status: input.status ?? "open",
            createdAt: timestamp,
            updatedAt: timestamp,
            author: input.author ?? "local",
          } satisfies StudioNote;
        }
        if (!state.connected) throw new Error(offlineWriteMessage);
        const response = await fetch(`${daemonUrl}/notes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(detail.error ?? "The note could not be saved.");
        }
        return (await loadStudioValidation()).parseNoteRecord(
          await response.json(),
        );
      });
      if (created) {
        setState((current) => ({
          ...current,
          notes: [
            created,
            ...current.notes.filter((note) => note.id !== created.id),
          ],
        }));
      }
      return created;
    },
    [demoMode, runAction, state.connected],
  );

  const updateNote = useCallback(
    async (id: string, input: UpdateNoteInput) => {
      if (actionGate.isActive()) return undefined;
      if (!canPersistStudioChanges({ demoMode, connected: state.connected })) {
        setError(offlineWriteMessage);
        return undefined;
      }
      const previous = state.notes.find((note) => note.id === id);
      if (!previous) {
        setError(`Note ${id} no longer exists.`);
        return undefined;
      }
      const optimistic = applyNotePatch(
        previous,
        input,
        new Date().toISOString(),
      );
      setState((current) => ({
        ...current,
        notes: current.notes.map((note) =>
          note.id === id ? optimistic : note,
        ),
      }));

      const updated = await runAction("note-update", async () => {
        if (demoMode) return optimistic;
        const response = await fetch(
          `${daemonUrl}/notes/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(detail.error ?? "The note could not be updated.");
        }
        return (await loadStudioValidation()).parseNoteRecord(
          await response.json(),
        );
      });

      if (!updated) {
        setState((current) => ({
          ...current,
          notes: current.notes.map((note) =>
            note.id === id ? previous : note,
          ),
        }));
        return undefined;
      }
      setState((current) => ({
        ...current,
        notes: current.notes.map((note) => (note.id === id ? updated : note)),
      }));
      return updated;
    },
    [actionGate, demoMode, runAction, state.connected, state.notes],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      if (actionGate.isActive()) return undefined;
      if (!canPersistStudioChanges({ demoMode, connected: state.connected })) {
        setError(offlineWriteMessage);
        return undefined;
      }
      const index = state.notes.findIndex((note) => note.id === id);
      if (index === -1) {
        setError(`Note ${id} no longer exists.`);
        return undefined;
      }
      const previous = state.notes[index]!;
      setState((current) => ({
        ...current,
        notes: current.notes.filter((note) => note.id !== id),
      }));

      const removed = await runAction("note-delete", async () => {
        if (demoMode) return true;
        const response = await fetch(
          `${daemonUrl}/notes/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(detail.error ?? "The note could not be deleted.");
        }
        return true;
      });

      if (!removed) {
        setState((current) => {
          const notes = [...current.notes];
          notes.splice(Math.min(index, notes.length), 0, previous);
          return { ...current, notes };
        });
        return undefined;
      }
      return true;
    },
    [actionGate, demoMode, runAction, state.connected, state.notes],
  );

  const createFlow = useCallback(
    async (input: WriteFlowInput) => {
      const created = await runAction("flow-create", async () => {
        if (demoMode) {
          return (await loadStudioValidation()).parseFlowRecord(
            createLocalFlow(input, new Date().toISOString()),
          );
        }
        if (!state.connected) throw new Error(offlineWriteMessage);
        const response = await fetch(`${daemonUrl}/flows`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(detail.error ?? "The flow could not be created.");
        }
        return (await loadStudioValidation()).parseFlowRecord(
          await response.json(),
        );
      });
      if (created) {
        setState((current) => ({
          ...current,
          flows: [
            ...current.flows.filter((flow) => flow.id !== created.id),
            created,
          ].sort((left, right) => left.title.localeCompare(right.title)),
        }));
      }
      return created;
    },
    [demoMode, runAction, state.connected],
  );

  const updateFlow = useCallback(
    async (id: string, input: UpdateFlowInput) => {
      if (actionGate.isActive()) return undefined;
      if (!canPersistStudioChanges({ demoMode, connected: state.connected })) {
        setError(offlineWriteMessage);
        return undefined;
      }
      const previous = state.flows.find((flow) => flow.id === id);
      if (!previous) {
        setError(`Flow ${id} no longer exists.`);
        return undefined;
      }
      let optimistic: Flow;
      try {
        optimistic = (await loadStudioValidation()).parseFlowRecord(
          applyFlowPatch(previous, input, new Date().toISOString()),
        );
      } catch (flowError) {
        setError(
          flowError instanceof Error
            ? flowError.message
            : "The flow update is invalid.",
        );
        return undefined;
      }
      setState((current) => ({
        ...current,
        flows: current.flows.map((flow) =>
          flow.id === id ? optimistic : flow,
        ),
      }));

      const updated = await runAction("flow-update", async () => {
        if (demoMode) return optimistic;
        const response = await fetch(
          `${daemonUrl}/flows/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(detail.error ?? "The flow could not be updated.");
        }
        return (await loadStudioValidation()).parseFlowRecord(
          await response.json(),
        );
      });

      if (!updated) {
        setState((current) => ({
          ...current,
          flows: current.flows.map((flow) =>
            flow.id === id ? previous : flow,
          ),
        }));
        return undefined;
      }
      setState((current) => ({
        ...current,
        flows: current.flows.map((flow) => (flow.id === id ? updated : flow)),
      }));
      return updated;
    },
    [actionGate, demoMode, runAction, state.connected, state.flows],
  );

  const deleteFlow = useCallback(
    async (id: string) => {
      if (actionGate.isActive()) return undefined;
      if (!canPersistStudioChanges({ demoMode, connected: state.connected })) {
        setError(offlineWriteMessage);
        return undefined;
      }
      const index = state.flows.findIndex((flow) => flow.id === id);
      if (index === -1) {
        setError(`Flow ${id} no longer exists.`);
        return undefined;
      }
      const previous = state.flows[index]!;
      setState((current) => ({
        ...current,
        flows: current.flows.filter((flow) => flow.id !== id),
      }));

      const removed = await runAction("flow-delete", async () => {
        if (demoMode) return true;
        const response = await fetch(
          `${daemonUrl}/flows/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(detail.error ?? "The flow could not be deleted.");
        }
        return true;
      });

      if (!removed) {
        setState((current) => {
          const flows = [...current.flows];
          flows.splice(Math.min(index, flows.length), 0, previous);
          return { ...current, flows };
        });
        return undefined;
      }
      return true;
    },
    [actionGate, demoMode, runAction, state.connected, state.flows],
  );

  const exportReview = useCallback(
    (
      options: ReviewExportOptions = {
        format: "markdown",
        include: "all",
        attachSnapshots: false,
      },
    ) =>
      runAction("export", async () => {
        const { exportReview: createReviewExport } = await loadReviewExporter();
        let result = createReviewExport(
          {
            graph: state.graph,
            notes: state.notes,
            snapshots: state.snapshots,
          },
          options,
        );
        if (state.connected) {
          try {
            const reviewUrl = new URL(`${daemonUrl}/review`);
            reviewUrl.searchParams.set("format", options.format);
            reviewUrl.searchParams.set("include", options.include);
            if (options.attachSnapshots) {
              reviewUrl.searchParams.set("snapshots", "1");
            }
            const response = await fetch(reviewUrl);
            if (response.ok) {
              result = { ...result, body: await response.text() };
            }
          } catch {
            // Keep the explicit offline export instead of dropping the action.
          }
        }
        const url = URL.createObjectURL(
          new Blob([result.body], { type: result.mimeType }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName;
        anchor.click();
        URL.revokeObjectURL(url);
      }),
    [runAction, state],
  );

  const doctorReport = useMemo(
    () =>
      demoMode || state.connected
        ? state.doctorReport
        : createDisconnectedDoctorReport(),
    [demoMode, state.connected, state.doctorReport],
  );

  const mode = resolveTopoDataMode({
    demoMode,
    connected: state.connected,
    connectionAttempted,
  });

  const getPreviewSession = useCallback(
    (profileName?: string) =>
      state.previewSessions.find(
        (session) => session.profileName === profileName,
      ) ?? state.previewSessions[0],
    [state.previewSessions],
  );

  return {
    ...state,
    mode,
    busyAction,
    error,
    doctorReport,
    getPreviewSession,
    rescan,
    capture,
    captureComponents,
    scaffoldComponentPreview,
    acceptVisualBaseline,
    runChecks,
    cleanCache,
    createNote,
    updateNote,
    deleteNote,
    createFlow,
    updateFlow,
    deleteFlow,
    exportReview,
  };
}
