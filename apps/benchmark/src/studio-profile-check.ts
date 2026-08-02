import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import { WebSocketServer } from "ws";

import { defineConfig } from "@topo/config";
import {
  createDaemon,
  type DaemonOptions,
  type TopoDaemon,
} from "@topo/daemon";
import {
  createPreviewGateway,
  type GatewayProfile,
  type PreviewGateway,
  type PreviewGatewaySession,
} from "@topo/gateway";
import { startStudioHost, type TopoStudioHost } from "@topo/studio-host";

export const STUDIO_PROFILE_REPORT_VERSION = 1 as const;

export interface StudioProfileEvidence {
  profileName: string;
  expectedRole: string;
  iframeOrigin: string;
  gatewayOrigin: string;
  queryCapabilityRemoved: boolean;
  headerRole: string | null;
  cookieRole: string | null;
  localStorageRole: string | null;
  webSocketRole: string | null;
  webSocketProtocol: string | null;
  previewBridgeVersion: number | null;
  anchorRole: string | null;
  anchorAccessibleName: string | null;
  anchorTestLocator: string | null;
  anchorDomFingerprint: string | null;
}

export interface StudioProfileCheck {
  id:
    | "isolated-origins"
    | "owner-profile"
    | "customer-profile"
    | "clean-navigation"
    | "hmr-websocket"
    | "preview-bridge"
    | "llm-capability-exclusion"
    | "page-errors";
  status: "pass" | "fail";
  detail: string;
  evidence: Record<string, boolean | number | string | string[]>;
}

export interface StudioProfileReport {
  schemaVersion: typeof STUDIO_PROFILE_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  browser: { name: "chromium"; version: string };
  profiles: StudioProfileEvidence[];
  summary: { passed: number; failed: number; total: number };
  checks: StudioProfileCheck[];
}

const runDoctorFixture: NonNullable<DaemonOptions["runDoctor"]> = async ({
  project,
  graph,
}) => ({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
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
      detail: `${graph.screens.length} screen(s) available to the profile verifier.`,
      evidence: { screens: graph.screens.length },
    },
  ],
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Profile fixture did not receive a TCP address"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function fixtureHtml(headerRole: string, cookieRole: string): string {
  const safeHeader = JSON.stringify(headerRole);
  const safeCookie = JSON.stringify(cookieRole);
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Topo profile fixture</title></head>
  <body>
    <main data-header-role=${safeHeader} data-cookie-role=${safeCookie}>
      <strong data-profile-label>Loading preview profile</strong>
      <button type="button" data-testid="profile-action" aria-label="Open profile actions">
        Open
      </button>
    </main>
    <script>
      const role = localStorage.getItem("topo:preview-role") || "missing";
      document.querySelector("main").dataset.previewRole = role;
      document.querySelector("[data-profile-label]").textContent = "Runtime healthy · " + role;
    </script>
  </body>
</html>`;
}

async function createProjectFixture(): Promise<string> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "topo-profile-check-"),
  );
  await fs.mkdir(path.join(rootDir, "app"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({ name: "topo-profile-check", dependencies: { next: "^16.0.0" } })}\n`,
  );
  await fs.writeFile(
    path.join(rootDir, "app", "page.tsx"),
    "export default function Page() { return <main>Profile verifier</main>; }\n",
  );
  return rootDir;
}

async function profileEvidence(
  page: import("playwright").Page,
  studioUrl: string,
  session: PreviewGatewaySession,
  expectedRole: string,
  navigationDiagnostics: string[],
): Promise<StudioProfileEvidence> {
  await page.goto(`${studioUrl}/settings/adapters`, {
    waitUntil: "domcontentloaded",
  });
  const selector = page.getByLabel("Preview profile");
  await selector.waitFor({ state: "visible" });
  await selector.selectOption(session.profileName);
  await page.waitForFunction((profileName) => {
    const raw = localStorage.getItem("topo:studio-settings");
    return raw ? JSON.parse(raw).previewProfile === profileName : false;
  }, session.profileName);
  await page.goto(`${studioUrl}/atlas/live`, { waitUntil: "domcontentloaded" });
  const frameElement = page.locator(".browser-preview iframe");
  await frameElement.waitFor({ state: "visible" });
  const frame = page.frameLocator(".browser-preview iframe");
  const main = frame.locator("main[data-preview-role]");
  try {
    await main.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const frameUrls = page
      .frames()
      .map((candidate) => sanitizedUrl(candidate.url()));
    throw new Error(
      `${session.profileName} live iframe did not initialize. Frames: ${frameUrls.join(", ")}. Navigation: ${navigationDiagnostics.slice(-12).join(" | ")}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await main.evaluate((element, role) => {
    if ((element as HTMLElement).dataset.previewRole !== role) {
      throw new Error(`Expected local storage role ${role}`);
    }
  }, expectedRole);
  const iframeUrl = new URL(
    await frame.locator("html").evaluate(() => window.location.href),
  );
  const previewBridgeVersion = await frame.locator("html").evaluate(() => {
    const bridgeWindow = window as typeof window & {
      __TOPO__?: { version?: number };
    };
    return bridgeWindow.__TOPO__?.version ?? null;
  });
  const anchorPoint = await frame
    .locator('[data-testid="profile-action"]')
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: (bounds.left + bounds.width / 2) / window.innerWidth,
        y: (bounds.top + bounds.height / 2) / window.innerHeight,
      };
    });
  const anchorInspection = await page.evaluate(
    ({ point, targetOrigin }) =>
      new Promise<{
        role?: string;
        accessibleName?: string;
        testLocator?: string;
        domFingerprint?: string;
      }>((resolve, reject) => {
        const frame = document.querySelector<HTMLIFrameElement>(
          ".browser-preview iframe",
        );
        const target = frame?.contentWindow;
        if (!target) {
          reject(new Error("Live preview frame has no content window"));
          return;
        }
        const requestId = `profile-check-${Date.now()}`;
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          reject(new Error("Timed out waiting for preview bridge evidence"));
        }, 2_000);
        const onMessage = (event: MessageEvent<unknown>) => {
          if (
            event.source !== target ||
            event.origin !== targetOrigin ||
            !event.data ||
            typeof event.data !== "object"
          ) {
            return;
          }
          const message = event.data as {
            type?: unknown;
            version?: unknown;
            requestId?: unknown;
            result?: unknown;
          };
          if (
            message.type !== "topo.anchor.inspected" ||
            message.version !== 1 ||
            message.requestId !== requestId ||
            !message.result ||
            typeof message.result !== "object"
          ) {
            return;
          }
          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          resolve(message.result);
        };
        window.addEventListener("message", onMessage);
        target.postMessage(
          {
            type: "topo.anchor.inspect",
            version: 1,
            requestId,
            point,
          },
          targetOrigin,
        );
      }),
    { point: anchorPoint, targetOrigin: iframeUrl.origin },
  );
  const webSocketEvidence = await frame.locator("html").evaluate(
    () =>
      new Promise<{ role: string | null; protocol: string | null }>(
        (resolve, reject) => {
          const protocol = location.protocol === "https:" ? "wss:" : "ws:";
          const socket = new WebSocket(
            `${protocol}//${location.host}/__topo_hmr`,
            "vite-hmr",
          );
          const timeout = window.setTimeout(() => {
            socket.close();
            reject(new Error("Timed out waiting for preview WebSocket"));
          }, 5_000);
          socket.addEventListener("message", (event) => {
            window.clearTimeout(timeout);
            const evidence = JSON.parse(String(event.data)) as {
              role?: string;
              protocol?: string;
            };
            socket.close();
            resolve({
              role: evidence.role ?? null,
              protocol: evidence.protocol ?? null,
            });
          });
          socket.addEventListener("error", () => {
            window.clearTimeout(timeout);
            reject(new Error("Preview WebSocket failed"));
          });
        },
      ),
  );
  return {
    profileName: session.profileName,
    expectedRole,
    iframeOrigin: iframeUrl.origin,
    gatewayOrigin: new URL(session.baseUrl).origin,
    queryCapabilityRemoved: !iframeUrl.searchParams.has("topo_session"),
    headerRole: await main.getAttribute("data-header-role"),
    cookieRole: await main.getAttribute("data-cookie-role"),
    localStorageRole: await main.getAttribute("data-preview-role"),
    webSocketRole: webSocketEvidence.role,
    webSocketProtocol: webSocketEvidence.protocol,
    previewBridgeVersion,
    anchorRole: anchorInspection.role ?? null,
    anchorAccessibleName: anchorInspection.accessibleName ?? null,
    anchorTestLocator: anchorInspection.testLocator ?? null,
    anchorDomFingerprint: anchorInspection.domFingerprint ?? null,
  };
}

function sanitizedUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has("topo_session")) {
      url.searchParams.set("topo_session", "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function roleCheck(
  id: "owner-profile" | "customer-profile",
  evidence: StudioProfileEvidence,
): StudioProfileCheck {
  const expected = evidence.expectedRole;
  const matches =
    evidence.headerRole === expected &&
    evidence.cookieRole === expected &&
    evidence.localStorageRole === expected;
  return {
    id,
    status: matches ? "pass" : "fail",
    detail: matches
      ? `${evidence.profileName} headers, cookies, and local storage reached the real iframe.`
      : `${evidence.profileName} profile state did not agree across the gateway boundary.`,
    evidence: {
      expected,
      headerRole: evidence.headerRole ?? "missing",
      cookieRole: evidence.cookieRole ?? "missing",
      localStorageRole: evidence.localStorageRole ?? "missing",
    },
  };
}

export async function runStudioProfileCheck(
  assetsDir: string,
  options: { headless?: boolean } = {},
): Promise<StudioProfileReport> {
  const projectRoot = await createProjectFixture();
  const profiles: GatewayProfile[] = [
    {
      name: "Anonymous",
      headers: { "x-topo-preview-role": "anonymous" },
      localStorage: { "topo:preview-role": "anonymous" },
    },
    {
      name: "Owner",
      headers: { "x-topo-preview-role": "owner" },
      cookies: [{ name: "topo_fixture_role", value: "owner", path: "/" }],
      localStorage: { "topo:preview-role": "owner" },
    },
    {
      name: "Customer",
      headers: { "x-topo-preview-role": "customer" },
      cookies: [{ name: "topo_fixture_role", value: "customer", path: "/" }],
      localStorage: { "topo:preview-role": "customer" },
    },
  ];
  const upstream = createServer((request, response) => {
    const headerRole = String(
      request.headers["x-topo-preview-role"] ?? "missing",
    );
    const cookieRole =
      /(?:^|;\s*)topo_fixture_role=([^;]+)/.exec(
        request.headers.cookie ?? "",
      )?.[1] ?? "missing";
    const body = fixtureHtml(headerRole, cookieRole);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'self'; script-src 'unsafe-inline'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
    });
    response.end(body);
  });
  const upstreamWebSockets = new WebSocketServer({ server: upstream });
  upstreamWebSockets.on("connection", (socket, request) => {
    socket.send(
      JSON.stringify({
        role: String(request.headers["x-topo-preview-role"] ?? "missing"),
        protocol: socket.protocol,
      }),
    );
  });
  let gateway: PreviewGateway | undefined;
  let daemon: TopoDaemon | undefined;
  let studio: TopoStudioHost | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const pageErrors: string[] = [];
  const navigationDiagnostics: string[] = [];

  try {
    const upstreamPort = await listen(upstream);
    gateway = createPreviewGateway({
      targetBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      profiles,
      host: "127.0.0.1",
      port: 0,
      sessionTtlMs: 60_000,
    });
    const sessions = await gateway.listen();
    const config = defineConfig({
      preview: {
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        autoCapture: false,
      },
      profiles,
    });
    daemon = await createDaemon({
      projectRoot,
      config,
      host: "127.0.0.1",
      port: 0,
      watch: false,
      previewSessions: sessions,
      livePreviewBaseUrl: sessions[0]?.baseUrl,
      runDoctor: runDoctorFixture,
    });
    await daemon.listen();
    const daemonUrl = `http://${daemon.host}:${daemon.port}`;
    studio = await startStudioHost({
      assetsDir,
      daemonUrl,
      frameOrigins: sessions.map((session) => session.baseUrl),
      port: 0,
    });
    browser = await chromium.launch({ headless: options.headless ?? true });
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1_440, height: 900 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
      navigationDiagnostics.push(`pageerror ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        navigationDiagnostics.push(`console ${message.text()}`);
      }
    });
    page.on("framenavigated", (frame) =>
      navigationDiagnostics.push(`frame ${sanitizedUrl(frame.url())}`),
    );
    page.on("response", (response) => {
      if (response.url().includes("127.")) {
        navigationDiagnostics.push(
          `response ${response.status()} ${sanitizedUrl(response.url())}`,
        );
      }
    });
    page.on("requestfailed", (request) =>
      navigationDiagnostics.push(
        `failed ${sanitizedUrl(request.url())}: ${request.failure()?.errorText ?? "unknown"}`,
      ),
    );

    const ownerSession = sessions.find(
      (session) => session.profileName === "Owner",
    );
    const customerSession = sessions.find(
      (session) => session.profileName === "Customer",
    );
    if (!ownerSession || !customerSession) {
      throw new Error(
        "Profile verifier did not receive Owner and Customer sessions",
      );
    }
    const owner = await profileEvidence(
      page,
      studio.url,
      ownerSession,
      "owner",
      navigationDiagnostics,
    );
    const customer = await profileEvidence(
      page,
      studio.url,
      customerSession,
      "customer",
      navigationDiagnostics,
    );
    const evidence = [owner, customer];

    let capabilityRecords = 0;
    for (const session of sessions) {
      const token = new URL(session.launchUrl).searchParams.get("topo_session");
      if (!token)
        throw new Error(`Missing launch capability for ${session.profileName}`);
      const response = await fetch(
        `${daemonUrl}/context?q=${encodeURIComponent(token)}&limit=10`,
      );
      const body = (await response.json()) as { items?: unknown[] };
      capabilityRecords += body.items?.length ?? 0;
    }

    const isolatedOrigins = new Set(sessions.map((session) => session.baseUrl))
      .size;
    const cleanNavigation = evidence.every(
      (item) => item.queryCapabilityRemoved,
    );
    const checks: StudioProfileCheck[] = [
      {
        id: "isolated-origins",
        status: isolatedOrigins === sessions.length ? "pass" : "fail",
        detail: `${isolatedOrigins} unique origins exist for ${sessions.length} profiles.`,
        evidence: {
          profiles: sessions.length,
          uniqueOrigins: isolatedOrigins,
          origins: sessions.map((session) => new URL(session.baseUrl).origin),
        },
      },
      roleCheck("owner-profile", owner),
      roleCheck("customer-profile", customer),
      {
        id: "preview-bridge",
        status: evidence.every(
          (item) =>
            item.previewBridgeVersion === 1 &&
            item.anchorRole === "button" &&
            item.anchorAccessibleName === "Open profile actions" &&
            item.anchorTestLocator === '[data-testid="profile-action"]' &&
            /^[a-f0-9]{16}$/.test(item.anchorDomFingerprint ?? ""),
        )
          ? "pass"
          : "fail",
        detail:
          "The signed gateway injected the versioned bridge and returned bounded semantic element evidence from both live iframes.",
        evidence: {
          profiles: evidence.map(
            (item) =>
              `${item.profileName}:v${item.previewBridgeVersion ?? "missing"}:${item.anchorRole ?? "missing"}:${item.anchorAccessibleName ?? "missing"}:${item.anchorTestLocator ?? "missing"}:${item.anchorDomFingerprint ?? "missing"}`,
          ),
        },
      },
      {
        id: "hmr-websocket",
        status: evidence.every(
          (item) =>
            item.webSocketRole === item.expectedRole &&
            item.webSocketProtocol === "vite-hmr",
        )
          ? "pass"
          : "fail",
        detail:
          "Authenticated Vite-style WebSocket traffic traversed both profile gateways.",
        evidence: {
          roles: evidence.map(
            (item) => `${item.profileName}:${item.webSocketRole ?? "missing"}`,
          ),
          protocols: evidence.map(
            (item) =>
              `${item.profileName}:${item.webSocketProtocol ?? "missing"}`,
          ),
        },
      },
      {
        id: "clean-navigation",
        status: cleanNavigation ? "pass" : "fail",
        detail: cleanNavigation
          ? "Opaque launch capabilities were removed after first navigation."
          : "A live iframe retained an opaque launch capability in its URL.",
        evidence: { removed: cleanNavigation },
      },
      {
        id: "llm-capability-exclusion",
        status: capabilityRecords === 0 ? "pass" : "fail",
        detail:
          capabilityRecords === 0
            ? "No opaque preview capability was projected into LLM-readable records."
            : `${capabilityRecords} LLM-readable record(s) contained an opaque capability.`,
        evidence: { matchingRecords: capabilityRecords },
      },
      {
        id: "page-errors",
        status: pageErrors.length === 0 ? "pass" : "fail",
        detail:
          pageErrors.length === 0
            ? "Profile switching and both live iframes emitted no page errors."
            : `${pageErrors.length} page error(s) were observed.`,
        evidence: { errors: pageErrors },
      },
    ];
    const failed = checks.filter((check) => check.status === "fail").length;
    await context.close();
    return {
      schemaVersion: STUDIO_PROFILE_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      status: failed === 0 ? "pass" : "fail",
      browser: { name: "chromium", version: browser.version() },
      profiles: evidence,
      summary: { passed: checks.length - failed, failed, total: checks.length },
      checks,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (studio) await studio.close().catch(() => undefined);
    if (daemon) await daemon.close().catch(() => undefined);
    if (gateway) await gateway.close().catch(() => undefined);
    await new Promise<void>((resolve) =>
      upstreamWebSockets.close(() => resolve()),
    ).catch(() => undefined);
    await closeServer(upstream).catch(() => undefined);
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}
