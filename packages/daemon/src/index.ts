import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";

import { buildAdapterInventory } from "@topo/adapter-inventory";
import { inspectAdapterScaffolds } from "@topo/adapter-scaffold";
import { TOPO_COMPONENT_PREVIEW_ADAPTER_ID } from "@topo/adapter-topo";
import { createStaticAnalysisSession } from "@topo/analyzer-static";
import { cleanProjectCache, inspectProjectCache } from "@topo/cache";
import { runDiagnostics as executeDiagnostics } from "@topo/diagnostics";
import { loadConfig, type TopoConfig, type TopoProject } from "@topo/config";
import { runDoctor as executeDoctor } from "@topo/doctor";
import {
  exportReview,
  REVIEW_EXPORT_FORMATS,
  REVIEW_EXPORT_INCLUDES,
  type ReviewExportFormat,
  type ReviewExportInclude,
} from "@topo/exporter";
import { createFlowStore } from "@topo/flows";
import {
  applicationGraphContentEqual,
  planSourceChangeImpact,
  reconcileGraph,
} from "@topo/graph";
import { createJobQueue } from "@topo/jobs";
import {
  LLM_CONTEXT_JSON_SCHEMA,
  LLM_CONTEXT_KINDS,
  exportLlmContext,
  loadLlmContext,
  queryLlmContext,
  readComponentPreviewArtifact,
  readSnapshotArtifact,
  readVisualBaselineArtifact,
  readVisualComparisonArtifact,
  type LlmContextKind,
} from "@topo/llm-context";
import {
  createAtlasScene,
  createComponentScene,
  createFlowScene,
} from "@topo/layout";
import {
  createNoteStore,
  NoteIdSchema,
  UpdateNoteInputSchema,
  WriteNoteInputSchema,
} from "@topo/notes";
import {
  AcceptVisualBaselineRequestSchema,
  CacheCleanRequestSchema,
  ComponentPreviewScaffoldRequestSchema,
  graphEvent,
  PreviewGatewaySessionsResponseSchema,
  ProjectSettingsResponseSchema,
  resourceEvent,
  StudioCustomizationResponseSchema,
  type ResourceKind,
  type TopoEvent,
  type PreviewGatewaySession,
} from "@topo/protocol";
import {
  ComponentPreviewScaffoldError,
  createComponentPreviewScaffold,
} from "@topo/preview-scaffold";
import {
  startTopoPreviewRuntime,
  type TopoPreviewRuntime,
} from "@topo/preview-runtime";
import {
  FlowIdSchema,
  UpdateFlowInputSchema,
  WriteFlowInputSchema,
  type ApplicationGraph,
} from "@topo/schema";
import {
  acceptVisualBaseline,
  captureComponentPreviews,
  captureGraph,
} from "@topo/snapshots";
import { createProjectStateStore } from "@topo/storage";
import {
  builtInComponentPreviewAdapters,
  createWorkspaceScanner,
  loadComponentPreviewAdapterModules,
} from "@topo/workspace";

const PACKAGE_VERSION = "0.1.0";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export interface DaemonOptions {
  /** Owns topo.config.ts and every durable `.topo` artifact. */
  projectRoot: string;
  /** Owns framework source and defaults from config.rootDir. */
  sourceRoot?: string;
  /** Parsed project configuration when the caller already resolved the project. */
  config?: TopoConfig;
  host?: string;
  port?: number;
  watch?: boolean;
  /** Runtime-only signed profile sessions. They never enter durable LLM context. */
  previewSessions?: readonly PreviewGatewaySession[];
  /** Clean gateway origin presented to Studio; captures retain config.preview.baseUrl. */
  livePreviewBaseUrl?: string;
  runDiagnostics?: typeof executeDiagnostics;
  /** Injectable complete Doctor adapter for embeddings and deterministic tests. */
  runDoctor?: typeof executeDoctor;
  /** Retained completed/failed job count; active jobs are always preserved. */
  terminalJobLimit?: number;
  /** Injectable route evidence adapter for embeddings and deterministic tests. */
  captureRoutes?: typeof captureGraph;
  /** Injectable component evidence adapter for embeddings and deterministic tests. */
  capturePreviews?: typeof captureComponentPreviews;
  /** Injectable source mutation at the component-preview scaffold seam. */
  scaffoldPreview?: typeof createComponentPreviewScaffold;
  /** Injectable visual-baseline operation at the snapshot seam. */
  acceptBaseline?: typeof acceptVisualBaseline;
  /** Optional local profiling sink; measurements never enter project data. */
  onPerformanceMeasure?: (measure: DaemonPerformanceMeasure) => void;
}

export interface DaemonPerformanceMeasure {
  operation: "startup" | "source-refresh" | "manual-rescan";
  phase: string;
  durationMs: number;
}

export interface TopoDaemon {
  readonly host: string;
  readonly port: number;
  getGraph(): Promise<ApplicationGraph>;
  /** Reconcile source paths already reported by the watcher or an embedding. */
  refreshChanged(changedPaths: readonly string[]): Promise<ApplicationGraph>;
  /** Conservatively rediscover the complete workspace source tree. */
  refresh(): Promise<ApplicationGraph>;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export interface ComponentPreviewRuntimeManagerOptions {
  rootDir: string;
  configuredBaseUrls: Readonly<Record<string, string>>;
  startRuntime?: (options: { rootDir: string }) => Promise<TopoPreviewRuntime>;
}

export interface ComponentPreviewRuntimeManager {
  resolveBaseUrls(
    graph: ApplicationGraph,
    componentIds?: readonly string[],
  ): Promise<Readonly<Record<string, string>>>;
  close(): Promise<void>;
}

export function createComponentPreviewRuntimeManager(
  options: ComponentPreviewRuntimeManagerOptions,
): ComponentPreviewRuntimeManager {
  const configuredBaseUrls = { ...options.configuredBaseUrls };
  const startRuntime = options.startRuntime ?? startTopoPreviewRuntime;
  let runtimePromise: Promise<TopoPreviewRuntime> | undefined;
  let closed = false;

  const needsBuiltInRuntime = (
    graph: ApplicationGraph,
    componentIds?: readonly string[],
  ): boolean => {
    const selectedIds = componentIds ? new Set(componentIds) : undefined;
    return graph.components.some(
      (component) =>
        (!selectedIds || selectedIds.has(component.id)) &&
        component.previewSources.some(
          (preview) => preview.adapterId === TOPO_COMPONENT_PREVIEW_ADAPTER_ID,
        ),
    );
  };

  const getRuntime = (): Promise<TopoPreviewRuntime> => {
    if (closed) {
      return Promise.reject(
        new Error("Topo component preview runtime manager is closed."),
      );
    }
    if (!runtimePromise) {
      runtimePromise = startRuntime({ rootDir: options.rootDir }).catch(
        (error: unknown) => {
          runtimePromise = undefined;
          throw error;
        },
      );
    }
    return runtimePromise;
  };

  return {
    async resolveBaseUrls(graph, componentIds) {
      if (!needsBuiltInRuntime(graph, componentIds)) {
        return { ...configuredBaseUrls };
      }
      const runtime = await getRuntime();
      return {
        ...configuredBaseUrls,
        [TOPO_COMPONENT_PREVIEW_ADAPTER_ID]: runtime.baseUrl,
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      const pendingRuntime = runtimePromise;
      runtimePromise = undefined;
      if (pendingRuntime) await (await pendingRuntime).close();
    },
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, { error: "Not found" });
}

function artifactImageUrl(
  requestOrigin: string,
  pathname: string,
  contentHash?: string,
): string {
  const url = new URL(pathname, requestOrigin);
  if (contentHash) url.searchParams.set("v", contentHash);
  return url.toString();
}

function sendEvent(response: ServerResponse, event: TopoEvent): void {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function isOriginRequest(request: IncomingMessage): boolean {
  return (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "POST" ||
    request.method === "PATCH" ||
    request.method === "DELETE"
  );
}

function isTrustedSourceMutationRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function classifyWatchedResource(
  relativePath: string,
): "adapters" | "notes" | "flows" | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  if (/^topo\/adapters\/[^/]+\/adapter\.json$/.test(normalized)) {
    return "adapters";
  }
  if (/^\.topo\/notes\/[^/]+\.md$/.test(normalized)) return "notes";
  if (/^\.topo\/flows\/[^/]+\.json$/.test(normalized)) return "flows";
  return undefined;
}

function readRequestBody(
  request: IncomingMessage,
  maxBytes = 1_000_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function readProjectName(
  sourceRoot: string,
  projectRoot: string,
): Promise<string> {
  for (const root of [...new Set([sourceRoot, projectRoot])]) {
    try {
      const packageJson = JSON.parse(
        await readFile(path.join(root, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (
        typeof packageJson.name === "string" &&
        packageJson.name.trim().length > 0
      ) {
        return packageJson.name.trim();
      }
    } catch {
      // A package manifest is optional; use the source directory as identity.
    }
  }
  return path.basename(sourceRoot) || "workspace";
}

export async function createDaemon(
  options: DaemonOptions,
): Promise<TopoDaemon> {
  const projectRoot = path.resolve(options.projectRoot);
  const config = options.config ?? (await loadConfig(projectRoot));
  const sourceRoot = path.resolve(
    options.sourceRoot ?? path.join(projectRoot, config.rootDir),
  );
  const host = options.host ?? config.daemon.host;
  const port = options.port ?? config.daemon.port;
  const projectName = await readProjectName(sourceRoot, projectRoot);
  const projectSettings = ProjectSettingsResponseSchema.parse({
    schemaVersion: 1,
    name: projectName,
    projectRoot,
    sourceRoot,
    configPath: path.join(projectRoot, "topo.config.ts"),
    capture: {
      version: 1,
      autoCapture: config.preview.autoCapture,
      headless: config.preview.headless,
      viewport: config.preview.viewport,
    },
  });
  const stateStore = createProjectStateStore(projectRoot, {
    terminalJobLimit: options.terminalJobLimit,
  });
  await stateStore.compact();
  const jobs = createJobQueue(stateStore);
  const runDiagnostics = options.runDiagnostics ?? executeDiagnostics;
  const observePerformance = async <T>(
    operation: DaemonPerformanceMeasure["operation"],
    phase: string,
    task: () => Promise<T> | T,
  ): Promise<T> => {
    if (!options.onPerformanceMeasure) return task();
    const startedAt = performance.now();
    try {
      return await task();
    } finally {
      options.onPerformanceMeasure({
        operation,
        phase,
        durationMs: performance.now() - startedAt,
      });
    }
  };
  const runDoctor = options.runDoctor ?? executeDoctor;
  const captureRoutes = options.captureRoutes ?? captureGraph;
  const capturePreviews = options.capturePreviews ?? captureComponentPreviews;
  const scaffoldPreview =
    options.scaffoldPreview ?? createComponentPreviewScaffold;
  const acceptBaseline = options.acceptBaseline ?? acceptVisualBaseline;
  const previewSessions = PreviewGatewaySessionsResponseSchema.parse({
    schemaVersion: 1,
    sessions: options.previewSessions ?? [],
  });
  const configuredProfileNames = new Set(
    config.profiles.map((profile) => profile.name),
  );
  const unknownPreviewProfile = previewSessions.sessions.find(
    (session) => !configuredProfileNames.has(session.profileName),
  );
  if (unknownPreviewProfile) {
    throw new Error(
      `Preview session references unknown profile: ${unknownPreviewProfile.profileName}`,
    );
  }
  const livePreviewBaseUrl =
    options.livePreviewBaseUrl ??
    previewSessions.sessions[0]?.baseUrl ??
    config.preview.baseUrl;
  const externalComponentPreviewAdapters =
    await loadComponentPreviewAdapterModules(
      projectRoot,
      config.extensions.componentPreviewAdapters,
    );
  const componentPreviewAdapters = [
    ...builtInComponentPreviewAdapters,
    ...externalComponentPreviewAdapters,
  ];
  const componentPreviewRuntimeManager = createComponentPreviewRuntimeManager({
    rootDir: sourceRoot,
    configuredBaseUrls: config.preview.componentBaseUrls,
  });
  const workspaceScanner = await createWorkspaceScanner(sourceRoot, {
    ignore: config.ignore,
    adapterRootDir: projectRoot,
    adapterModules: config.extensions.frameworkAdapters,
    apiEndpointAdapterModules: config.extensions.apiEndpointAdapters,
    flowAdapterModules: config.extensions.flowAdapters,
    previewAdapters: externalComponentPreviewAdapters,
    componentPreviews: config.preview.components,
    previewRoutes: config.preview.routes,
  });
  const staticAnalyzer =
    runDiagnostics === executeDiagnostics
      ? createStaticAnalysisSession(sourceRoot, { ignore: config.ignore })
      : undefined;
  const scan = async (
    changedPaths: readonly string[] | undefined,
    operation: DaemonPerformanceMeasure["operation"],
  ) => {
    const refreshPaths = changedPaths?.length ? changedPaths : undefined;
    const [scanned, staticAnalysis] = await observePerformance(
      operation,
      "source-analysis",
      () =>
        Promise.all([
          workspaceScanner.scan(refreshPaths),
          staticAnalyzer?.scan(refreshPaths),
        ]),
    );
    scanned.previewBaseUrl = livePreviewBaseUrl;
    return observePerformance(
      operation,
      "diagnostic-reconciliation",
      async () =>
        (
          await runDiagnostics({
            rootDir: sourceRoot,
            graph: scanned,
            ...(staticAnalysis ? { staticAnalysis } : {}),
          })
        ).graph,
    );
  };
  const previousState = await stateStore.read();
  let graph = reconcileGraph(
    previousState.graph,
    await scan(undefined, "startup"),
  );
  await stateStore.saveGraph(graph);
  const project: TopoProject = {
    projectRoot,
    sourceRoot,
    configPath: path.join(projectRoot, "topo.config.ts"),
    config,
  };
  let doctorReport = await runDoctor({ project, graph });
  const notes = createNoteStore(projectRoot);
  const flows = createFlowStore(projectRoot);
  const buildAdapterInventoryResponse = async () =>
    buildAdapterInventory({
      graph,
      inspection: await inspectAdapterScaffolds(projectRoot),
      extensions: config.extensions,
    });
  const buildContext = (contextGraph: ApplicationGraph = graph) =>
    loadLlmContext(
      projectRoot,
      contextGraph,
      {
        projectRoot,
        sourceRoot,
        profileNames: config.profiles.map((profile) => profile.name),
        previewRoutes: config.preview.routes,
        capture: projectSettings.capture,
        atlas: config.atlas,
        studio: config.studio,
        extensions: config.extensions,
      },
      { doctorReport },
    );
  let contextWriteQueue = Promise.resolve();
  let contextWriteError: unknown;
  const enqueueContextWrite = (task: () => Promise<void>): Promise<void> => {
    const next = contextWriteQueue.then(task);
    contextWriteQueue = next.then(
      () => {
        contextWriteError = undefined;
      },
      (error: unknown) => {
        contextWriteError = error;
      },
    );
    return next;
  };

  interface PendingGraphSync {
    graph: ApplicationGraph;
    operation: DaemonPerformanceMeasure["operation"];
    waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
  }
  let pendingGraphSync: PendingGraphSync | undefined;
  let graphSyncTimer: NodeJS.Timeout | undefined;

  const writeGraphContext = (
    contextGraph: ApplicationGraph,
    operation: DaemonPerformanceMeasure["operation"],
  ) =>
    enqueueContextWrite(async () => {
      await observePerformance(operation, "graph-persistence", () =>
        stateStore.saveGraph(contextGraph),
      );
      const context = await observePerformance(operation, "context-build", () =>
        buildContext(contextGraph),
      );
      await observePerformance(operation, "context-export", () =>
        exportLlmContext(projectRoot, context),
      );
    });

  const flushPendingGraphSync = async (): Promise<void> => {
    if (graphSyncTimer) {
      clearTimeout(graphSyncTimer);
      graphSyncTimer = undefined;
    }
    const pending = pendingGraphSync;
    pendingGraphSync = undefined;
    if (!pending) {
      await contextWriteQueue;
      if (contextWriteError) throw contextWriteError;
      return;
    }
    try {
      await writeGraphContext(pending.graph, pending.operation);
      for (const waiter of pending.waiters) waiter.resolve();
    } catch (error) {
      for (const waiter of pending.waiters) waiter.reject(error);
      throw error;
    }
  };

  const armGraphSyncTimer = (): void => {
    if (graphSyncTimer) clearTimeout(graphSyncTimer);
    graphSyncTimer = setTimeout(() => {
      graphSyncTimer = undefined;
      void flushPendingGraphSync().catch(() => undefined);
    }, 500);
  };

  const scheduleGraphSync = (
    contextGraph: ApplicationGraph,
    operation: DaemonPerformanceMeasure["operation"],
  ): Promise<void> => {
    const completion = new Promise<void>((resolve, reject) => {
      if (pendingGraphSync) {
        pendingGraphSync.graph = contextGraph;
        pendingGraphSync.operation = operation;
        pendingGraphSync.waiters.push({ resolve, reject });
      } else {
        pendingGraphSync = {
          graph: contextGraph,
          operation,
          waiters: [{ resolve, reject }],
        };
      }
    });
    armGraphSyncTimer();
    return completion;
  };

  const syncContext = (
    operation?: DaemonPerformanceMeasure["operation"],
  ): Promise<void> => {
    const run = async () => {
      await flushPendingGraphSync();
      return enqueueContextWrite(async () => {
        if (!operation) {
          await exportLlmContext(projectRoot, await buildContext());
          return;
        }
        const context = await observePerformance(
          operation,
          "context-build",
          buildContext,
        );
        await observePerformance(operation, "context-export", () =>
          exportLlmContext(projectRoot, context),
        );
      });
    };
    return run();
  };
  await syncContext();
  let actualPort = port;
  let sourceWatcher: FSWatcher | undefined;
  let projectWatcher: FSWatcher | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let resourceRefreshTimer: NodeJS.Timeout | undefined;
  const pendingResourceRefreshes = new Set<"adapters" | "notes" | "flows">();
  const pendingSourceChanges = new Set<string>();
  let closed = false;
  const subscribers = new Set<ServerResponse>();

  const publishGraph = (): void => {
    const event = graphEvent("graph.updated", graph);
    for (const subscriber of subscribers) {
      try {
        sendEvent(subscriber, event);
      } catch {
        subscribers.delete(subscriber);
      }
    }
  };

  const publishResource = (resource: ResourceKind): void => {
    const event = resourceEvent(resource);
    for (const subscriber of subscribers) {
      try {
        sendEvent(subscriber, event);
      } catch {
        subscribers.delete(subscriber);
      }
    }
  };

  const refreshDoctorReport = async () => {
    doctorReport = await runDoctor({ project, graph });
    await syncContext();
    publishResource("doctor");
    return doctorReport;
  };

  const refreshResource = async (
    resource: "adapters" | "notes" | "flows",
  ): Promise<void> => {
    await syncContext();
    publishResource(resource);
  };

  const scheduleResourceRefresh = (
    resource: "adapters" | "notes" | "flows",
  ): void => {
    pendingResourceRefreshes.add(resource);
    if (resourceRefreshTimer) clearTimeout(resourceRefreshTimer);
    resourceRefreshTimer = setTimeout(() => {
      resourceRefreshTimer = undefined;
      const resources = [...pendingResourceRefreshes];
      pendingResourceRefreshes.clear();
      void syncContext()
        .then(() => {
          for (const item of resources) publishResource(item);
        })
        .catch(() => undefined);
    }, 80);
  };

  const captureChangedEvidence = async (
    screenIds: readonly string[],
    componentIds: readonly string[],
  ): Promise<void> => {
    const resources: ResourceKind[] = [];
    let graphChanged = false;

    if (screenIds.length > 0) {
      const job = jobs.submit("capture", () =>
        captureRoutes({
          rootDir: projectRoot,
          graph,
          screenIds,
          baseUrl: config.preview.baseUrl,
          headless: config.preview.headless,
          executablePath: config.preview.executablePath,
          viewport: config.preview.viewport,
          profile: config.profiles[0],
        }),
      );
      const result = await job.completion;
      graph = result.graph;
      await stateStore.saveGraph(graph);
      graphChanged = true;
      resources.push("snapshots");
      if (result.comparisons.length > 0) resources.push("visuals");
    }

    const capturableComponentIds = componentIds.filter((componentId) =>
      graph.components.some(
        (component) =>
          component.id === componentId && component.previewSources.length > 0,
      ),
    );
    if (capturableComponentIds.length > 0) {
      const componentBaseUrls =
        await componentPreviewRuntimeManager.resolveBaseUrls(
          graph,
          capturableComponentIds,
        );
      const job = jobs.submit("capture", () =>
        capturePreviews({
          rootDir: projectRoot,
          graph,
          adapters: componentPreviewAdapters,
          baseUrls: componentBaseUrls,
          componentIds: capturableComponentIds,
          headless: config.preview.headless,
          executablePath: config.preview.executablePath,
          viewport: config.preview.viewport,
          profile: config.profiles[0],
        }),
      );
      await job.completion;
      resources.push("component-previews");
    }

    if (resources.length === 0) return;
    await syncContext();
    if (graphChanged) publishGraph();
    for (const resource of resources) publishResource(resource);
  };

  const refreshChangedSources = async (
    changedPaths: readonly string[],
  ): Promise<typeof graph> => {
    if (closed) return graph;
    if (pendingGraphSync) armGraphSyncTimer();
    const operation =
      changedPaths.length > 0 ? "source-refresh" : "manual-rescan";
    const previous = graph;
    const job = jobs.submit(
      "scan",
      () => scan(changedPaths.length > 0 ? changedPaths : undefined, operation),
      { retainTerminal: false },
    );
    const scanned = await observePerformance(
      operation,
      "scan-job",
      () => job.completion,
    );
    const impact = await observePerformance(operation, "impact-plan", () =>
      changedPaths.length > 0
        ? planSourceChangeImpact(previous, scanned, changedPaths)
        : undefined,
    );
    const reconciled = await observePerformance(
      operation,
      "graph-reconciliation",
      // Scanner output is assembled from already contract-checked adapters and
      // typed internal analyzers. Avoid cloning the complete graph through Zod
      // again on every watcher event; external/default graph callers retain
      // validation through reconcileGraph's default behavior.
      () =>
        reconcileGraph(previous, scanned, impact?.screenIds, {
          validate: false,
        }),
    );
    const graphChanged = await observePerformance(
      operation,
      "graph-comparison",
      () => !applicationGraphContentEqual(previous, reconciled),
    );
    if (graphChanged) {
      graph = reconciled;
    }
    // Doctor owns bounded runtime probes and is intentionally kept off the
    // source-watch hot path. Its timestamp makes the latest explicit evidence
    // honest while scan, context, and capture refresh without network delay.
    let graphSync: Promise<void> | undefined;
    if (graphChanged) {
      graphSync = scheduleGraphSync(graph, operation);
      void graphSync.then(publishGraph).catch(() => undefined);
    }
    if (config.preview.autoCapture && impact) {
      await graphSync;
      await captureChangedEvidence(impact.screenIds, impact.componentIds);
    }
    return graph;
  };

  let refreshQueue: Promise<typeof graph> = Promise.resolve(graph);
  const buildSettledContext = async () => {
    await refreshQueue;
    await flushPendingGraphSync();
    return buildContext();
  };
  const refresh = (): Promise<typeof graph> => {
    const pending = refreshQueue.then(() => refreshChangedSources([]));
    refreshQueue = pending.catch(() => graph);
    return pending;
  };
  const refreshChanged = (
    changedPaths: readonly string[],
  ): Promise<typeof graph> => {
    if (changedPaths.length === 0) return refresh();
    const pending = refreshQueue.then(() =>
      refreshChangedSources(changedPaths),
    );
    refreshQueue = pending.catch(() => graph);
    return pending;
  };

  const scheduleRefresh = (relativePath: string): void => {
    pendingSourceChanges.add(relativePath);
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      const changedPaths = [...pendingSourceChanges];
      pendingSourceChanges.clear();
      const pending = refreshQueue.then(() =>
        refreshChangedSources(changedPaths),
      );
      refreshQueue = pending.catch(() => graph);
    }, 120);
  };

  const server = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }
    if (!isOriginRequest(request)) {
      sendJson(response, 405, {
        error: "Only GET, HEAD, POST, PATCH, DELETE and OPTIONS are supported",
      });
      return;
    }

    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? `${host}:${port}`}`,
    );
    if (url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        version: PACKAGE_VERSION,
        pid: process.pid,
      });
      return;
    }

    if (url.pathname === "/graph") {
      sendJson(response, 200, graph);
      return;
    }

    if (
      url.pathname === "/project" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      sendJson(response, 200, projectSettings);
      return;
    }

    if (
      url.pathname === "/adapters" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void refreshQueue
        .then(buildAdapterInventoryResponse)
        .then((inventory) => sendJson(response, 200, inventory))
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to inspect adapters",
          });
        });
      return;
    }

    if (url.pathname === "/preview/sessions") {
      sendJson(response, 200, previewSessions);
      return;
    }

    if (
      url.pathname === "/studio" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      sendJson(
        response,
        200,
        StudioCustomizationResponseSchema.parse({
          schemaVersion: 1,
          ...config.studio,
        }),
      );
      return;
    }

    if (
      url.pathname === "/atlas/organization" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      sendJson(response, 200, config.atlas);
      return;
    }

    if (
      url.pathname === "/atlas/scene" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const selectedScreenId =
        url.searchParams.get("selectedScreenId") ?? undefined;
      if (
        selectedScreenId &&
        !graph.screens.some((screen) => screen.id === selectedScreenId)
      ) {
        sendJson(response, 400, {
          error: `Unknown selected screen: ${selectedScreenId}`,
        });
        return;
      }
      sendJson(
        response,
        200,
        createAtlasScene(graph, selectedScreenId, {
          routeOrganization: config.atlas,
        }),
      );
      return;
    }

    if (
      url.pathname === "/atlas/components/scene" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const selectedComponentId =
        url.searchParams.get("selectedComponentId") ?? undefined;
      if (
        selectedComponentId &&
        !graph.components.some(
          (component) => component.id === selectedComponentId,
        )
      ) {
        sendJson(response, 400, {
          error: `Unknown selected component: ${selectedComponentId}`,
        });
        return;
      }
      sendJson(
        response,
        200,
        createComponentScene(graph, selectedComponentId, {
          organization: config.atlas,
        }),
      );
      return;
    }

    if (
      url.pathname === "/atlas/flows/scene" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const selectedFlowId =
        url.searchParams.get("selectedFlowId") ?? undefined;
      const selectedStepId =
        url.searchParams.get("selectedStepId") ?? undefined;
      void flows
        .list()
        .then((items) => {
          const selectedFlow = selectedFlowId
            ? items.find((flow) => flow.id === selectedFlowId)
            : items[0];
          if (selectedFlowId && !selectedFlow) {
            sendJson(response, 400, {
              error: `Unknown selected flow: ${selectedFlowId}`,
            });
            return;
          }
          if (
            selectedStepId &&
            !selectedFlow?.steps.some((step) => step.id === selectedStepId)
          ) {
            sendJson(response, 400, {
              error: `Unknown selected step: ${selectedStepId}`,
            });
            return;
          }
          sendJson(
            response,
            200,
            createFlowScene(graph, items, selectedFlow?.id, selectedStepId),
          );
        })
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to build flow scene",
          });
        });
      return;
    }

    if (url.pathname === "/state") {
      void stateStore
        .read()
        .then((state) => sendJson(response, 200, state))
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error ? error.message : "Unable to read state",
          });
        });
      return;
    }

    if (
      url.pathname === "/jobs" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void jobs
        .inspect()
        .then((inspection) =>
          sendJson(response, 200, { schemaVersion: 1, ...inspection }),
        )
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error ? error.message : "Unable to read jobs",
          });
        });
      return;
    }

    if (
      url.pathname === "/snapshots" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void stateStore
        .read()
        .then((state) => {
          const requestOrigin = `http://${request.headers.host ?? `${host}:${actualPort}`}`;
          sendJson(response, 200, {
            schemaVersion: 1,
            snapshots: state.snapshots.map((snapshot) => ({
              ...snapshot,
              ...(snapshot.artifactPath
                ? {
                    imageUrl: artifactImageUrl(
                      requestOrigin,
                      `/snapshots/${encodeURIComponent(snapshot.id)}/image.png`,
                      snapshot.contentHash,
                    ),
                  }
                : {}),
            })),
          });
        })
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read snapshots",
          });
        });
      return;
    }

    if (
      url.pathname === "/component-previews" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void stateStore
        .read()
        .then((state) => {
          const requestOrigin = `http://${request.headers.host ?? `${host}:${actualPort}`}`;
          sendJson(response, 200, {
            schemaVersion: 1,
            previewArtifacts: state.previewArtifacts.map((artifact) => ({
              ...artifact,
              ...(artifact.artifactPath
                ? {
                    imageUrl: artifactImageUrl(
                      requestOrigin,
                      `/component-previews/${encodeURIComponent(artifact.id)}/image.png`,
                      artifact.contentHash,
                    ),
                  }
                : {}),
            })),
          });
        })
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read component previews",
          });
        });
      return;
    }

    if (
      url.pathname === "/visuals" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void stateStore
        .read()
        .then((state) => {
          const requestOrigin = `http://${request.headers.host ?? `${host}:${actualPort}`}`;
          sendJson(response, 200, {
            schemaVersion: 1,
            baselines: state.visualBaselines.map((baseline) => ({
              ...baseline,
              imageUrl: artifactImageUrl(
                requestOrigin,
                `/visuals/baselines/${encodeURIComponent(baseline.id)}/image.png`,
                baseline.contentHash,
              ),
            })),
            comparisons: state.visualComparisons.map((comparison) => ({
              ...comparison,
              ...(comparison.artifactPath
                ? {
                    imageUrl: artifactImageUrl(
                      requestOrigin,
                      `/visuals/comparisons/${encodeURIComponent(comparison.id)}/image.png`,
                      comparison.currentHash,
                    ),
                  }
                : {}),
            })),
          });
        })
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read visual evidence",
          });
        });
      return;
    }

    if (url.pathname === "/visuals/baseline" && request.method === "POST") {
      void readRequestBody(request)
        .then((body) =>
          AcceptVisualBaselineRequestSchema.parse(
            JSON.parse(body || "{}") as unknown,
          ),
        )
        .then(async (input) => {
          if (!graph.screens.some((screen) => screen.id === input.screenId)) {
            const error = new Error(`Unknown screen: ${input.screenId}`);
            Object.assign(error, { statusCode: 400 });
            throw error;
          }
          const result = await acceptBaseline({
            rootDir: projectRoot,
            screenId: input.screenId,
          });
          await syncContext();
          publishResource("visuals");
          sendJson(response, 201, result);
        })
        .catch((error: unknown) => {
          const statusCode =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            (error as { statusCode?: unknown }).statusCode === 400
              ? 400
              : error instanceof Error &&
                  (error.name === "ZodError" ||
                    error.message.startsWith("Unknown captured screen"))
                ? 400
                : 500;
          sendJson(response, statusCode, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to accept visual baseline",
          });
        });
      return;
    }

    if (
      url.pathname === "/interaction-probes" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const routePath = url.searchParams.get("routePath") ?? undefined;
      if (routePath !== undefined && !routePath.startsWith("/")) {
        sendJson(response, 400, {
          error: "routePath must start with /",
        });
        return;
      }
      void stateStore
        .read()
        .then((state) => {
          sendJson(response, 200, {
            schemaVersion: 1,
            interactionProbes: routePath
              ? state.interactionProbes.filter(
                  (artifact) => artifact.routePath === routePath,
                )
              : state.interactionProbes,
          });
        })
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read interaction probes",
          });
        });
      return;
    }

    const snapshotImageMatch = /^\/snapshots\/([^/]+)\/image(?:\.png)?$/.exec(
      url.pathname,
    );
    if (
      snapshotImageMatch &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const encodedId = snapshotImageMatch[1];
      if (!encodedId) {
        sendNotFound(response);
        return;
      }
      void readSnapshotArtifact(projectRoot, decodeURIComponent(encodedId))
        .then((artifact) => {
          if (!artifact) {
            sendNotFound(response);
            return;
          }
          response.writeHead(200, {
            "content-type": artifact.mimeType,
            "content-length": artifact.data.byteLength,
            "cache-control": "no-store",
            ...CORS_HEADERS,
          });
          response.end(request.method === "HEAD" ? undefined : artifact.data);
        })
        .catch((error: unknown) => {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read snapshot artifact",
          });
        });
      return;
    }

    const componentPreviewImageMatch =
      /^\/component-previews\/([^/]+)\/image(?:\.png)?$/.exec(url.pathname);
    if (
      componentPreviewImageMatch &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const encodedId = componentPreviewImageMatch[1];
      if (!encodedId) {
        sendNotFound(response);
        return;
      }
      void readComponentPreviewArtifact(
        projectRoot,
        decodeURIComponent(encodedId),
      )
        .then((artifact) => {
          if (!artifact) {
            sendNotFound(response);
            return;
          }
          response.writeHead(200, {
            "content-type": artifact.mimeType,
            "content-length": artifact.data.byteLength,
            "cache-control": "no-store",
            ...CORS_HEADERS,
          });
          response.end(request.method === "HEAD" ? undefined : artifact.data);
        })
        .catch((error: unknown) => {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read component preview artifact",
          });
        });
      return;
    }

    const visualBaselineImageMatch =
      /^\/visuals\/baselines\/([^/]+)\/image(?:\.png)?$/.exec(url.pathname);
    if (
      visualBaselineImageMatch &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const encodedId = visualBaselineImageMatch[1];
      if (!encodedId) {
        sendNotFound(response);
        return;
      }
      void readVisualBaselineArtifact(
        projectRoot,
        decodeURIComponent(encodedId),
      )
        .then((artifact) => {
          if (!artifact) {
            sendNotFound(response);
            return;
          }
          response.writeHead(200, {
            "content-type": artifact.mimeType,
            "content-length": artifact.data.byteLength,
            "cache-control": "no-store",
            ...CORS_HEADERS,
          });
          response.end(request.method === "HEAD" ? undefined : artifact.data);
        })
        .catch((error: unknown) => {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read visual baseline artifact",
          });
        });
      return;
    }

    const visualComparisonImageMatch =
      /^\/visuals\/comparisons\/([^/]+)\/image(?:\.png)?$/.exec(url.pathname);
    if (
      visualComparisonImageMatch &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const encodedId = visualComparisonImageMatch[1];
      if (!encodedId) {
        sendNotFound(response);
        return;
      }
      void readVisualComparisonArtifact(
        projectRoot,
        decodeURIComponent(encodedId),
      )
        .then((artifact) => {
          if (!artifact) {
            sendNotFound(response);
            return;
          }
          response.writeHead(200, {
            "content-type": artifact.mimeType,
            "content-length": artifact.data.byteLength,
            "cache-control": "no-store",
            ...CORS_HEADERS,
          });
          response.end(request.method === "HEAD" ? undefined : artifact.data);
        })
        .catch((error: unknown) => {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read visual comparison artifact",
          });
        });
      return;
    }

    if (
      url.pathname === "/diagnostics" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void stateStore
        .read()
        .then((state) => sendJson(response, 200, { findings: state.findings }))
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read diagnostics",
          });
        });
      return;
    }

    if (
      url.pathname === "/cache" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void inspectProjectCache(projectRoot)
        .then((report) => sendJson(response, 200, report))
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to inspect the derived cache",
          });
        });
      return;
    }

    if (url.pathname === "/cache/clean" && request.method === "POST") {
      void readRequestBody(request).then(async (body) => {
        let input;
        try {
          input = CacheCleanRequestSchema.parse(
            body.trim() ? JSON.parse(body) : {},
          );
        } catch (error) {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : "Cache cleanup input is invalid",
          });
          return;
        }

        try {
          const result = await cleanProjectCache(projectRoot, input);
          if (!result.dryRun) publishResource("cache");
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to clean the derived cache",
          });
        }
      });
      return;
    }

    if (
      url.pathname === "/doctor" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      sendJson(response, 200, doctorReport);
      return;
    }

    if (url.pathname === "/doctor" && request.method === "POST") {
      void refreshQueue
        .then(() => refreshDoctorReport())
        .then((report) => sendJson(response, 200, report))
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to run Topo Doctor",
          });
        });
      return;
    }

    if (url.pathname === "/scan" && request.method === "POST") {
      void refresh()
        .then((nextGraph) => sendJson(response, 200, nextGraph))
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to scan workspace",
          });
        });
      return;
    }

    if (url.pathname === "/capture" && request.method === "POST") {
      void readRequestBody(request)
        .then(async (body) => {
          const input = body.trim()
            ? (JSON.parse(body) as { profile?: string })
            : {};
          const profile = input.profile
            ? config.profiles.find(
                (candidate) => candidate.name === input.profile,
              )
            : config.profiles[0];
          if (input.profile && !profile)
            throw new Error(`Unknown preview profile: ${input.profile}`);
          const job = jobs.submit("capture", () =>
            captureRoutes({
              rootDir: projectRoot,
              graph,
              baseUrl: config.preview.baseUrl,
              headless: config.preview.headless,
              executablePath: config.preview.executablePath,
              viewport: config.preview.viewport,
              profile,
            }),
          );
          const result = await job.completion;
          graph = result.graph;
          await syncContext();
          publishGraph();
          publishResource("snapshots");
          if (result.comparisons.length > 0) publishResource("visuals");
          sendJson(response, 200, { ...result, jobId: job.id });
        })
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to capture screens",
          });
        });
      return;
    }

    if (
      url.pathname === "/components/previews/scaffold" &&
      request.method === "POST"
    ) {
      if (!isTrustedSourceMutationRequest(request)) {
        sendJson(response, 403, {
          error:
            "Component preview scaffolding accepts only local Studio origins.",
        });
        return;
      }
      void readRequestBody(request)
        .then(async (body) => {
          let input: { componentId: string };
          try {
            input = ComponentPreviewScaffoldRequestSchema.parse(
              body.trim() ? JSON.parse(body) : {},
            );
          } catch {
            const error = new Error(
              "componentId is required to scaffold a component preview.",
            );
            Object.assign(error, { statusCode: 400 });
            throw error;
          }
          const component = graph.components.find(
            (candidate) => candidate.id === input.componentId,
          );
          if (!component) {
            const error = new Error(`Unknown component: ${input.componentId}`);
            Object.assign(error, { statusCode: 400 });
            throw error;
          }
          const operation = refreshQueue.then(async () => {
            const result = await scaffoldPreview({ sourceRoot, component });
            const responseGraph = await refreshChangedSources([
              result.previewSource,
            ]);
            return { result, graph: responseGraph };
          });
          refreshQueue = operation
            .then((result) => result.graph)
            .catch(() => graph);
          const result = await operation;
          sendJson(response, 201, { schemaVersion: 1, ...result });
        })
        .catch((error: unknown) => {
          const statusCode =
            error instanceof ComponentPreviewScaffoldError &&
            error.code === "target-exists"
              ? 409
              : typeof error === "object" &&
                  error !== null &&
                  "statusCode" in error &&
                  (error as { statusCode?: unknown }).statusCode === 400
                ? 400
                : 500;
          sendJson(response, statusCode, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to scaffold the component preview",
          });
        });
      return;
    }

    if (url.pathname === "/capture/components" && request.method === "POST") {
      void readRequestBody(request)
        .then(async (body) => {
          const input = body.trim()
            ? (JSON.parse(body) as {
                profile?: string;
                componentIds?: string[];
              })
            : {};
          if (
            input.componentIds !== undefined &&
            (!Array.isArray(input.componentIds) ||
              input.componentIds.some((id) => typeof id !== "string"))
          ) {
            throw new Error("componentIds must be an array of component IDs");
          }
          for (const componentId of input.componentIds ?? []) {
            if (!graph.components.some((item) => item.id === componentId)) {
              const error = new Error(`Unknown component: ${componentId}`);
              Object.assign(error, { statusCode: 400 });
              throw error;
            }
          }
          const profile = input.profile
            ? config.profiles.find(
                (candidate) => candidate.name === input.profile,
              )
            : config.profiles[0];
          if (input.profile && !profile) {
            const error = new Error(
              `Unknown preview profile: ${input.profile}`,
            );
            Object.assign(error, { statusCode: 400 });
            throw error;
          }
          const componentBaseUrls =
            await componentPreviewRuntimeManager.resolveBaseUrls(
              graph,
              input.componentIds,
            );
          const job = jobs.submit("capture", () =>
            capturePreviews({
              rootDir: projectRoot,
              graph,
              adapters: componentPreviewAdapters,
              baseUrls: componentBaseUrls,
              componentIds: input.componentIds,
              headless: config.preview.headless,
              executablePath: config.preview.executablePath,
              viewport: config.preview.viewport,
              profile,
            }),
          );
          const result = await job.completion;
          await syncContext();
          publishResource("component-previews");
          sendJson(response, 200, { ...result, jobId: job.id });
        })
        .catch((error: unknown) => {
          const statusCode =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            (error as { statusCode?: unknown }).statusCode === 400
              ? 400
              : 500;
          sendJson(response, statusCode, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to capture component previews",
          });
        });
      return;
    }

    if (url.pathname === "/diagnostics" && request.method === "POST") {
      void readRequestBody(request)
        .then(async (body) => {
          const input = body.trim()
            ? (JSON.parse(body) as {
                runtime?: boolean;
                profile?: string;
                routes?: string[];
              })
            : {};
          if (
            input.routes !== undefined &&
            (!Array.isArray(input.routes) ||
              input.routes.some(
                (routePath) =>
                  typeof routePath !== "string" || !routePath.startsWith("/"),
              ))
          ) {
            const error = new Error(
              "routes must be an array of application route paths",
            );
            Object.assign(error, { statusCode: 400 });
            throw error;
          }
          for (const routePath of new Set(input.routes ?? [])) {
            if (
              !graph.screens.some(
                (screen) =>
                  screen.routePath === routePath && screen.state === "default",
              )
            ) {
              const error = new Error(`Unknown diagnostic route: ${routePath}`);
              Object.assign(error, { statusCode: 400 });
              throw error;
            }
          }
          const profile = input.profile
            ? config.profiles.find(
                (candidate) => candidate.name === input.profile,
              )
            : config.profiles[0];
          if (input.profile && !profile)
            throw new Error(`Unknown preview profile: ${input.profile}`);
          const job = jobs.submit("diagnostic", () =>
            runDiagnostics({
              rootDir: sourceRoot,
              graph,
              baseUrl: config.preview.baseUrl,
              profile,
              headless: config.preview.headless,
              executablePath: config.preview.executablePath,
              viewport: config.preview.viewport,
              runtime: input.runtime === true,
              routes: input.routes,
            }),
          );
          const result = await job.completion;
          graph = result.graph;
          const runId = `diagnostic-${Date.now()}`;
          await stateStore.saveGraph(graph);
          await stateStore.saveFindings(
            result.findings.map((finding) => ({
              ...finding,
              runId,
              observedAt: new Date().toISOString(),
            })),
          );
          if (result.probedRoutes.length > 0) {
            await stateStore.replaceInteractionProbes(
              result.probedRoutes,
              result.interactionProbes,
            );
          }
          await syncContext();
          publishGraph();
          if (result.probedRoutes.length > 0) {
            publishResource("interaction-probes");
          }
          sendJson(response, 200, { ...result, jobId: job.id });
        })
        .catch((error: unknown) => {
          const statusCode =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            (error as { statusCode?: unknown }).statusCode === 400
              ? 400
              : 500;
          sendJson(response, statusCode, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to run diagnostics",
          });
        });
      return;
    }

    if (
      url.pathname === "/context/schema" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      sendJson(response, 200, LLM_CONTEXT_JSON_SCHEMA);
      return;
    }

    if (
      url.pathname === "/context/manifest" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void buildSettledContext()
        .then((context) => sendJson(response, 200, context.manifest))
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to build LLM context manifest",
          });
        });
      return;
    }

    if (
      url.pathname === "/context" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      void buildSettledContext()
        .then((context) => {
          const requestedKinds = url.searchParams
            .getAll("kind")
            .flatMap((value) => value.split(","))
            .map((value) => value.trim())
            .filter(Boolean);
          const invalidKind = requestedKinds.find(
            (kind) => !LLM_CONTEXT_KINDS.includes(kind as LlmContextKind),
          );
          if (invalidKind)
            throw new Error(`Unknown context kind: ${invalidKind}`);
          const result = queryLlmContext(context, {
            query: url.searchParams.get("q") ?? undefined,
            kinds: requestedKinds as LlmContextKind[],
            routePath: url.searchParams.get("route") ?? undefined,
            limit: url.searchParams.has("limit")
              ? Number(url.searchParams.get("limit"))
              : undefined,
            offset: url.searchParams.has("offset")
              ? Number(url.searchParams.get("offset"))
              : undefined,
          });
          sendJson(response, 200, { manifest: context.manifest, ...result });
        })
        .catch((error: unknown) => {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to query LLM context",
          });
        });
      return;
    }

    if (url.pathname === "/context/export" && request.method === "POST") {
      void buildSettledContext()
        .then(async (context) => ({
          context,
          result: await exportLlmContext(projectRoot, context),
        }))
        .then(({ context, result }) =>
          sendJson(response, 200, { ...result, manifest: context.manifest }),
        )
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to export LLM context",
          });
        });
      return;
    }

    const flowItemMatch = /^\/flows\/([^/]+)$/.exec(url.pathname);
    if (flowItemMatch) {
      let flowId: string;
      try {
        flowId = FlowIdSchema.parse(decodeURIComponent(flowItemMatch[1]!));
      } catch (error) {
        sendJson(response, 400, {
          error:
            error instanceof Error ? error.message : "Invalid flow identity",
        });
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        void flows
          .get(flowId)
          .then((flow) => {
            if (!flow) sendNotFound(response);
            else sendJson(response, 200, flow);
          })
          .catch((error: unknown) => {
            sendJson(response, 500, {
              error:
                error instanceof Error ? error.message : "Unable to read flow",
            });
          });
        return;
      }

      if (request.method === "PATCH") {
        void readRequestBody(request)
          .then(async (body) => {
            const input = UpdateFlowInputSchema.parse(
              JSON.parse(body) as unknown,
            );
            const flow = await flows.update(flowId, input);
            if (!flow) {
              sendNotFound(response);
              return;
            }
            await refreshResource("flows");
            sendJson(response, 200, flow);
          })
          .catch((error: unknown) => {
            sendJson(response, 400, {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to update flow",
            });
          });
        return;
      }

      if (request.method === "DELETE") {
        void flows
          .remove(flowId)
          .then(async (removed) => {
            if (!removed) {
              sendNotFound(response);
              return;
            }
            await refreshResource("flows");
            response.writeHead(204, CORS_HEADERS);
            response.end();
          })
          .catch((error: unknown) => {
            sendJson(response, 500, {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to delete flow",
            });
          });
        return;
      }

      sendJson(response, 405, { error: "Unsupported flow operation" });
      return;
    }

    if (url.pathname === "/flows") {
      if (request.method === "GET" || request.method === "HEAD") {
        void flows
          .inspect()
          .then((inspection) =>
            sendJson(response, 200, { schemaVersion: 1, ...inspection }),
          )
          .catch((error: unknown) => {
            sendJson(response, 500, {
              error:
                error instanceof Error ? error.message : "Unable to read flows",
            });
          });
        return;
      }

      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Unsupported flow operation" });
        return;
      }

      void readRequestBody(request)
        .then(async (body) => {
          const input = WriteFlowInputSchema.parse(JSON.parse(body) as unknown);
          const flow = await flows.write(input);
          await refreshResource("flows");
          sendJson(response, 201, flow);
        })
        .catch((error: unknown) => {
          sendJson(response, 400, {
            error:
              error instanceof Error ? error.message : "Unable to write flow",
          });
        });
      return;
    }

    const noteItemMatch = /^\/notes\/([^/]+)$/.exec(url.pathname);
    if (noteItemMatch) {
      let noteId: string;
      try {
        noteId = NoteIdSchema.parse(decodeURIComponent(noteItemMatch[1]!));
      } catch (error) {
        sendJson(response, 400, {
          error:
            error instanceof Error ? error.message : "Invalid note identity",
        });
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        void notes
          .get(noteId)
          .then((note) => {
            if (!note) sendNotFound(response);
            else sendJson(response, 200, note);
          })
          .catch((error: unknown) => {
            sendJson(response, 500, {
              error:
                error instanceof Error ? error.message : "Unable to read note",
            });
          });
        return;
      }

      if (request.method === "PATCH") {
        void readRequestBody(request)
          .then(async (body) => {
            const input = UpdateNoteInputSchema.parse(
              JSON.parse(body) as unknown,
            );
            const note = await notes.update(noteId, input);
            if (!note) {
              sendNotFound(response);
              return;
            }
            await refreshResource("notes");
            sendJson(response, 200, note);
          })
          .catch((error: unknown) => {
            sendJson(response, 400, {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to update note",
            });
          });
        return;
      }

      if (request.method === "DELETE") {
        void notes
          .remove(noteId)
          .then(async (removed) => {
            if (!removed) {
              sendNotFound(response);
              return;
            }
            await refreshResource("notes");
            response.writeHead(204, CORS_HEADERS);
            response.end();
          })
          .catch((error: unknown) => {
            sendJson(response, 500, {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to delete note",
            });
          });
        return;
      }

      sendJson(response, 405, { error: "Unsupported note operation" });
      return;
    }

    if (url.pathname === "/notes") {
      if (request.method === "GET" || request.method === "HEAD") {
        void notes
          .inspect()
          .then((inspection) =>
            sendJson(response, 200, { schemaVersion: 1, ...inspection }),
          )
          .catch((error: unknown) => {
            sendJson(response, 500, {
              error:
                error instanceof Error ? error.message : "Unable to read notes",
            });
          });
        return;
      }

      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Unsupported note operation" });
        return;
      }

      void readRequestBody(request)
        .then(async (body) => {
          const input = WriteNoteInputSchema.parse(JSON.parse(body) as unknown);
          const note = await notes.write(input);
          await refreshResource("notes");
          sendJson(response, 201, note);
        })
        .catch((error: unknown) => {
          sendJson(response, 400, {
            error:
              error instanceof Error ? error.message : "Unable to write note",
          });
        });
      return;
    }

    if (
      url.pathname === "/review" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const requestedFormat = url.searchParams.get("format") ?? "markdown";
      const requestedInclude = url.searchParams.get("include") ?? "all";
      if (
        !REVIEW_EXPORT_FORMATS.includes(
          requestedFormat as ReviewExportFormat,
        ) ||
        !REVIEW_EXPORT_INCLUDES.includes(
          requestedInclude as ReviewExportInclude,
        )
      ) {
        sendJson(response, 400, {
          error: `Review export requires format=${REVIEW_EXPORT_FORMATS.join("|")} and include=${REVIEW_EXPORT_INCLUDES.join("|")}`,
        });
        return;
      }
      void Promise.all([notes.list(), stateStore.read()])
        .then(([items, state]) => {
          const artifact = exportReview(
            { graph, notes: items, snapshots: state.snapshots },
            {
              format: requestedFormat as ReviewExportFormat,
              include: requestedInclude as ReviewExportInclude,
              attachSnapshots: url.searchParams.get("snapshots") === "1",
            },
          );
          response.writeHead(200, {
            "content-type": artifact.mimeType,
            "content-disposition": `attachment; filename="${artifact.fileName}"`,
            ...CORS_HEADERS,
            "cache-control": "no-store",
          });
          response.end(request.method === "HEAD" ? undefined : artifact.body);
        })
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to export review",
          });
        });
      return;
    }

    if (url.pathname === "/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        ...CORS_HEADERS,
      });
      response.write(": topo connected\n\n");
      sendEvent(response, graphEvent("graph.snapshot", graph));
      subscribers.add(response);
      request.on("close", () => subscribers.delete(response));
      return;
    }

    sendNotFound(response);
  });

  const handleSourceWatch = (fileName: string | Buffer | null): void => {
    const relativePath = String(fileName ?? "").replace(/\\/g, "/");
    if (
      relativePath === ".topo" ||
      relativePath.startsWith(".topo/") ||
      relativePath === "node_modules" ||
      relativePath.startsWith("node_modules/") ||
      relativePath === ".next" ||
      relativePath.startsWith(".next/") ||
      relativePath === "dist" ||
      relativePath.startsWith("dist/")
    ) {
      return;
    }
    scheduleRefresh(relativePath);
  };

  if (options.watch !== false) {
    if (sourceRoot === projectRoot) {
      sourceWatcher = watch(
        sourceRoot,
        { recursive: true },
        (_eventType, fileName) => {
          const relativePath = String(fileName ?? "").replace(/\\/g, "/");
          const resource = classifyWatchedResource(relativePath);
          if (resource) {
            scheduleResourceRefresh(resource);
            return;
          }
          handleSourceWatch(fileName);
        },
      );
    } else {
      sourceWatcher = watch(
        sourceRoot,
        { recursive: true },
        (_eventType, fileName) => handleSourceWatch(fileName),
      );
      projectWatcher = watch(
        projectRoot,
        { recursive: true },
        (_eventType, fileName) => {
          const nestedPath = String(fileName ?? "").replace(/\\/g, "/");
          const resource = classifyWatchedResource(nestedPath);
          if (resource) scheduleResourceRefresh(resource);
        },
      );
    }
  }

  return {
    host,
    get port() {
      return actualPort;
    },
    getGraph: () => Promise.resolve(graph),
    refreshChanged,
    refresh,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          if (address && typeof address === "object") actualPort = address.port;
          resolve();
        });
      }),
    close: async () => {
      closed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (resourceRefreshTimer) clearTimeout(resourceRefreshTimer);
      pendingResourceRefreshes.clear();
      pendingSourceChanges.clear();
      sourceWatcher?.close();
      projectWatcher?.close();
      await refreshQueue.catch(() => graph);
      await flushPendingGraphSync();
      for (const subscriber of subscribers) subscriber.end();
      subscribers.clear();
      const serverClose = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      const [runtimeResult, serverResult] = await Promise.allSettled([
        componentPreviewRuntimeManager.close(),
        serverClose,
      ]);
      if (runtimeResult.status === "rejected") throw runtimeResult.reason;
      if (serverResult.status === "rejected") throw serverResult.reason;
    },
  };
}
