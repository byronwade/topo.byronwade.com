import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captureRoute,
  captureRouteWithBrowser,
  launchPreviewBrowser,
} from "./index.js";

let server: Server;
let baseUrl = "";

beforeEach(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/error") {
      response.end(`<!doctype html>
<html data-topo-preview-status="loading">
  <head><title>Loading</title></head>
  <body><main id="root">Loading</main><script>
    setTimeout(() => {
      document.documentElement.dataset.topoPreviewStatus = "error";
      document.querySelector("#root").textContent = "Broken preview: missing fixture";
    }, 40);
  </script></body>
</html>`);
      return;
    }
    response.end(`<!doctype html>
<html data-topo-preview-status="loading">
  <head><title>Loading</title></head>
  <body><main id="root">Loading</main><script>
    setTimeout(() => {
      document.title = "Ready preview";
      document.documentElement.dataset.topoPreviewStatus = "ready";
      document.querySelector("#root").textContent = "Rendered component";
    }, 80);
  </script></body>
</html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Fixture server did not expose a TCP port"));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("captureRoute readiness", () => {
  const readiness = {
    readySelector: 'html[data-topo-preview-status="ready"]',
    errorSelector: 'html[data-topo-preview-status="error"]',
    timeoutMs: 2_000,
  };

  it("waits for the declared ready state before taking a screenshot", async () => {
    const result = await captureRoute({
      baseUrl,
      routePath: "/ready",
      viewport: { width: 480, height: 320 },
      fullPage: false,
      readiness,
    });

    expect(result.title).toBe("Ready preview");
    expect(result.screenshot.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  }, 15_000);

  it("rejects a declared error state with its visible evidence", async () => {
    await expect(
      captureRoute({
        baseUrl,
        routePath: "/error",
        viewport: { width: 480, height: 320 },
        fullPage: false,
        readiness,
      }),
    ).rejects.toThrow("Broken preview: missing fixture");
  }, 15_000);

  it("reuses one browser process while isolating each capture context", async () => {
    const browser = await launchPreviewBrowser();
    try {
      const first = await captureRouteWithBrowser(browser, {
        baseUrl,
        routePath: "/ready?capture=1",
        viewport: { width: 480, height: 320 },
        fullPage: false,
        readiness,
      });
      const second = await captureRouteWithBrowser(browser, {
        baseUrl,
        routePath: "/ready?capture=2",
        viewport: { width: 480, height: 320 },
        fullPage: false,
        readiness,
      });

      expect(first.url).toContain("capture=1");
      expect(second.url).toContain("capture=2");
      expect(browser.isConnected()).toBe(true);
      expect(browser.contexts()).toHaveLength(0);
    } finally {
      await browser.close();
    }
  }, 15_000);
});
