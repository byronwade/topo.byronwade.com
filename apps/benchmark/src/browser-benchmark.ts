import path from "node:path";

import { chromium, type CDPSession, type Page } from "playwright";
import { createServer } from "vite";

import type { BenchmarkProfileName } from "./index.js";
import {
  finalizeBrowserBenchmarkReport,
  type BrowserBenchmarkReport,
  type RawBrowserBenchmarkMemory,
  type RawBrowserBenchmarkReport,
} from "./browser-contract.js";

export interface RunTopoBrowserBenchmarksOptions {
  profile?: BenchmarkProfileName;
  headless?: boolean;
}

async function collectRetainedHeap(
  page: Page,
  memory: RawBrowserBenchmarkMemory,
): Promise<RawBrowserBenchmarkMemory> {
  let session: CDPSession | undefined;
  try {
    session = await page.context().newCDPSession(page);
    await session.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(50);
    await session.send("HeapProfiler.collectGarbage");
    const retainedBytes = await page.evaluate(() =>
      (performance as Performance & {
        memory?: { usedJSHeapSize: number };
      }).memory?.usedJSHeapSize,
    );
    return retainedBytes === undefined
      ? { ...memory, collection: "unavailable" }
      : {
          ...memory,
          retainedBytes,
          collection: "cdp-heap-profiler",
        };
  } catch {
    return { ...memory, collection: "unavailable" };
  } finally {
    await session?.detach().catch(() => undefined);
  }
}

export async function runTopoBrowserBenchmarks(
  options: RunTopoBrowserBenchmarksOptions = {},
): Promise<BrowserBenchmarkReport> {
  const profile = options.profile ?? "standard";
  const appRoot = path.resolve(import.meta.dirname, "..");
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    root: appRoot,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("Browser benchmark server did not expose a TCP port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
      headless: options.headless ?? true,
      args: ["--enable-precise-memory-info"],
    });
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1_440, height: 900 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${baseUrl}/browser/index.html`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(
      () => window.__TOPO_BROWSER_BENCHMARK_READY__ === true,
    );
    const raw = await page.evaluate(async (selectedProfile) => {
      const benchmark = window.__TOPO_BROWSER_BENCHMARK__;
      if (!benchmark) throw new Error("Browser benchmark is unavailable");
      return benchmark.run(selectedProfile);
    }, profile);
    if (errors.length > 0) {
      throw new Error(`Browser benchmark page errors: ${errors.join(" | ")}`);
    }
    const rawReport = raw as RawBrowserBenchmarkReport;
    const report = finalizeBrowserBenchmarkReport(
      rawReport.memory
        ? {
            ...rawReport,
            memory: await collectRetainedHeap(page, rawReport.memory),
          }
        : rawReport,
      {
        browserName: "chromium",
        browserVersion: browser.version(),
        generatedAt: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
    );
    await context.close();
    return report;
  } finally {
    await browser?.close();
    await server.close();
  }
}
