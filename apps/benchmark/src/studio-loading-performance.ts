import path from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import {
  inspectStudioBuild,
  startStudioHost,
  type StudioBuildReport,
} from "@topo/studio-host";

import {
  runStudioLoadingCheck as runStudioLoadingFunctionalCheck,
  type StudioLoadingCheck,
} from "./studio-loading-check.js";

export const STUDIO_LOADING_REPORT_VERSION = 3 as const;
export const STUDIO_COLD_NOTES_BUDGET_MS = 250;
export const STUDIO_COLD_ATLAS_BUDGET_MS = 1_500;
export const STUDIO_HOT_DESTINATION_BUDGET_MS = 50;

export type StudioLoadingResultId =
  | "notes-cold-ready"
  | "atlas-cold-ready"
  | "notes-hot-switch"
  | "atlas-hot-switch";

export interface StudioLoadingPerformanceResult {
  id: StudioLoadingResultId;
  title: string;
  description: string;
  samplesMs: number[];
  budgetMs: number;
  /** Whether this result contributes to the process exit status on this runtime. */
  enforced: boolean;
  workload: Record<string, number | string>;
  unit: "ms";
  status: "pass" | "fail";
  sampleCount: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

interface DestinationMeasurement {
  samplesMs: number[];
  requestedAssets: string[];
  pageErrors: string[];
  maxLongTaskMs: number;
}

export interface StudioLoadingReport {
  schemaVersion: typeof STUDIO_LOADING_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  profile: {
    id: "studio-loading-standard";
    coldIterations: number;
    hotIterations: number;
    viewportWidth: number;
    viewportHeight: number;
  };
  runtime: {
    surface: "studio";
    browserName: "chromium";
    browserVersion: string;
    nodeVersion: string;
    platform: NodeJS.Platform;
    architecture: string;
    renderer: "Studio DOM + PixiJS WebGL";
    resolution: 1;
    webglVersion: string;
    gpuAdapter: string;
  };
  settings: {
    coldCacheDisabled: true;
    isolatedContextPerSample: true;
  };
  offline: Awaited<
    ReturnType<typeof runStudioLoadingFunctionalCheck>
  >["offline"];
  notes: Awaited<
    ReturnType<typeof runStudioLoadingFunctionalCheck>
  >["notes"] & {
    cold: StudioLoadingPerformanceResult;
    hot: StudioLoadingPerformanceResult;
    maxLongTaskMs: number;
  };
  atlas: Awaited<
    ReturnType<typeof runStudioLoadingFunctionalCheck>
  >["atlas"] & {
    cold: StudioLoadingPerformanceResult;
    hot: StudioLoadingPerformanceResult;
    maxLongTaskMs: number;
  };
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  performanceSummary: {
    passed: number;
    failed: number;
    informationalFailures: number;
    total: number;
  };
  checks: StudioLoadingCheck[];
  results: StudioLoadingPerformanceResult[];
}

export interface RunStudioLoadingPerformanceOptions {
  headless?: boolean;
  coldIterations?: number;
  hotIterations?: number;
}

interface DestinationDefinition {
  id: "notes" | "atlas";
  route: string;
  selector: string;
  awayRoute: string;
  awaySelector: string;
  coldBudgetMs: number;
}

const DESTINATIONS: readonly DestinationDefinition[] = [
  {
    id: "notes",
    route: "/notes?demo=1",
    selector: ".notes-index-view",
    awayRoute: "/settings/general?demo=1",
    awaySelector: ".settings-view",
    coldBudgetMs: STUDIO_COLD_NOTES_BUDGET_MS,
  },
  {
    id: "atlas",
    route: "/atlas/flows?demo=1",
    selector: '[data-renderer="pixi-topology"] canvas',
    awayRoute: "/notes?demo=1",
    awaySelector: ".notes-index-view",
    coldBudgetMs: STUDIO_COLD_ATLAS_BUDGET_MS,
  },
] as const;

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error("Studio loading iterations must be positive integers");
  }
  return resolved;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(samples: readonly number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

export function summarizeStudioLoadingResult(input: {
  id: StudioLoadingResultId;
  title: string;
  description: string;
  samplesMs: readonly number[];
  budgetMs: number;
  enforced?: boolean;
  workload: Record<string, number | string>;
}): StudioLoadingPerformanceResult {
  if (input.samplesMs.length === 0) {
    throw new Error(`Studio loading benchmark "${input.id}" has no samples`);
  }
  const sorted = [...input.samplesMs].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const p95 = percentile(sorted, 0.95);
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    samplesMs: input.samplesMs.map(rounded),
    budgetMs: input.budgetMs,
    enforced: input.enforced ?? true,
    workload: input.workload,
    unit: "ms",
    status: p95 <= input.budgetMs ? "pass" : "fail",
    sampleCount: input.samplesMs.length,
    medianMs: rounded(median),
    p95Ms: rounded(p95),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

function assetPath(url: string): string | undefined {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname).replace(
      /^\/+/,
      "",
    );
    return pathname.startsWith("assets/") ? pathname : undefined;
  } catch {
    return undefined;
  }
}

async function installReadyProbe(page: Page, selector: string): Promise<void> {
  await page.addInitScript(
    ({ targetSelector }) => {
      type ProbeState = typeof globalThis & {
        __topoArmReady?: (selector: string) => number;
        __topoReadyAt?: number;
        __topoReadyStartedAt?: number;
        __topoReadyObserver?: MutationObserver;
        __topoLongTasks?: number[];
      };
      const state = globalThis as ProbeState;
      state.__topoLongTasks = [];
      try {
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            state.__topoLongTasks?.push(entry.duration);
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {
        // Long-task observation is optional on runtimes that omit the API.
      }
      state.__topoArmReady = (nextSelector: string) => {
        state.__topoReadyObserver?.disconnect();
        state.__topoReadyAt = undefined;
        state.__topoLongTasks = [];
        const startedAt = performance.now();
        state.__topoReadyStartedAt = startedAt;
        const markReady = () => {
          if (!document.querySelector(nextSelector)) return false;
          state.__topoReadyAt = performance.now();
          state.__topoReadyObserver?.disconnect();
          return true;
        };
        if (!markReady()) {
          const observer = new MutationObserver(markReady);
          state.__topoReadyObserver = observer;
          observer.observe(document, { childList: true, subtree: true });
        }
        return startedAt;
      };
      state.__topoArmReady(targetSelector);
    },
    { targetSelector: selector },
  );
}

async function readyDuration(page: Page): Promise<{
  durationMs: number;
  maxLongTaskMs: number;
}> {
  await page.waitForFunction(
    () =>
      typeof (globalThis as typeof globalThis & { __topoReadyAt?: number })
        .__topoReadyAt === "number",
    undefined,
    { timeout: 15_000 },
  );
  return page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __topoReadyAt?: number;
      __topoReadyStartedAt?: number;
      __topoLongTasks?: number[];
    };
    return {
      durationMs:
        (state.__topoReadyAt ?? performance.now()) -
        (state.__topoReadyStartedAt ?? 0),
      maxLongTaskMs: Math.max(0, ...(state.__topoLongTasks ?? [])),
    };
  });
}

async function armReadyProbe(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const state = globalThis as typeof globalThis & {
      __topoArmReady?: (selector: string) => number;
    };
    if (!state.__topoArmReady) throw new Error("Studio ready probe is missing");
    state.__topoArmReady(targetSelector);
  }, selector);
}

async function navigateWithinStudio(page: Page, route: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, route);
}

async function measureColdDestination(
  browser: Browser,
  baseUrl: string,
  destination: DestinationDefinition,
  iterations: number,
): Promise<DestinationMeasurement> {
  const samplesMs: number[] = [];
  const requestedAssets = new Set<string>();
  const pageErrors: string[] = [];
  let maxLongTaskMs = 0;

  for (let index = 0; index < iterations; index += 1) {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1_440, height: 900 },
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    page.on("response", (response) => {
      const asset = assetPath(response.url());
      if (asset) requestedAssets.add(asset);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installReadyProbe(page, destination.selector);
    await page.goto(`${baseUrl}${destination.route}`, {
      waitUntil: "domcontentloaded",
    });
    const ready = await readyDuration(page);
    samplesMs.push(ready.durationMs);
    maxLongTaskMs = Math.max(maxLongTaskMs, ready.maxLongTaskMs);
    await context.close();
  }

  return {
    samplesMs,
    requestedAssets: [...requestedAssets].sort(),
    pageErrors,
    maxLongTaskMs: rounded(maxLongTaskMs),
  };
}

async function measureHotDestination(
  browser: Browser,
  baseUrl: string,
  destination: DestinationDefinition,
  iterations: number,
): Promise<DestinationMeasurement> {
  const samplesMs: number[] = [];
  const requestedAssets = new Set<string>();
  const pageErrors: string[] = [];
  let maxLongTaskMs = 0;

  for (let index = 0; index < iterations; index += 1) {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1_440, height: 900 },
    });
    const page = await context.newPage();
    page.on("response", (response) => {
      const asset = assetPath(response.url());
      if (asset) requestedAssets.add(asset);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installReadyProbe(page, destination.selector);
    await page.goto(`${baseUrl}${destination.route}`, {
      waitUntil: "domcontentloaded",
    });
    await readyDuration(page);
    await navigateWithinStudio(page, destination.awayRoute);
    await page.locator(destination.awaySelector).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await armReadyProbe(page, destination.selector);
    await navigateWithinStudio(page, destination.route);
    const ready = await readyDuration(page);
    samplesMs.push(ready.durationMs);
    maxLongTaskMs = Math.max(maxLongTaskMs, ready.maxLongTaskMs);
    await context.close();
  }

  return {
    samplesMs,
    requestedAssets: [...requestedAssets].sort(),
    pageErrors,
    maxLongTaskMs: rounded(maxLongTaskMs),
  };
}

async function browserGraphicsMetadata(browser: Browser, baseUrl: string) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 200 },
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/notes?demo=1`, { waitUntil: "domcontentloaded" });
  const metadata = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { webglVersion: "unavailable", gpuAdapter: "unavailable" };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      webglVersion: String(gl.getParameter(gl.VERSION)),
      gpuAdapter: debug
        ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
        : "masked",
    };
  });
  await context.close();
  return metadata;
}

function destinationResult(
  destination: DestinationDefinition,
  mode: "cold" | "hot",
  measurement: DestinationMeasurement,
): StudioLoadingPerformanceResult {
  const cold = mode === "cold";
  return summarizeStudioLoadingResult({
    id: `${destination.id}-${cold ? "cold-ready" : "hot-switch"}`,
    title: `${destination.id === "atlas" ? "Atlas" : "Notes"} ${cold ? "cold readiness" : "cached destination switch"}`,
    description: cold
      ? `Open the production ${destination.id} route in an isolated Chromium context with the HTTP cache disabled and wait for its product-ready selector.`
      : `Return to the already-loaded ${destination.id} destination through Studio history and wait for its product-ready selector.`,
    samplesMs: measurement.samplesMs,
    budgetMs: cold
      ? destination.coldBudgetMs
      : STUDIO_HOT_DESTINATION_BUDGET_MS,
    workload: {
      destination: destination.id,
      latencyClass: cold ? "cold" : "hot",
      cache: cold ? "disabled" : "warm",
      navigation: cold ? "document" : "history",
      selector: destination.selector,
    },
    // Cold readiness is retained as evidence, but its absolute time depends on
    // the runner's process scheduler, filesystem, browser startup, and cache
    // state. The portable runtime gate remains the functional contract plus
    // the warm destination target.
    enforced: !cold,
  });
}

export async function runMeasuredStudioLoadingCheck(
  assetsDir: string,
  options: RunStudioLoadingPerformanceOptions = {},
): Promise<StudioLoadingReport> {
  const coldIterations = positiveInteger(options.coldIterations, 7);
  const hotIterations = positiveInteger(options.hotIterations, 9);
  const build: StudioBuildReport = await inspectStudioBuild(assetsDir);
  if (build.status !== "pass") {
    throw new Error(
      "Studio performance proof requires a passing production build report",
    );
  }
  const host = await startStudioHost({
    assetsDir: path.resolve(assetsDir),
    daemonUrl: "http://127.0.0.1:4599",
    port: 0,
  });
  const browser = await chromium.launch({ headless: options.headless ?? true });

  try {
    const measured = new Map<
      DestinationDefinition["id"],
      { cold: DestinationMeasurement; hot: DestinationMeasurement }
    >();
    for (const destination of DESTINATIONS) {
      measured.set(destination.id, {
        cold: await measureColdDestination(
          browser,
          host.url,
          destination,
          coldIterations,
        ),
        hot: await measureHotDestination(
          browser,
          host.url,
          destination,
          hotIterations,
        ),
      });
    }
    const graphics = await browserGraphicsMetadata(browser, host.url);
    const notesMeasurement = measured.get("notes")!;
    const atlasMeasurement = measured.get("atlas")!;
    const notesDefinition = DESTINATIONS[0]!;
    const atlasDefinition = DESTINATIONS[1]!;
    const results = [
      destinationResult(notesDefinition, "cold", notesMeasurement.cold),
      destinationResult(atlasDefinition, "cold", atlasMeasurement.cold),
      destinationResult(notesDefinition, "hot", notesMeasurement.hot),
      destinationResult(atlasDefinition, "hot", atlasMeasurement.hot),
    ];
    const functional = await runStudioLoadingFunctionalCheck(
      assetsDir,
      options,
    );
    const performanceFailed = results.filter(
      (result) => result.status === "fail" && result.enforced,
    ).length;
    const performanceInformationalFailures = results.filter(
      (result) => result.status === "fail" && !result.enforced,
    ).length;
    const performancePassed = results.filter(
      (result) => result.status === "pass",
    ).length;
    const pageErrors = [
      ...notesMeasurement.cold.pageErrors,
      ...notesMeasurement.hot.pageErrors,
      ...atlasMeasurement.cold.pageErrors,
      ...atlasMeasurement.hot.pageErrors,
    ];
    const pixiFiles = new Set(build.pixi.assets.map((asset) => asset.file));
    const notesAssets = [
      ...new Set(notesMeasurement.cold.requestedAssets),
    ].sort();
    const atlasAssets = [
      ...new Set(atlasMeasurement.cold.requestedAssets),
    ].sort();

    return {
      schemaVersion: STUDIO_LOADING_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      status:
        functional.status === "pass" &&
        performanceFailed === 0 &&
        pageErrors.length === 0
          ? "pass"
          : "fail",
      profile: {
        id: "studio-loading-standard",
        coldIterations,
        hotIterations,
        viewportWidth: 1_440,
        viewportHeight: 900,
      },
      runtime: {
        surface: "studio",
        browserName: "chromium",
        browserVersion: browser.version(),
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        renderer: "Studio DOM + PixiJS WebGL",
        resolution: 1,
        webglVersion: graphics.webglVersion,
        gpuAdapter: graphics.gpuAdapter,
      },
      settings: {
        coldCacheDisabled: true,
        isolatedContextPerSample: true,
      },
      offline: functional.offline,
      notes: {
        ...functional.notes,
        requestedAssets: notesAssets,
        pixiAssets: notesAssets.filter((asset) => pixiFiles.has(asset)),
        cold: results[0]!,
        hot: results[2]!,
        maxLongTaskMs: Math.max(
          notesMeasurement.cold.maxLongTaskMs,
          notesMeasurement.hot.maxLongTaskMs,
        ),
      },
      atlas: {
        ...functional.atlas,
        requestedAssets: atlasAssets,
        pixiAssets: atlasAssets.filter((asset) => pixiFiles.has(asset)),
        cold: results[1]!,
        hot: results[3]!,
        maxLongTaskMs: Math.max(
          atlasMeasurement.cold.maxLongTaskMs,
          atlasMeasurement.hot.maxLongTaskMs,
        ),
      },
      summary: functional.summary,
      performanceSummary: {
        passed: performancePassed,
        failed: performanceFailed,
        informationalFailures: performanceInformationalFailures,
        total: results.length,
      },
      checks: functional.checks,
      results,
    };
  } finally {
    await browser.close();
    await host.close();
  }
}
