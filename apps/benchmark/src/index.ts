import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  fitCanvasBounds,
  panCanvasBy,
  zoomCanvasAt,
  type CanvasCamera,
} from "@topo/canvas-engine";
import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
} from "@topo/framework-adapter";
import { reconcileGraph } from "@topo/graph";
import { createAtlasScene } from "@topo/layout";
import {
  buildLlmContextFromValidatedGraph,
  LlmContextManifestSchema,
  LlmContextRecordSchema,
} from "@topo/llm-context";
import {
  createScannerSession,
  scanWorkspace,
  type ScannerSession,
} from "@topo/scanner";
import {
  ApplicationGraphSchema,
  type ApplicationGraph,
  type Flow,
} from "@topo/schema";

export const BENCHMARK_REPORT_VERSION = 2 as const;

export interface BenchmarkProfile {
  id: string;
  routeCount: number;
  componentCount: number;
  flowCount: number;
  cameraOperations: number;
}

export const BENCHMARK_PROFILES = {
  smoke: {
    id: "smoke",
    routeCount: 100,
    componentCount: 25,
    flowCount: 10,
    cameraOperations: 10_000,
  },
  standard: {
    id: "standard",
    routeCount: 1_000,
    componentCount: 250,
    flowCount: 50,
    cameraOperations: 100_000,
  },
  stress: {
    id: "stress",
    routeCount: 5_000,
    componentCount: 1_000,
    flowCount: 250,
    cameraOperations: 500_000,
  },
} as const satisfies Record<string, BenchmarkProfile>;

export type BenchmarkProfileName = keyof typeof BENCHMARK_PROFILES;

export interface BenchmarkBudgets {
  scanWorkspace: number;
  refreshWorkspace: number;
  reconcileGraph: number;
  buildLlmContext: number;
  createAtlasScene: number;
  cameraInteractions: number;
}

export type BenchmarkResultId =
  | "scan-workspace"
  | "refresh-workspace"
  | "reconcile-graph"
  | "build-llm-context"
  | "create-atlas-scene"
  | "camera-interactions";

export interface BenchmarkResult {
  id: BenchmarkResultId;
  title: string;
  description: string;
  unit: "ms";
  status: "pass" | "fail";
  budgetMs: number;
  sampleCount: number;
  samplesMs: number[];
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  workload: Record<string, number | string>;
}

export interface BenchmarkReport {
  version: typeof BENCHMARK_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  profile: BenchmarkProfile;
  runtime: {
    nodeVersion: string;
    platform: NodeJS.Platform;
    architecture: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryBytes: number;
  };
  settings: {
    iterations: number;
    warmupIterations: number;
  };
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  results: BenchmarkResult[];
}

export interface RunTopoBenchmarksOptions {
  profile?: BenchmarkProfile | BenchmarkProfileName;
  iterations?: number;
  warmupIterations?: number;
  budgets?: Partial<BenchmarkBudgets>;
}

interface Measurement<T> {
  samplesMs: number[];
  lastValue: T;
}

const DEFAULT_ITERATIONS = 21;
const DEFAULT_WARMUP_ITERATIONS = 2;
const STANDARD_BUDGETS: BenchmarkBudgets = {
  scanWorkspace: 500,
  refreshWorkspace: 50,
  reconcileGraph: 100,
  buildLlmContext: 500,
  createAtlasScene: 100,
  cameraInteractions: 50,
};
const FIXED_TIMESTAMP = "2026-08-01T00:00:00.000Z";

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function resolveProfile(
  profile: RunTopoBenchmarksOptions["profile"],
): BenchmarkProfile {
  const resolved =
    typeof profile === "string"
      ? BENCHMARK_PROFILES[profile]
      : (profile ?? BENCHMARK_PROFILES.standard);
  if (!resolved) throw new Error(`Unknown benchmark profile "${profile}"`);
  requirePositiveInteger(resolved.routeCount, "profile.routeCount");
  requireNonNegativeInteger(resolved.componentCount, "profile.componentCount");
  requireNonNegativeInteger(resolved.flowCount, "profile.flowCount");
  requirePositiveInteger(resolved.cameraOperations, "profile.cameraOperations");
  return { ...resolved };
}

function resolveBudgets(
  profile: BenchmarkProfile,
  overrides: Partial<BenchmarkBudgets> | undefined,
): BenchmarkBudgets {
  const routeScale = Math.max(0.25, profile.routeCount / 1_000);
  const cameraScale = Math.max(0.25, profile.cameraOperations / 100_000);
  const scaled: BenchmarkBudgets = {
    scanWorkspace: STANDARD_BUDGETS.scanWorkspace * routeScale,
    refreshWorkspace: STANDARD_BUDGETS.refreshWorkspace * routeScale,
    reconcileGraph: STANDARD_BUDGETS.reconcileGraph * routeScale,
    buildLlmContext: STANDARD_BUDGETS.buildLlmContext * routeScale,
    createAtlasScene: STANDARD_BUDGETS.createAtlasScene * routeScale,
    cameraInteractions: STANDARD_BUDGETS.cameraInteractions * cameraScale,
  };
  const budgets = { ...scaled, ...overrides };
  for (const [name, budget] of Object.entries(budgets)) {
    if (!Number.isFinite(budget) || budget < 0) {
      throw new Error(`Benchmark budget ${name} must be a non-negative number`);
    }
  }
  return budgets;
}

export function createBenchmarkGraph(
  profile: BenchmarkProfile,
): ApplicationGraph {
  const screens: ApplicationGraph["screens"] = Array.from(
    { length: profile.routeCount },
    (_, index) => {
      const routePath =
        index === 0
          ? "/"
          : `/area-${Math.floor((index - 1) / 25) + 1}/route-${index}`;
      return {
        id: `benchmark:screen:${index}`,
        kind: "screen",
        title: index === 0 ? "Home" : `Route ${index}`,
        routePath,
        framework: "benchmark-router",
        state: "default",
        group: index === 0 ? "/" : routePath.split("/", 2).join("/"),
        source: {
          filePath:
            index === 0
              ? "src/routes/index.tsx"
              : `src/routes/route-${index}.tsx`,
          line: 1,
        },
        renderStatus: "unseen",
        tags: index === 0 ? ["entry"] : [],
      };
    },
  );
  const components: ApplicationGraph["components"] = Array.from(
    { length: profile.componentCount },
    (_, index) => ({
      id: `benchmark:component:${index}`,
      kind: "component",
      name: `Component${index}`,
      source: { filePath: `src/components/Component${index}.tsx`, line: 1 },
      previewStatus: index % 3 === 0 ? "renderable" : "missing",
      previewSources:
        index % 3 === 0
          ? [
              {
                id: `benchmark.preview:component-${index}#Default`,
                title: "Default",
                adapterId: "benchmark.preview",
                source: {
                  filePath: `src/components/Component${index}.topo.tsx`,
                  line: 1,
                },
                exportName: "Default",
                locator: `src/components/Component${index}.topo.tsx#Default`,
              },
            ]
          : [],
      usedBy: screens
        .slice(index % Math.max(1, screens.length), index + 4)
        .map((screen) => screen.id),
    }),
  );
  const edges: ApplicationGraph["edges"] = screens
    .slice(1)
    .map((screen, index) => ({
      id: `benchmark:edge:${index}`,
      source: screens[index]?.id ?? screens[0]?.id ?? "benchmark:screen:0",
      target: screen.id,
      kind: "navigation",
      confidence: 1,
    }));
  const findings: ApplicationGraph["findings"] = Array.from(
    { length: Math.floor(profile.routeCount / 20) },
    (_, index) => ({
      id: `benchmark:finding:${index}`,
      severity: index % 5 === 0 ? "medium" : "low",
      status: "open",
      title: `Benchmark finding ${index}`,
      description: "Deterministic finding used to exercise context projection.",
      source: screens[index % screens.length]?.source,
      evidence: ["Synthetic benchmark evidence"],
      confidence: 0.8,
    }),
  );
  return {
    version: 1,
    generatedAt: FIXED_TIMESTAMP,
    rootDir: "/topo/benchmark",
    previewBaseUrl: "http://127.0.0.1:3000",
    framework: "benchmark-router",
    projectRecognition: {
      version: 1,
      status: "recognized",
      frameworks: [],
      capabilities: [],
      sourceFileCount: profile.routeCount + profile.componentCount,
    },
    flowTransitions: [],
    inferredFlows: [],
    screens,
    components,
    apiEndpoints: [],
    edges,
    findings,
    sourceIssues: [],
  };
}

export function createBenchmarkFlows(
  profile: BenchmarkProfile,
  graph: ApplicationGraph,
): Flow[] {
  return Array.from({ length: profile.flowCount }, (_, flowIndex) => {
    const steps = Array.from({ length: 4 }, (_, stepIndex) => {
      const screen =
        graph.screens[(flowIndex * 4 + stepIndex) % graph.screens.length];
      const id = `step-${stepIndex + 1}`;
      return {
        id,
        title: `Step ${stepIndex + 1}`,
        routePath: screen?.routePath,
        screenId: screen?.id,
        action: `Perform deterministic action ${stepIndex + 1}`,
        expected: `Observe deterministic result ${stepIndex + 1}`,
        noteIds: [],
        nextStepIds: stepIndex < 3 ? [`step-${stepIndex + 2}`] : [],
      };
    });
    return {
      version: 1,
      id: `benchmark-flow-${flowIndex}`,
      title: `Benchmark flow ${flowIndex}`,
      description: "Synthetic directed flow for projection measurement.",
      status: "verified",
      entryStepId: "step-1",
      tags: ["benchmark"],
      steps,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    };
  });
}

async function writeFilesInBatches(
  files: ReadonlyArray<{ filePath: string; content: string }>,
): Promise<void> {
  const batchSize = 64;
  for (let index = 0; index < files.length; index += batchSize) {
    await Promise.all(
      files
        .slice(index, index + batchSize)
        .map((file) => fs.writeFile(file.filePath, file.content, "utf8")),
    );
  }
}

async function createScannerFixture(routeCount: number): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "topo-benchmark-"));
  const routesDir = path.join(rootDir, "src", "routes");
  await fs.mkdir(routesDir, { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({ dependencies: { "benchmark-router": "1.0.0" } })}\n`,
    "utf8",
  );
  await writeFilesInBatches(
    Array.from({ length: routeCount }, (_, index) => ({
      filePath: path.join(
        routesDir,
        index === 0 ? "index.tsx" : `route-${index}.tsx`,
      ),
      content: `export default function Route${index}() { return null }\n`,
    })),
  );
  return rootDir;
}

const benchmarkFrameworkAdapter = defineFrameworkAdapter({
  apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
  id: "benchmark.router",
  displayName: "Benchmark Router",
  detect(context) {
    return context.packageNames.has("benchmark-router")
      ? [
          {
            framework: "benchmark-router",
            confidence: 1,
            reasons: ["deterministic benchmark fixture"],
          },
        ]
      : [];
  },
  scan(context) {
    return {
      routes: context.files
        .filter((file) => file.filePath.startsWith("src/routes/"))
        .map((file) => {
          const match = /route-(\d+)\.tsx$/.exec(file.filePath);
          return {
            framework: "benchmark-router",
            filePath: file.filePath,
            routePath: match ? `/route-${match[1]}` : "/",
            state: "default",
          };
        }),
    };
  },
});

async function measure<T>(
  operation: () => T | Promise<T>,
  iterations: number,
  warmupIterations: number,
): Promise<Measurement<T>> {
  let lastValue: T | undefined;
  for (let index = 0; index < warmupIterations; index += 1) {
    lastValue = await operation();
  }
  const samplesMs: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    lastValue = await operation();
    samplesMs.push(performance.now() - startedAt);
  }
  if (lastValue === undefined) {
    throw new Error("Benchmark workload did not produce a value");
  }
  return { samplesMs, lastValue };
}

async function measureChangedWorkspace(
  session: ScannerSession,
  fixtureRoot: string,
  routeCount: number,
  iterations: number,
  warmupIterations: number,
): Promise<Measurement<ApplicationGraph>> {
  const routeIndex = Math.max(0, Math.floor(routeCount / 2));
  const relativePath = path.posix.join(
    "src",
    "routes",
    routeIndex === 0 ? "index.tsx" : `route-${routeIndex}.tsx`,
  );
  const absolutePath = path.join(fixtureRoot, ...relativePath.split("/"));
  let lastValue: ApplicationGraph | undefined;
  const samplesMs: number[] = [];
  const totalIterations = warmupIterations + iterations;

  for (let index = 0; index < totalIterations; index += 1) {
    await fs.writeFile(
      absolutePath,
      `export default function Route${routeIndex}() { return ${index} }\n`,
      "utf8",
    );
    const startedAt = performance.now();
    lastValue = await session.scan([relativePath]);
    if (index >= warmupIterations) {
      samplesMs.push(performance.now() - startedAt);
    }
  }
  if (!lastValue) throw new Error("Refresh benchmark produced no graph");
  return { samplesMs, lastValue };
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(
  sortedSamples: readonly number[],
  percentileValue: number,
): number {
  const index = Math.max(
    0,
    Math.min(
      sortedSamples.length - 1,
      Math.ceil(sortedSamples.length * percentileValue) - 1,
    ),
  );
  return sortedSamples[index] ?? 0;
}

function result(
  definition: Pick<
    BenchmarkResult,
    "id" | "title" | "description" | "workload"
  >,
  samples: readonly number[],
  budgetMs: number,
): BenchmarkResult {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const p95 = percentile(sorted, 0.95);
  return {
    ...definition,
    unit: "ms",
    status: p95 <= budgetMs ? "pass" : "fail",
    budgetMs: rounded(budgetMs),
    sampleCount: samples.length,
    samplesMs: samples.map(rounded),
    medianMs: rounded(median),
    p95Ms: rounded(p95),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

function exerciseCamera(operations: number): CanvasCamera {
  let camera = fitCanvasBounds(
    { x: -2_000, y: -1_000, width: 12_000, height: 8_000 },
    { width: 1_440, height: 900 },
    { padding: 48 },
  );
  for (let index = 0; index < operations; index += 1) {
    camera =
      index % 3 === 0
        ? zoomCanvasAt(camera, 0.25 + ((index % 300) / 300) * 2.75, {
            x: index % 1_440,
            y: index % 900,
          })
        : panCanvasBy(camera, {
            x: (index % 7) - 3,
            y: (index % 5) - 2,
          });
  }
  if (![camera.x, camera.y, camera.zoom].every(Number.isFinite)) {
    throw new Error("Camera benchmark produced a non-finite transform");
  }
  return camera;
}

export async function runTopoBenchmarks(
  options: RunTopoBenchmarksOptions = {},
): Promise<BenchmarkReport> {
  const profile = resolveProfile(options.profile);
  const iterations = requirePositiveInteger(
    options.iterations ?? DEFAULT_ITERATIONS,
    "iterations",
  );
  const warmupIterations = requireNonNegativeInteger(
    options.warmupIterations ?? DEFAULT_WARMUP_ITERATIONS,
    "warmupIterations",
  );
  const budgets = resolveBudgets(profile, options.budgets);
  const graph = createBenchmarkGraph(profile);
  const previousGraph: ApplicationGraph = {
    ...graph,
    screens: graph.screens.map((screen, index) => ({
      ...screen,
      renderStatus: index % 4 === 0 ? "captured" : "unseen",
    })),
  };
  const flows = createBenchmarkFlows(profile, graph);
  const results: BenchmarkResult[] = [];
  const fixtureRoot = await createScannerFixture(profile.routeCount);

  try {
    const scan = await measure(
      () =>
        scanWorkspace(fixtureRoot, {
          adapters: [benchmarkFrameworkAdapter],
        }),
      iterations,
      warmupIterations,
    );
    if (scan.lastValue.screens.length !== profile.routeCount) {
      throw new Error(
        `Scanner benchmark expected ${profile.routeCount} routes and received ${scan.lastValue.screens.length}`,
      );
    }
    results.push(
      result(
        {
          id: "scan-workspace",
          title: "Workspace scan",
          description:
            "Walk source files, parse compiler-grade module metadata with Oxc, execute a framework adapter, and normalize routes and coverage into the application graph.",
          workload: {
            routes: profile.routeCount,
            sourceFiles: profile.routeCount,
          },
        },
        scan.samplesMs,
        budgets.scanWorkspace,
      ),
    );

    const scannerSession = createScannerSession(fixtureRoot, {
      adapters: [benchmarkFrameworkAdapter],
    });
    await scannerSession.scan();
    const refresh = await measureChangedWorkspace(
      scannerSession,
      fixtureRoot,
      profile.routeCount,
      iterations,
      warmupIterations,
    );
    if (refresh.lastValue.screens.length !== profile.routeCount) {
      throw new Error(
        `Scanner refresh benchmark expected ${profile.routeCount} routes and received ${refresh.lastValue.screens.length}`,
      );
    }
    results.push(
      result(
        {
          id: "refresh-workspace",
          title: "Incremental workspace refresh",
          description:
            "Update one reported source entry in a persistent scanner session, reuse unchanged source and loaded adapters, and rebuild the complete normalized graph.",
          workload: {
            routes: profile.routeCount,
            sourceFiles: profile.routeCount,
            changedFiles: 1,
          },
        },
        refresh.samplesMs,
        budgets.refreshWorkspace,
      ),
    );

    const reconciliation = await measure(
      () => reconcileGraph(previousGraph, graph),
      iterations,
      warmupIterations,
    );
    results.push(
      result(
        {
          id: "reconcile-graph",
          title: "Graph reconciliation",
          description:
            "Validate a complete graph and preserve durable screen render state from the previous graph.",
          workload: {
            screens: reconciliation.lastValue.screens.length,
            components: reconciliation.lastValue.components.length,
            edges: reconciliation.lastValue.edges.length,
            findings: reconciliation.lastValue.findings.length,
          },
        },
        reconciliation.samplesMs,
        budgets.reconcileGraph,
      ),
    );

    // Keep the validation clone local to this workload. Retaining it while the
    // scanner and graph workloads run changes their heap pressure and makes an
    // unrelated LLM optimization look like a cross-product regression.
    const validatedContextGraph = ApplicationGraphSchema.parse(graph);
    const context = await measure(
      () =>
        buildLlmContextFromValidatedGraph({
          graph: validatedContextGraph,
          flows,
          project: {
            name: "Topo benchmark",
            profileNames: ["Anonymous", "Owner", "Administrator"],
          },
          generatedAt: FIXED_TIMESTAMP,
        }),
      iterations,
      warmupIterations,
    );
    LlmContextManifestSchema.parse(context.lastValue.manifest);
    for (const item of context.lastValue.records) {
      LlmContextRecordSchema.parse(item);
    }
    results.push(
      result(
        {
          id: "build-llm-context",
          title: "LLM context projection",
          description:
            "Project one already boundary-validated graph into canonical route, screen, component, finding, profile, flow, and flow-step records; verify the resulting manifest and every record against the exported runtime schemas outside the timed interval.",
          workload: {
            routes: profile.routeCount,
            components: profile.componentCount,
            flows: profile.flowCount,
            records: context.lastValue.records.length,
            schemaValidation: "outside-timing",
          },
        },
        context.samplesMs,
        budgets.buildLlmContext,
      ),
    );

    const atlas = await measure(
      () => createAtlasScene(graph, graph.screens[0]?.id),
      iterations,
      warmupIterations,
    );
    results.push(
      result(
        {
          id: "create-atlas-scene",
          title: "Atlas scene layout",
          description:
            "Create the renderer-neutral, selection-relative route scene consumed by PixiJS and LLM clients.",
          workload: {
            screens: atlas.lastValue.layout.screens.length,
            groups: atlas.lastValue.layout.groups.length,
            connections: atlas.lastValue.connections.length,
          },
        },
        atlas.samplesMs,
        budgets.createAtlasScene,
      ),
    );

    const camera = await measure(
      () => exerciseCamera(profile.cameraOperations),
      iterations,
      warmupIterations,
    );
    results.push(
      result(
        {
          id: "camera-interactions",
          title: "Canvas camera interactions",
          description:
            "Apply anchored zoom and pan transforms through the shared renderer-independent camera contract.",
          workload: {
            operations: profile.cameraOperations,
            finalZoom: rounded(camera.lastValue.zoom),
          },
        },
        camera.samplesMs,
        budgets.cameraInteractions,
      ),
    );
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }

  const failed = results.filter((item) => item.status === "fail").length;
  const cpus = os.cpus();
  return {
    version: BENCHMARK_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    status: failed === 0 ? "pass" : "fail",
    profile,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuModel: cpus[0]?.model ?? "unknown",
      cpuCount: cpus.length,
      totalMemoryBytes: os.totalmem(),
    },
    settings: { iterations, warmupIterations },
    summary: {
      passed: results.length - failed,
      failed,
      total: results.length,
    },
    results,
  };
}
