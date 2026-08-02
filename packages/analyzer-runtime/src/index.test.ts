import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { isDestructiveControl, probeRoute } from "./index.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

async function startFixture(): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === "/effect") {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html><body>
  <button id="inert">Watch the tour</button>
  <button id="effects">Record safe effect</button>
  <button id="dialog">Open dialog</button>
  <form action="/write" method="post"><button id="write">Save profile</button></form>
  <button id="delete">Delete account</button>
  <input id="focus-target" aria-label="Focus target" />
  <script>
    window.__TOPO__ = {
      events: [],
      emit(event) { this.events.push({ ...event, timestamp: new Date().toISOString() }); }
    };
    document.querySelector('#effects').addEventListener('click', () => {
      document.body.dataset.changed = 'true';
      localStorage.setItem('probe-effect', 'recorded');
      document.querySelector('#focus-target').focus();
      window.__TOPO__.emit({ type: 'topo.dom', payload: { source: 'fixture' } });
      void fetch('/effect');
    });
    document.querySelector('#dialog').addEventListener('click', () => alert('Fixture dialog'));
  </script>
</body></html>`);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  return `http://127.0.0.1:${address.port}`;
}

describe("runtime analyzer safety policy", () => {
  it("skips destructive and implicit write actions before browser activation", () => {
    expect(isDestructiveControl("Delete customer")).toBe(true);
    expect(isDestructiveControl("Continue", "/billing/pay")).toBe(true);
    expect(isDestructiveControl("Open dashboard", "/dashboard")).toBe(false);
  });

  it("records typed effects, inert evidence, and safety skips in a real browser", async () => {
    const baseUrl = await startFixture();
    const result = await probeRoute({
      baseUrl,
      routePath: "/",
      screenId: "fixture:/",
      maxControls: 8,
      settleMs: 250,
    });

    const byLabel = new Map(
      result.observations.map((observation) => [
        observation.control.label,
        observation,
      ]),
    );
    expect(byLabel.get("Watch the tour")).toMatchObject({
      routePath: "/",
      screenId: "fixture:/",
      status: "possibly-inert",
      effects: [],
      control: {
        tagName: "button",
        role: "button",
        locator: "#inert",
      },
    });

    const effectKinds = byLabel
      .get("Record safe effect")
      ?.effects.map((effect) => effect.kind);
    expect(effectKinds).toEqual(
      expect.arrayContaining([
        "network",
        "dom",
        "focus",
        "storage",
        "app-event",
      ]),
    );
    expect(byLabel.get("Record safe effect")?.status).toBe("effect-observed");
    expect(byLabel.get("Open dialog")?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "dialog" })]),
    );
    expect(byLabel.get("Save profile")).toMatchObject({
      status: "skipped",
    });
    expect(byLabel.get("Save profile")?.evidence.join(" ")).toMatch(
      /non-GET form/i,
    );
    expect(byLabel.get("Delete account")).toMatchObject({
      status: "skipped",
    });
    expect(byLabel.get("Delete account")?.evidence.join(" ")).toMatch(
      /destructive/i,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      id: byLabel.get("Watch the tour")?.id,
      title: "Control may be inert",
    });
  }, 30_000);
});
