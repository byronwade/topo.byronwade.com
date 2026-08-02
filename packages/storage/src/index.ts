import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  ApplicationGraphSchema,
  ComponentPreviewArtifactSchema,
  InteractionProbeArtifactSchema,
  RouteSnapshotSchema,
  VisualBaselineSchema,
  VisualComparisonSchema,
  type ApplicationGraph,
  type ComponentPreviewArtifact,
  type Finding,
  type InteractionProbeArtifact,
  type RouteSnapshot,
  type VisualBaseline,
  type VisualComparison,
} from "@topo/schema";

export const PROJECT_STATE_VERSION = 1 as const;
export const DEFAULT_TERMINAL_JOB_RETENTION = 100;

const stateOperationQueues = new Map<string, Promise<void>>();
const parsedStateCache = new Map<
  string,
  {
    signature: string;
    terminalJobLimit: number;
    state: ProjectState;
    changed: boolean;
  }
>();

function stateQueueKey(statePath: string): string {
  const resolved = path.normalize(path.resolve(statePath));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function stateFileSignature(statePath: string): Promise<string> {
  const details = await stat(statePath);
  return `${details.size}:${details.mtimeMs}:${details.ctimeMs}`;
}

function enqueueStateOperation<T>(
  statePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = stateQueueKey(statePath);
  const previous = stateOperationQueues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  stateOperationQueues.set(key, settled);
  void settled.then(() => {
    if (stateOperationQueues.get(key) === settled) {
      stateOperationQueues.delete(key);
    }
  });
  return result;
}

export type StoredSnapshot = RouteSnapshot;

export interface StoredFinding extends Finding {
  runId: string;
  observedAt: string;
}

export interface StoredJob {
  id: string;
  kind: "scan" | "capture" | "diagnostic" | "export";
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  progress: number;
  message?: string;
  error?: string;
}

export interface JobHistoryRetention {
  terminalLimit: number;
  retained: number;
  pruned: number;
}

export interface ProjectState {
  version: typeof PROJECT_STATE_VERSION;
  updatedAt: string;
  graph?: ApplicationGraph;
  snapshots: StoredSnapshot[];
  visualBaselines: VisualBaseline[];
  visualComparisons: VisualComparison[];
  previewArtifacts: ComponentPreviewArtifact[];
  interactionProbes: InteractionProbeArtifact[];
  findings: StoredFinding[];
  jobs: StoredJob[];
  jobHistory: JobHistoryRetention;
}

export interface ProjectStateStore {
  path: string;
  read(): Promise<ProjectState>;
  update(
    mutator: (state: ProjectState) => ProjectState | void,
  ): Promise<ProjectState>;
  saveGraph(graph: ApplicationGraph): Promise<ProjectState>;
  recordSnapshot(snapshot: StoredSnapshot): Promise<ProjectState>;
  commitCapture(input: {
    graph: ApplicationGraph;
    snapshots: StoredSnapshot[];
    visualComparisons: VisualComparison[];
  }): Promise<ProjectState>;
  recordVisualBaseline(baseline: VisualBaseline): Promise<ProjectState>;
  recordVisualComparison(comparison: VisualComparison): Promise<ProjectState>;
  recordPreviewArtifact(
    artifact: ComponentPreviewArtifact,
  ): Promise<ProjectState>;
  recordPreviewArtifacts(
    artifacts: ComponentPreviewArtifact[],
  ): Promise<ProjectState>;
  replaceInteractionProbes(
    routePaths: string[],
    artifacts: InteractionProbeArtifact[],
  ): Promise<ProjectState>;
  saveFindings(findings: StoredFinding[]): Promise<ProjectState>;
  saveJob(job: StoredJob): Promise<ProjectState>;
  compact(): Promise<ProjectState>;
}

export interface ProjectStateStoreOptions {
  terminalJobLimit?: number;
}

function stateDirectory(rootDir: string): string {
  return path.join(path.resolve(rootDir), ".topo");
}

function emptyState(terminalJobLimit: number): ProjectState {
  return {
    version: PROJECT_STATE_VERSION,
    updatedAt: new Date(0).toISOString(),
    snapshots: [],
    visualBaselines: [],
    visualComparisons: [],
    previewArtifacts: [],
    interactionProbes: [],
    findings: [],
    jobs: [],
    jobHistory: {
      terminalLimit: terminalJobLimit,
      retained: 0,
      pruned: 0,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jobTime(job: StoredJob): number {
  const updatedAt = Date.parse(job.updatedAt);
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(job.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function newestJobFirst(left: StoredJob, right: StoredJob): number {
  return jobTime(right) - jobTime(left) || left.id.localeCompare(right.id);
}

export function retainJobHistory(
  jobs: readonly StoredJob[],
  terminalLimit = DEFAULT_TERMINAL_JOB_RETENTION,
): { jobs: StoredJob[]; pruned: number } {
  if (!Number.isInteger(terminalLimit) || terminalLimit < 1) {
    throw new Error("terminalJobLimit must be a positive integer");
  }
  const active = jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .sort(newestJobFirst);
  const terminal = jobs
    .filter((job) => job.status === "completed" || job.status === "failed")
    .sort(newestJobFirst);
  const retained = [...active, ...terminal.slice(0, terminalLimit)].sort(
    newestJobFirst,
  );
  return {
    jobs: retained,
    pruned: Math.max(0, terminal.length - terminalLimit),
  };
}

function normalizeJobState(
  jobs: StoredJob[],
  previousPruned: number,
  terminalJobLimit: number,
): Pick<ProjectState, "jobs" | "jobHistory"> {
  const retained = retainJobHistory(jobs, terminalJobLimit);
  return {
    jobs: retained.jobs,
    jobHistory: {
      terminalLimit: terminalJobLimit,
      retained: retained.jobs.length,
      pruned: previousPruned + retained.pruned,
    },
  };
}

function parseState(
  value: unknown,
  terminalJobLimit: number,
): { state: ProjectState; changed: boolean } {
  if (!isRecord(value) || value.version !== PROJECT_STATE_VERSION) {
    throw new Error("Topo project state has an unsupported version");
  }

  const graph =
    value.graph === undefined
      ? undefined
      : ApplicationGraphSchema.parse(value.graph);
  const snapshots = Array.isArray(value.snapshots)
    ? value.snapshots.map((snapshot) => RouteSnapshotSchema.parse(snapshot))
    : [];
  const visualBaselines = Array.isArray(value.visualBaselines)
    ? value.visualBaselines.map((baseline) =>
        VisualBaselineSchema.parse(baseline),
      )
    : [];
  const visualComparisons = Array.isArray(value.visualComparisons)
    ? value.visualComparisons.map((comparison) =>
        VisualComparisonSchema.parse(comparison),
      )
    : [];
  const previewArtifacts = Array.isArray(value.previewArtifacts)
    ? value.previewArtifacts.map((artifact) =>
        ComponentPreviewArtifactSchema.parse(artifact),
      )
    : [];
  const interactionProbes = Array.isArray(value.interactionProbes)
    ? value.interactionProbes.map((artifact) =>
        InteractionProbeArtifactSchema.parse(artifact),
      )
    : [];
  const findings = Array.isArray(value.findings)
    ? (value.findings as StoredFinding[])
    : [];
  const jobs = Array.isArray(value.jobs) ? (value.jobs as StoredJob[]) : [];
  const storedJobHistory = isRecord(value.jobHistory)
    ? value.jobHistory
    : undefined;
  const previousPruned =
    typeof storedJobHistory?.pruned === "number" &&
    Number.isInteger(storedJobHistory.pruned) &&
    storedJobHistory.pruned >= 0
      ? storedJobHistory.pruned
      : 0;
  const normalizedJobs = normalizeJobState(
    jobs,
    previousPruned,
    terminalJobLimit,
  );

  const state: ProjectState = {
    version: PROJECT_STATE_VERSION,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date(0).toISOString(),
    graph,
    snapshots,
    visualBaselines,
    visualComparisons,
    previewArtifacts,
    interactionProbes,
    findings,
    ...normalizedJobs,
  };
  const changed =
    normalizedJobs.jobs.length !== jobs.length ||
    !storedJobHistory ||
    storedJobHistory.terminalLimit !== terminalJobLimit ||
    storedJobHistory.retained !== normalizedJobs.jobHistory.retained ||
    storedJobHistory.pruned !== normalizedJobs.jobHistory.pruned ||
    normalizedJobs.jobs.some((job, index) => jobs[index]?.id !== job.id);
  return { state, changed };
}

export function createProjectStateStore(
  rootDir: string,
  options: ProjectStateStoreOptions = {},
): ProjectStateStore {
  const terminalJobLimit =
    options.terminalJobLimit ?? DEFAULT_TERMINAL_JOB_RETENTION;
  if (!Number.isInteger(terminalJobLimit) || terminalJobLimit < 1) {
    throw new Error("terminalJobLimit must be a positive integer");
  }
  const directory = stateDirectory(rootDir);
  const statePath = path.join(directory, "state.json");

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> =>
    enqueueStateOperation(statePath, operation);

  const readParsed = async (): Promise<{
    state: ProjectState;
    changed: boolean;
  }> => {
    await mkdir(directory, { recursive: true });
    try {
      const key = stateQueueKey(statePath);
      const signature = await stateFileSignature(statePath);
      const cached = parsedStateCache.get(key);
      if (
        cached?.signature === signature &&
        cached.terminalJobLimit === terminalJobLimit
      ) {
        return { state: cached.state, changed: cached.changed };
      }
      const parsed = parseState(
        JSON.parse(await readFile(statePath, "utf8")) as unknown,
        terminalJobLimit,
      );
      parsedStateCache.set(key, {
        signature,
        terminalJobLimit,
        state: parsed.state,
        changed: parsed.changed,
      });
      return parsed;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        parsedStateCache.delete(stateQueueKey(statePath));
        return { state: emptyState(terminalJobLimit), changed: false };
      }
      throw error;
    }
  };

  const read = async (): Promise<ProjectState> => (await readParsed()).state;

  const write = async (state: ProjectState): Promise<ProjectState> => {
    await mkdir(directory, { recursive: true });
    const normalizedJobs = normalizeJobState(
      state.jobs,
      state.jobHistory.pruned,
      terminalJobLimit,
    );
    const next = {
      ...state,
      ...normalizedJobs,
      updatedAt: new Date().toISOString(),
    };
    const temporaryPath = path.join(directory, `.state.${randomUUID()}.tmp`);
    await writeFile(
      temporaryPath,
      `${JSON.stringify(next, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, statePath);
    parsedStateCache.set(stateQueueKey(statePath), {
      signature: await stateFileSignature(statePath),
      terminalJobLimit,
      state: next,
      changed: false,
    });
    return next;
  };

  return {
    path: statePath,
    read: () => enqueue(read),
    update: (mutator) =>
      enqueue(async () => {
        const current = await read();
        const next = mutator(current) ?? current;
        return write(next);
      }),
    saveGraph: (graph) =>
      enqueue(async () => {
        const current = await read();
        return write({
          ...current,
          graph: ApplicationGraphSchema.parse(graph),
        });
      }),
    recordSnapshot: (snapshot) =>
      enqueue(async () => {
        const current = await read();
        const parsed = RouteSnapshotSchema.parse(snapshot);
        return write({
          ...current,
          snapshots: [
            parsed,
            ...current.snapshots.filter((item) => item.id !== parsed.id),
          ],
        });
      }),
    commitCapture: (input) =>
      enqueue(async () => {
        const current = await read();
        const graph = ApplicationGraphSchema.parse(input.graph);
        const snapshots = input.snapshots.map((snapshot) =>
          RouteSnapshotSchema.parse(snapshot),
        );
        const visualComparisons = input.visualComparisons.map((comparison) =>
          VisualComparisonSchema.parse(comparison),
        );
        const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));
        const comparisonScreenIds = new Set(
          visualComparisons.map((comparison) => comparison.screenId),
        );
        return write({
          ...current,
          graph,
          snapshots: [
            ...snapshots,
            ...current.snapshots.filter(
              (snapshot) => !snapshotIds.has(snapshot.id),
            ),
          ],
          visualComparisons: [
            ...visualComparisons,
            ...current.visualComparisons.filter(
              (comparison) => !comparisonScreenIds.has(comparison.screenId),
            ),
          ],
        });
      }),
    recordVisualBaseline: (baseline) =>
      enqueue(async () => {
        const current = await read();
        const parsed = VisualBaselineSchema.parse(baseline);
        return write({
          ...current,
          visualBaselines: [
            parsed,
            ...current.visualBaselines.filter(
              (item) => item.screenId !== parsed.screenId,
            ),
          ],
        });
      }),
    recordVisualComparison: (comparison) =>
      enqueue(async () => {
        const current = await read();
        const parsed = VisualComparisonSchema.parse(comparison);
        return write({
          ...current,
          visualComparisons: [
            parsed,
            ...current.visualComparisons.filter(
              (item) => item.screenId !== parsed.screenId,
            ),
          ],
        });
      }),
    recordPreviewArtifact: (artifact) =>
      enqueue(async () => {
        const current = await read();
        const parsed = ComponentPreviewArtifactSchema.parse(artifact);
        return write({
          ...current,
          previewArtifacts: [
            parsed,
            ...current.previewArtifacts.filter((item) => item.id !== parsed.id),
          ],
        });
      }),
    recordPreviewArtifacts: (artifacts) =>
      enqueue(async () => {
        const current = await read();
        const parsed = artifacts.map((artifact) =>
          ComponentPreviewArtifactSchema.parse(artifact),
        );
        const ids = new Set(parsed.map((artifact) => artifact.id));
        return write({
          ...current,
          previewArtifacts: [
            ...parsed,
            ...current.previewArtifacts.filter(
              (artifact) => !ids.has(artifact.id),
            ),
          ],
        });
      }),
    replaceInteractionProbes: (routePaths, artifacts) =>
      enqueue(async () => {
        const current = await read();
        const scope = new Set(routePaths);
        const parsed = artifacts.map((artifact) =>
          InteractionProbeArtifactSchema.parse(artifact),
        );
        const outsideScope = parsed.find(
          (artifact) => !scope.has(artifact.routePath),
        );
        if (outsideScope) {
          throw new Error(
            `Interaction probe route ${outsideScope.routePath} is outside the replacement scope`,
          );
        }
        return write({
          ...current,
          interactionProbes: [
            ...parsed,
            ...current.interactionProbes.filter(
              (artifact) => !scope.has(artifact.routePath),
            ),
          ],
        });
      }),
    saveFindings: (findings) =>
      enqueue(async () => {
        const current = await read();
        return write({ ...current, findings });
      }),
    saveJob: (job) =>
      enqueue(async () => {
        const current = await read();
        return write({
          ...current,
          jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)],
        });
      }),
    compact: () =>
      enqueue(async () => {
        const parsed = await readParsed();
        return parsed.changed ? write(parsed.state) : parsed.state;
      }),
  };
}
