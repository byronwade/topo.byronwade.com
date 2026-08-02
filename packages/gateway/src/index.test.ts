import { createServer, type RequestListener } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  createPreviewGateway,
  type PreviewGateway,
  type PreviewGatewaySession,
} from "./index.js";

const activeGateways: PreviewGateway[] = [];
const activeServers: ReturnType<typeof createServer>[] = [];

async function listenUpstream(
  handler: RequestListener,
): Promise<{ server: ReturnType<typeof createServer>; origin: string }> {
  const server = createServer(handler);
  activeServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Upstream did not expose a TCP port");
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Session response did not set a cookie");
  return setCookie.split(";")[0]!;
}

async function bootstrapSession(
  session: PreviewGatewaySession,
): Promise<string> {
  const response = await fetch(session.launchUrl, { redirect: "manual" });
  expect([200, 303]).toContain(response.status);
  return sessionCookie(response);
}

afterEach(async () => {
  await Promise.allSettled(
    activeGateways.splice(0).map((item) => item.close()),
  );
  await Promise.all(
    activeServers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("preview gateway", () => {
  it("establishes an opaque session, initializes local storage, and forwards profile evidence", async () => {
    const upstream = await listenUpstream((request, response) => {
      response.setHeader("x-frame-options", "DENY");
      response.setHeader(
        "content-security-policy",
        "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
      );
      response.setHeader(
        "set-cookie",
        "application_session=upstream; Domain=127.0.0.1; Path=/; HttpOnly",
      );
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          path: request.url,
          role: request.headers["x-preview-role"],
          cookie: request.headers.cookie,
        }),
      );
    });
    const gateway = createPreviewGateway({
      targetBaseUrl: upstream.origin,
      profiles: [
        {
          name: "Owner",
          headers: { "x-preview-role": "owner" },
          cookies: [{ name: "auth", value: "owner-session" }],
          localStorage: { "topo:workspace": "owner" },
        },
      ],
      port: 0,
      secret: "test-secret",
    });
    activeGateways.push(gateway);
    const [session] = await gateway.listen();
    expect(session).toBeDefined();
    expect(session!.profileName).toBe("Owner");
    expect(session!.launchUrl).not.toContain("owner-session");
    expect(session!.launchUrl).not.toContain("topo%3Aworkspace");

    const unauthorized = await fetch(`${session!.baseUrl}home`);
    expect(unauthorized.status).toBe(401);

    const bootstrapUrl = new URL(session!.launchUrl);
    bootstrapUrl.pathname = "/home";
    const bootstrap = await fetch(bootstrapUrl, {
      redirect: "manual",
    });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("set-cookie")).toContain(
      "SameSite=None; Secure; Partitioned",
    );
    expect(await bootstrap.text()).toContain("localStorage.setItem");
    const response = await fetch(`${session!.baseUrl}home?tab=active`, {
      headers: { cookie: sessionCookie(bootstrap) },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "/home?tab=active",
      role: "owner",
      cookie: "auth=owner-session",
    });
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self'",
    );
    expect(response.headers.get("set-cookie")).toBe(
      "application_session=upstream; Path=/; HttpOnly; Secure; SameSite=None; Partitioned",
    );
  });

  it("gives every profile an isolated origin and rejects another profile token", async () => {
    const upstream = await listenUpstream((request, response) => {
      response.end(String(request.headers["x-preview-role"]));
    });
    const gateway = createPreviewGateway({
      targetBaseUrl: upstream.origin,
      profiles: [
        { name: "Owner", headers: { "x-preview-role": "owner" } },
        { name: "Customer", headers: { "x-preview-role": "customer" } },
      ],
      port: 0,
    });
    activeGateways.push(gateway);
    const [owner, customer] = await gateway.listen();
    expect(owner!.baseUrl).not.toBe(customer!.baseUrl);
    expect(new URL(owner!.baseUrl).hostname).not.toBe(
      new URL(customer!.baseUrl).hostname,
    );

    const ownerToken = new URL(owner!.launchUrl).searchParams.get(
      "topo_session",
    );
    const crossed = new URL(customer!.baseUrl);
    crossed.searchParams.set("topo_session", ownerToken!);
    expect((await fetch(crossed, { redirect: "manual" })).status).toBe(401);

    const ownerCookie = await bootstrapSession(owner!);
    const customerCookie = await bootstrapSession(customer!);
    expect(
      await (
        await fetch(owner!.baseUrl, { headers: { cookie: ownerCookie } })
      ).text(),
    ).toBe("owner");
    expect(
      await (
        await fetch(customer!.baseUrl, { headers: { cookie: customerCookie } })
      ).text(),
    ).toBe("customer");
  });

  it("injects the bounded runtime bridge into signed local HTML without weakening script policy", async () => {
    const upstream = await listenUpstream((_request, response) => {
      const body =
        '<!doctype html><html><head><title>Preview</title></head><body><button data-testid="save">Save</button></body></html>';
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "content-security-policy":
          "default-src 'none'; script-src 'self'; frame-ancestors 'none'",
        "x-frame-options": "DENY",
      });
      response.end(body);
    });
    const gateway = createPreviewGateway({
      targetBaseUrl: upstream.origin,
      profiles: [{ name: "Anonymous" }],
      port: 0,
    });
    activeGateways.push(gateway);
    const [session] = await gateway.listen();
    const cookie = await bootstrapSession(session!);
    const response = await fetch(session!.baseUrl, {
      headers: { accept: "text/html", cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toMatch(
      /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/,
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "frame-ancestors",
    );
    expect(Number(response.headers.get("content-length"))).toBe(
      Buffer.byteLength(html),
    );
    expect(html).toContain("data-topo-preview-bridge");
    expect(html).toContain("topo.anchor.inspect");
    expect(html).not.toContain("topo_session");
  });

  it("forwards authenticated WebSocket traffic for framework HMR", async () => {
    const upstream = await listenUpstream((_request, response) => {
      response.end("http");
    });
    const webSocketServer = new WebSocketServer({ server: upstream.server });
    webSocketServer.on("connection", (socket, request) => {
      socket.send(
        `${String(request.headers["x-preview-role"])}:${String(request.headers.cookie)}`,
      );
      socket.on("message", (message) => socket.send(message));
    });
    const gateway = createPreviewGateway({
      targetBaseUrl: upstream.origin,
      profiles: [
        {
          name: "Technician",
          headers: { "x-preview-role": "technician" },
          cookies: [{ name: "auth", value: "tech-session" }],
        },
      ],
      port: 0,
    });
    activeGateways.push(gateway);
    const [session] = await gateway.listen();
    const cookie = await bootstrapSession(session!);
    const url = new URL("hmr", session!.baseUrl);
    url.protocol = "ws:";
    const socket = new WebSocket(url, { headers: { cookie } });
    const firstMessage = await new Promise<string>((resolve, reject) => {
      socket.once("message", (message) => resolve(message.toString()));
      socket.once("error", reject);
    });
    expect(firstMessage).toBe("technician:auth=tech-session");
    const echoed = new Promise<string>((resolve, reject) => {
      socket.once("message", (message) => resolve(message.toString()));
      socket.once("error", reject);
    });
    socket.send("refresh");
    expect(await echoed).toBe("refresh");
    socket.close();
    webSocketServer.close();
  });

  it("fails closed for remote targets and reserved profile headers", () => {
    expect(() =>
      createPreviewGateway({
        targetBaseUrl: "https://example.com",
        profiles: [{ name: "Anonymous" }],
      }),
    ).toThrow(/target must be loopback/);
    expect(() =>
      createPreviewGateway({
        targetBaseUrl: "http://127.0.0.1:3000",
        profiles: [{ name: "Owner", headers: { host: "example.com" } }],
      }),
    ).toThrow(/reserved header host/);
  });
});
