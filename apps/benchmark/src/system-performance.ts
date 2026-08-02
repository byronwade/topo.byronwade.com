import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { discoverNextRoutes } from "@topo/adapter-next";
import { sourceApiEndpointAdapter } from "@topo/adapter-api-source";
import { sourceFlowDiscoveryAdapter } from "@topo/adapter-flow-source";
import { discoverNuxtRoutes } from "@topo/adapter-nuxt";
import { openApiEndpointAdapter } from "@topo/adapter-openapi";
import { discoverReactRoutes } from "@topo/adapter-react";
import { discoverSvelteRoutes } from "@topo/adapter-svelte";
import { discoverTanStackRoutes } from "@topo/adapter-tanstack";
import { discoverVueRoutes } from "@topo/adapter-vue";
import { defineConfig } from "@topo/config";
import { createDaemon, type DaemonOptions } from "@topo/daemon";
import type { FrameworkAdapterContext } from "@topo/framework-adapter";
import { createApiEndpointAdapterRegistry } from "@topo/endpoint-adapter";
import { createFlowDiscoveryAdapterRegistry } from "@topo/flow-adapter";

export const SYSTEM_PERFORMANCE_REPORT_VERSION = 6 as const;

export type SystemPerformanceResultId =
  | "next-adapter-discovery"
  | "tanstack-adapter-discovery"
  | "react-adapter-discovery"
  | "vue-adapter-discovery"
  | "nuxt-adapter-discovery"
  | "svelte-adapter-discovery"
  | "source-api-discovery"
  | "openapi-discovery"
  | "source-flow-discovery"
  | "daemon-cold-start"
  | "daemon-graph-http"
  | "daemon-source-refresh"
  | "daemon-manual-rescan"
  | "cli-cold-help";

export interface SystemPerformanceResult {
  id: SystemPerformanceResultId;
  title: string;
  description: string;
  samplesMs: number[];
  budgetMs: number;
  workload: Record<string, number | string>;
  unit: "ms";
  status: "pass" | "fail";
  sampleCount: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface SystemPerformanceReport {
  version: typeof SYSTEM_PERFORMANCE_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  profile: {
    id: "system-standard";
    adapterRoutes: number;
    daemonRoutes: number;
  };
  runtime: {
    surface: "system";
    nodeVersion: string;
    platform: NodeJS.Platform;
    architecture: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryBytes: number;
  };
  settings: { hotIterations: number; coldIterations: number };
  summary: { passed: number; failed: number; total: number };
  results: SystemPerformanceResult[];
}

export interface RunSystemPerformanceOptions {
  hotIterations?: number;
  coldIterations?: number;
  adapterRoutes?: number;
  daemonRoutes?: number;
  cliEntryPath?: string;
}

const runDoctorFixture: NonNullable<DaemonOptions["runDoctor"]> = async ({
  project,
  graph,
}) => ({
  schemaVersion: 1,
  generatedAt: "2026-08-02T00:00:00.000Z",
  projectRoot: project.projectRoot,
  sourceRoot: project.sourceRoot,
  ok: true,
  summary: { total: 1, passed: 1, warnings: 0, errors: 0 },
  checks: [
    {
      id: "application.source-scan",
      scope: "application",
      title: "Source discovery",
      status: "pass",
      severity: "info",
      detail: `${graph.screens.length} screens normalized.`,
      evidence: { screens: graph.screens.length },
    },
  ],
});

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error("System benchmark counts must be positive integers");
  }
  return resolved;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

export function summarizeSystemPerformanceResult(input: {
  id: SystemPerformanceResultId;
  title: string;
  description: string;
  samplesMs: readonly number[];
  budgetMs: number;
  workload: Record<string, number | string>;
}): SystemPerformanceResult {
  if (input.samplesMs.length === 0) {
    throw new Error(`System benchmark "${input.id}" has no samples`);
  }
  const sorted = [...input.samplesMs].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    samplesMs: input.samplesMs.map(rounded),
    budgetMs: input.budgetMs,
    workload: input.workload,
    unit: "ms",
    status: p95 <= input.budgetMs ? "pass" : "fail",
    sampleCount: input.samplesMs.length,
    medianMs: rounded(median),
    p95Ms: rounded(p95),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

async function measure(
  iterations: number,
  operation: () => void | Promise<void>,
  warmups = 0,
): Promise<number[]> {
  for (let index = 0; index < warmups; index += 1) await operation();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await operation();
    samples.push(performance.now() - startedAt);
  }
  return samples;
}

async function measurePrepared(
  iterations: number,
  prepare: (index: number) => void | Promise<void>,
  operation: () => void | Promise<void>,
  warmups = 0,
): Promise<number[]> {
  for (let index = 0; index < warmups; index += 1) {
    await prepare(-index - 1);
    await operation();
  }
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    await prepare(index);
    const startedAt = performance.now();
    await operation();
    samples.push(performance.now() - startedAt);
  }
  return samples;
}

async function writeDaemonFixture(
  routeCount: number,
): Promise<{ rootDir: string; config: ReturnType<typeof defineConfig> }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "topo-system-"));
  await fs.writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({ dependencies: { next: "16.2.12" } })}\n`,
  );
  const files = Array.from({ length: routeCount }, (_, index) => ({
    directory: path.join(rootDir, "app", `route-${index}`),
    content: `export default function Route${index}(){return null}\n`,
  }));
  for (let offset = 0; offset < files.length; offset += 64) {
    await Promise.all(
      files.slice(offset, offset + 64).map(async (file) => {
        await fs.mkdir(file.directory, { recursive: true });
        await fs.writeFile(path.join(file.directory, "page.tsx"), file.content);
      }),
    );
  }
  return {
    rootDir,
    config: defineConfig({ preview: { autoCapture: false } }),
  };
}

async function runCliHelp(entryPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [entryPath, "--help"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Topo CLI help exited with code ${code}`));
    });
  });
}

export async function runSystemPerformance(
  options: RunSystemPerformanceOptions = {},
): Promise<SystemPerformanceReport> {
  const hotIterations = positiveInteger(options.hotIterations, 21);
  const coldIterations = positiveInteger(options.coldIterations, 5);
  const adapterRoutes = positiveInteger(options.adapterRoutes, 10_000);
  const daemonRoutes = positiveInteger(options.daemonRoutes, 1_000);
  const cliEntryPath = path.resolve(
    options.cliEntryPath ?? "packages/cli/dist/index.js",
  );
  await fs.access(cliEntryPath);

  const nextPaths = Array.from(
    { length: adapterRoutes },
    (_, index) => `app/area-${Math.floor(index / 100)}/route-${index}/page.tsx`,
  );
  const tanstackPaths = ["src/routeTree.gen.ts"];
  const tanstackTree = Array.from(
    { length: adapterRoutes },
    (_, index) => `const route${index} = { fullPath: '/route-${index}' };`,
  ).join("\n");
  const reactSource = Array.from(
    { length: adapterRoutes },
    (_, index) => `<Route path="/route-${index}" element={null} />`,
  ).join("\n");
  const vueSource = `const routes = [${Array.from(
    { length: adapterRoutes },
    (_, index) => `{ path: "/route-${index}", component: View }`,
  ).join(",")}]; createRouter({ routes });`;
  const reactContext: FrameworkAdapterContext = {
    rootDir: "/benchmark/react",
    files: [{ filePath: "src/routes.tsx", extension: ".tsx" }],
    packageNames: new Set(["react", "react-router-dom"]),
    readFile: async () => reactSource,
  };
  const vueContext: FrameworkAdapterContext = {
    rootDir: "/benchmark/vue",
    files: [{ filePath: "src/router.ts", extension: ".ts" }],
    packageNames: new Set(["vue", "vue-router"]),
    readFile: async () => vueSource,
  };
  const nuxtPaths = Array.from(
    { length: adapterRoutes },
    (_, index) =>
      `app/pages/area-${Math.floor(index / 100)}/route-${index}.vue`,
  );
  const sveltePaths = Array.from(
    { length: adapterRoutes },
    (_, index) =>
      `src/routes/area-${Math.floor(index / 100)}/route-${index}/+page.svelte`,
  );
  const sourceApiText = Array.from(
    { length: adapterRoutes },
    (_, index) => `app.get('/api/route-${index}', handler${index});`,
  ).join("\n");
  const sourceFlowText = Array.from(
    { length: adapterRoutes },
    (_, index) => `<Link href="/route-${index}" />`,
  ).join("\n");
  const openApiText = JSON.stringify({
    openapi: "3.1.0",
    paths: Object.fromEntries(
      Array.from({ length: adapterRoutes }, (_, index) => [
        `/api/route-${index}`,
        {
          get: {
            operationId: `getRoute${index}`,
            responses: { "200": { description: "OK" } },
          },
        },
      ]),
    ),
  });
  const sourceApiRegistry = createApiEndpointAdapterRegistry([
    sourceApiEndpointAdapter,
  ]);
  const openApiRegistry = createApiEndpointAdapterRegistry([
    openApiEndpointAdapter,
  ]);
  const sourceFlowRegistry = createFlowDiscoveryAdapterRegistry([
    sourceFlowDiscoveryAdapter,
  ]);
  const sourceApiContext = {
    rootDir: "/benchmark/source-api",
    files: [{ filePath: "src/api.ts", extension: ".ts" }],
    packageNames: new Set(["express"]),
    readFile: async () => sourceApiText,
  };
  const openApiContext = {
    rootDir: "/benchmark/openapi",
    files: [{ filePath: "openapi.json", extension: ".json" }],
    packageNames: new Set<string>(),
    readFile: async () => openApiText,
  };
  const sourceFlowContext = {
    rootDir: "/benchmark/source-flow",
    files: [{ filePath: "src/routes.tsx", extension: ".tsx" }],
    packageNames: new Set(["react-router-dom"]),
    screens: [
      {
        screenId: "screen:home",
        routePath: "/",
        sourceFilePaths: ["src/routes.tsx"],
      },
    ],
    readFile: async () => sourceFlowText,
  };
  const fixture = await writeDaemonFixture(daemonRoutes);

  try {
    const nextSamples = await measure(
      hotIterations,
      () => {
        if (discoverNextRoutes(nextPaths).length !== adapterRoutes) {
          throw new Error("Next adapter benchmark lost routes");
        }
      },
      2,
    );
    const tanstackSamples = await measure(
      hotIterations,
      () => {
        if (
          discoverTanStackRoutes(tanstackPaths, tanstackTree).length !==
          adapterRoutes
        ) {
          throw new Error("TanStack adapter benchmark lost routes");
        }
      },
      2,
    );
    const reactSamples = await measure(
      hotIterations,
      async () => {
        if (
          (await discoverReactRoutes(reactContext)).length !== adapterRoutes
        ) {
          throw new Error("React adapter benchmark lost routes");
        }
      },
      2,
    );
    const vueSamples = await measure(
      hotIterations,
      async () => {
        if ((await discoverVueRoutes(vueContext)).length !== adapterRoutes) {
          throw new Error("Vue adapter benchmark lost routes");
        }
      },
      2,
    );
    const nuxtSamples = await measure(
      hotIterations,
      () => {
        if (discoverNuxtRoutes(nuxtPaths).length !== adapterRoutes) {
          throw new Error("Nuxt adapter benchmark lost routes");
        }
      },
      2,
    );
    const svelteSamples = await measure(
      hotIterations,
      () => {
        if (discoverSvelteRoutes(sveltePaths).length !== adapterRoutes) {
          throw new Error("Svelte adapter benchmark lost routes");
        }
      },
      2,
    );
    const sourceApiSamples = await measure(
      hotIterations,
      async () => {
        const scan = await sourceApiRegistry.scan(sourceApiContext);
        if (scan.endpoints.length !== adapterRoutes) {
          throw new Error("Source API adapter benchmark lost endpoints");
        }
      },
      2,
    );
    const openApiSamples = await measure(
      hotIterations,
      async () => {
        const scan = await openApiRegistry.scan(openApiContext);
        if (scan.endpoints.length !== adapterRoutes) {
          throw new Error("OpenAPI adapter benchmark lost endpoints");
        }
      },
      2,
    );
    const sourceFlowSamples = await measure(
      hotIterations,
      async () => {
        const scan = await sourceFlowRegistry.scan(sourceFlowContext);
        if (scan.transitions.length !== adapterRoutes) {
          throw new Error("Source flow adapter benchmark lost transitions");
        }
      },
      2,
    );
    const daemonOptions: DaemonOptions = {
      projectRoot: fixture.rootDir,
      config: fixture.config,
      host: "127.0.0.1",
      port: 0,
      watch: false,
      runDoctor: runDoctorFixture,
      ...(process.env.TOPO_BENCHMARK_PHASES === "1"
        ? {
            onPerformanceMeasure: (measure) => {
              process.stderr.write(`${JSON.stringify(measure)}\n`);
            },
          }
        : {}),
    };
    const daemonStartSamples = await measure(coldIterations, async () => {
      const daemon = await createDaemon(daemonOptions);
      await daemon.listen();
      try {
        if ((await daemon.getGraph()).screens.length !== daemonRoutes) {
          throw new Error("Daemon startup benchmark lost routes");
        }
      } finally {
        await daemon.close();
      }
    });

    const daemon = await createDaemon(daemonOptions);
    await daemon.listen();
    let graphHttpSamples: number[];
    let sourceRefreshSamples: number[];
    let manualRescanSamples: number[];
    try {
      const daemonUrl = `http://${daemon.host}:${daemon.port}`;
      graphHttpSamples = await measure(
        hotIterations,
        async () => {
          const response = await fetch(`${daemonUrl}/graph`);
          if (!response.ok) throw new Error("Daemon graph request failed");
          const graph = (await response.json()) as { screens?: unknown[] };
          if (graph.screens?.length !== daemonRoutes) {
            throw new Error("Daemon graph response lost routes");
          }
        },
        2,
      );
      const changedRouteDirectory = path.join(
        fixture.rootDir,
        "app",
        "performance-toggle",
      );
      const changedRoutePath = path.join(changedRouteDirectory, "page.tsx");
      let toggleRoutePresent = false;
      sourceRefreshSamples = await measurePrepared(
        hotIterations,
        async () => {
          if (toggleRoutePresent) {
            await fs.rm(changedRouteDirectory, {
              recursive: true,
              force: true,
            });
          } else {
            await fs.mkdir(changedRouteDirectory, { recursive: true });
            await fs.writeFile(
              changedRoutePath,
              "export default function PerformanceToggle(){return null}\n",
            );
          }
          toggleRoutePresent = !toggleRoutePresent;
        },
        async () => {
          const graph = await daemon.refreshChanged([
            "app/performance-toggle/page.tsx",
          ]);
          const expectedRoutes = daemonRoutes + (toggleRoutePresent ? 1 : 0);
          if (graph.screens.length !== expectedRoutes) {
            throw new Error("Daemon source refresh lost routes");
          }
        },
        2,
      );
      manualRescanSamples = await measure(coldIterations, async () => {
        const graph = await daemon.refresh();
        const expectedRoutes = daemonRoutes + (toggleRoutePresent ? 1 : 0);
        if (graph.screens.length !== expectedRoutes) {
          throw new Error("Daemon manual rescan lost routes");
        }
      });
    } finally {
      await daemon.close();
    }

    const cliSamples = await measure(
      coldIterations,
      () => runCliHelp(cliEntryPath),
      1,
    );
    const results = [
      summarizeSystemPerformanceResult({
        id: "next-adapter-discovery",
        title: "Next.js adapter discovery",
        description:
          "Normalize App Router route files through the real Next adapter.",
        samplesMs: nextSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", routes: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "tanstack-adapter-discovery",
        title: "TanStack adapter discovery",
        description:
          "Normalize generated route-tree paths through the real TanStack adapter.",
        samplesMs: tanstackSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", routes: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "react-adapter-discovery",
        title: "React adapter discovery",
        description:
          "Normalize static React Router declarations through the real React adapter.",
        samplesMs: reactSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", routes: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "vue-adapter-discovery",
        title: "Vue adapter discovery",
        description:
          "Normalize static Vue Router declarations through the real Vue adapter.",
        samplesMs: vueSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", routes: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "nuxt-adapter-discovery",
        title: "Nuxt adapter discovery",
        description: "Normalize Nuxt pages through the real Nuxt adapter.",
        samplesMs: nuxtSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", routes: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "svelte-adapter-discovery",
        title: "Svelte adapter discovery",
        description:
          "Normalize SvelteKit pages through the real Svelte adapter.",
        samplesMs: svelteSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", routes: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "source-api-discovery",
        title: "Source API endpoint discovery",
        description:
          "Normalize literal router registrations through the real source API adapter.",
        samplesMs: sourceApiSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", endpoints: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "openapi-discovery",
        title: "OpenAPI endpoint discovery",
        description:
          "Parse and normalize OpenAPI operations through the real contract adapter.",
        samplesMs: openApiSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", endpoints: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "source-flow-discovery",
        title: "Source flow transition discovery",
        description:
          "Extract, source-locate, deduplicate, sort, and contract-check literal navigation transitions through the real source flow adapter.",
        samplesMs: sourceFlowSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", transitions: adapterRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "daemon-cold-start",
        title: "Daemon cold startup",
        description:
          "Create, scan, persist, export agent context, and listen with a real local daemon.",
        samplesMs: daemonStartSamples,
        budgetMs: 2_000,
        workload: { latencyClass: "cold", routes: daemonRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "daemon-graph-http",
        title: "Daemon graph HTTP",
        description:
          "Fetch and parse the complete normalized graph from an already-running loopback daemon.",
        samplesMs: graphHttpSamples,
        budgetMs: 50,
        workload: { latencyClass: "hot", routes: daemonRoutes },
      }),
      summarizeSystemPerformanceResult({
        id: "daemon-source-refresh",
        title: "Daemon changed-source refresh",
        description:
          "Add or remove one watcher-reported route through the persistent scanner, diagnostics, durable graph, and agent-context pipeline.",
        samplesMs: sourceRefreshSamples,
        budgetMs: 50,
        workload: {
          latencyClass: "hot",
          routes: daemonRoutes,
          changedFiles: 1,
        },
      }),
      summarizeSystemPerformanceResult({
        id: "daemon-manual-rescan",
        title: "Daemon manual workspace rescan",
        description:
          "Conservatively rediscover and reconcile the complete workspace source tree on explicit request.",
        samplesMs: manualRescanSamples,
        budgetMs: 2_000,
        workload: {
          latencyClass: "cold",
          routes: daemonRoutes,
          changedFiles: "complete-discovery",
        },
      }),
      summarizeSystemPerformanceResult({
        id: "cli-cold-help",
        title: "CLI cold help",
        description:
          "Start a new Node process, evaluate the packaged Topo CLI, render help, and exit.",
        samplesMs: cliSamples,
        budgetMs: 1_000,
        workload: {
          latencyClass: "cold",
          command: "topo --help",
        },
      }),
    ];
    const failed = results.filter((result) => result.status === "fail").length;
    const cpus = os.cpus();
    return {
      version: SYSTEM_PERFORMANCE_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      status: failed === 0 ? "pass" : "fail",
      profile: { id: "system-standard", adapterRoutes, daemonRoutes },
      runtime: {
        surface: "system",
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpuModel: cpus[0]?.model ?? "unknown",
        cpuCount: cpus.length,
        totalMemoryBytes: os.totalmem(),
      },
      settings: { hotIterations, coldIterations },
      summary: {
        passed: results.length - failed,
        failed,
        total: results.length,
      },
      results,
    };
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
}
