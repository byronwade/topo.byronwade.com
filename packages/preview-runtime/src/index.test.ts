import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import type { Page } from "playwright";
import { afterEach, describe, expect, it } from "vitest";

import { startTopoPreviewRuntime, type TopoPreviewRuntime } from "./index.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = "src/__fixtures__/ReadyPreview.topo.tsx";
const runtimes: TopoPreviewRuntime[] = [];

async function waitForPreviewStatus(
  page: Page,
  status: "ready" | "error",
  browserEvidence: string[],
): Promise<void> {
  try {
    await page.waitForSelector(`html[data-topo-preview-status="${status}"]`, {
      timeout: 8_000,
    });
  } catch (error) {
    const currentStatus = await page
      .locator("html")
      .getAttribute("data-topo-preview-status");
    const body = await page.locator("body").textContent();
    throw new Error(
      `Preview did not reach ${status}; status=${currentStatus}; body=${body}; browser=${browserEvidence.join(" | ")}`,
      { cause: error },
    );
  }
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("startTopoPreviewRuntime", () => {
  it("rejects non-loopback bindings", async () => {
    await expect(
      startTopoPreviewRuntime({ rootDir: packageRoot, host: "0.0.0.0" }),
    ).rejects.toThrow(/loopback/i);
  });

  it("serves capability-scoped previews with containment and runtime evidence", async () => {
    const runtime = await startTopoPreviewRuntime({
      rootDir: packageRoot,
      port: 0,
    });
    runtimes.push(runtime);

    const base = new URL(runtime.baseUrl);
    expect(base.hostname).toBe("127.0.0.1");
    expect(Number(base.port)).toBeGreaterThan(0);
    expect(base.pathname).toMatch(/^\/__topo\/[a-f0-9]{64}\/$/);

    const bareOriginResponse = await fetch(base.origin, {
      redirect: "manual",
    });
    const bareOriginBody = await bareOriginResponse.text();
    expect(bareOriginResponse.status).toBe(404);
    expect(bareOriginResponse.headers.get("location")).toBeNull();
    expect(bareOriginBody).not.toContain(base.pathname);

    const traversal = new URL("preview", runtime.baseUrl);
    traversal.searchParams.set("source", "../outside.tsx");
    traversal.searchParams.set("export", "default");
    const traversalResponse = await fetch(traversal);
    expect(traversalResponse.status).toBe(400);
    expect(await traversalResponse.text()).toMatch(
      /workspace-relative|outside/i,
    );

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const browserEvidence: string[] = [];
    page.on("console", (message) =>
      browserEvidence.push(`console:${message.type()}:${message.text()}`),
    );
    page.on("pageerror", (error) =>
      browserEvidence.push(`pageerror:${error.message}`),
    );
    page.on("requestfailed", (request) =>
      browserEvidence.push(
        `requestfailed:${request.url()}:${request.failure()?.errorText ?? "unknown"}`,
      ),
    );
    try {
      const ready = new URL("preview", runtime.baseUrl);
      ready.searchParams.set("source", source);
      ready.searchParams.set("export", "ReadyPreview");
      await page.goto(ready.toString(), { waitUntil: "networkidle" });
      await waitForPreviewStatus(page, "ready", browserEvidence);
      await expect(
        page.getByTestId("ready-preview").textContent(),
      ).resolves.toBe("Standalone Topo preview");

      const missing = new URL("preview", runtime.baseUrl);
      missing.searchParams.set("source", source);
      missing.searchParams.set("export", "MissingPreview");
      await page.goto(missing.toString(), { waitUntil: "networkidle" });
      await waitForPreviewStatus(page, "error", browserEvidence);
      await expect(page.locator("body").textContent()).resolves.toContain(
        'Export "MissingPreview" was not found',
      );
      await expect(page.locator("body").textContent()).resolves.toContain(
        source,
      );
    } finally {
      await page.close();
      await browser.close();
    }
  }, 30_000);
});
