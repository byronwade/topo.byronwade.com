import { chromium } from "playwright";

export const WEB_PERFORMANCE_REPORT_VERSION = 1 as const;

export interface WebPerformanceMeasurement {
  lcpMs: number;
  ttfbMs: number;
  domContentLoadedMs: number;
  loadMs: number;
  maxLongTaskMs: number;
  cls: number;
  domElements: number;
}

export interface WebPerformanceResult {
  id: "lcp" | "ttfb" | "dom-content-loaded" | "load" | "max-long-task";
  title: string;
  latencyClass: "hot" | "cold" | "external";
  samplesMs: number[];
  sampleCount: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  budgetMs: number;
  status: "pass" | "fail";
}

export interface WebPerformanceReport {
  schemaVersion: typeof WEB_PERFORMANCE_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  url: string;
  runtime: {
    browserName: "chromium";
    browserVersion: string;
    nodeVersion: string;
    platform: NodeJS.Platform;
    architecture: string;
  };
  settings: { iterations: number; settleMs: number };
  quality: {
    clsSamples: number[];
    maxCls: number;
    clsBudget: number;
    maxDomElements: number;
    status: "pass" | "fail";
  };
  results: WebPerformanceResult[];
}

export interface RunWebPerformanceOptions {
  iterations?: number;
  settleMs?: number;
}

const BUDGETS = {
  lcp: 500,
  ttfb: 200,
  domContentLoaded: 500,
  load: 750,
  maxLongTask: 50,
  cls: 0.01,
} as const;

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(samples: readonly number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

export function summarizeWebSamples(
  definition: Pick<WebPerformanceResult, "id" | "title" | "latencyClass">,
  samples: readonly number[],
  budgetMs: number,
): WebPerformanceResult {
  if (samples.length === 0) throw new Error(`${definition.id} has no samples`);
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const p95 = percentile(sorted, 0.95);
  return {
    ...definition,
    samplesMs: samples.map(rounded),
    sampleCount: samples.length,
    medianMs: rounded(median),
    p95Ms: rounded(p95),
    maxMs: rounded(sorted.at(-1) ?? 0),
    budgetMs,
    status: p95 <= budgetMs ? "pass" : "fail",
  };
}

export async function runWebPerformance(
  url: string,
  options: RunWebPerformanceOptions = {},
): Promise<WebPerformanceReport> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Web performance URL must use HTTP or HTTPS");
  }
  const iterations = options.iterations ?? 5;
  const settleMs = options.settleMs ?? 250;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("Web performance iterations must be a positive integer");
  }
  if (!Number.isInteger(settleMs) || settleMs < 0) {
    throw new Error("Web performance settleMs must be a non-negative integer");
  }

  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const measurements: WebPerformanceMeasurement[] = [];
  try {
    for (let index = 0; index < iterations; index += 1) {
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        viewport: { width: 1_440, height: 900 },
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const state = { lcpMs: 0, cls: 0, longTasksMs: [] as number[] };
        Object.defineProperty(window, "__TOPO_WEB_PERFORMANCE__", {
          configurable: true,
          value: state,
        });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) state.lcpMs = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              hadRecentInput?: boolean;
              value?: number;
            };
            if (!shift.hadRecentInput) state.cls += shift.value ?? 0;
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.longTasksMs.push(entry.duration);
          }
        }).observe({ type: "longtask", buffered: true });
      });
      await page.goto(parsedUrl.href, { waitUntil: "load" });
      await page.waitForTimeout(settleMs);
      measurements.push(
        await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0] as
            PerformanceNavigationTiming | undefined;
          const state = (
            window as Window & {
              __TOPO_WEB_PERFORMANCE__?: {
                lcpMs: number;
                cls: number;
                longTasksMs: number[];
              };
            }
          ).__TOPO_WEB_PERFORMANCE__;
          if (!navigation || !state) {
            throw new Error("Web performance observers did not initialize");
          }
          return {
            lcpMs: state.lcpMs,
            ttfbMs: navigation.responseStart - navigation.startTime,
            domContentLoadedMs:
              navigation.domContentLoadedEventEnd - navigation.startTime,
            loadMs: navigation.loadEventEnd - navigation.startTime,
            maxLongTaskMs: Math.max(0, ...state.longTasksMs),
            cls: state.cls,
            domElements: document.getElementsByTagName("*").length,
          };
        }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const results = [
    summarizeWebSamples(
      { id: "lcp", title: "Largest Contentful Paint", latencyClass: "cold" },
      measurements.map((item) => item.lcpMs),
      BUDGETS.lcp,
    ),
    summarizeWebSamples(
      { id: "ttfb", title: "Time to first byte", latencyClass: "external" },
      measurements.map((item) => item.ttfbMs),
      BUDGETS.ttfb,
    ),
    summarizeWebSamples(
      {
        id: "dom-content-loaded",
        title: "DOM content loaded",
        latencyClass: "cold",
      },
      measurements.map((item) => item.domContentLoadedMs),
      BUDGETS.domContentLoaded,
    ),
    summarizeWebSamples(
      { id: "load", title: "Window load", latencyClass: "cold" },
      measurements.map((item) => item.loadMs),
      BUDGETS.load,
    ),
    summarizeWebSamples(
      {
        id: "max-long-task",
        title: "Maximum main-thread long task",
        latencyClass: "hot",
      },
      measurements.map((item) => item.maxLongTaskMs),
      BUDGETS.maxLongTask,
    ),
  ];
  const clsSamples = measurements.map((item) => rounded(item.cls));
  const maxCls = rounded(Math.max(...clsSamples));
  const qualityStatus = maxCls <= BUDGETS.cls ? "pass" : "fail";
  const status =
    qualityStatus === "pass" && results.every((item) => item.status === "pass")
      ? "pass"
      : "fail";
  return {
    schemaVersion: WEB_PERFORMANCE_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    url: parsedUrl.href,
    runtime: {
      browserName: "chromium",
      browserVersion,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    settings: { iterations, settleMs },
    quality: {
      clsSamples,
      maxCls,
      clsBudget: BUDGETS.cls,
      maxDomElements: Math.max(...measurements.map((item) => item.domElements)),
      status: qualityStatus,
    },
    results,
  };
}
