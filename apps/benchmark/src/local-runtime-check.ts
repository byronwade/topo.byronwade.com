import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import { defineConfig, type TopoProject } from "@topo/config";
import { LLM_CONTEXT_VERSION } from "@topo/llm-context";
import {
  startTopoLocalRuntime,
  type TopoLocalRuntime,
} from "@topo/local-runtime";

export const LOCAL_RUNTIME_REPORT_VERSION = 4 as const;

export type LocalRuntimeCheckId =
  | "local-runtime"
  | "daemon-graph"
  | "profile-gateway"
  | "studio-atlas"
  | "native-live-frame"
  | "dynamic-route-preview"
  | "visual-baseline-comparison"
  | "configured-component-preview"
  | "flow-context"
  | "note-lifecycle"
  | "runtime-shutdown";

export interface LocalRuntimeCheck {
  id: LocalRuntimeCheckId;
  status: "pass" | "fail";
  detail: string;
  evidence: Record<string, boolean | number | string | string[]>;
}

export interface LocalRuntimeReport {
  schemaVersion: typeof LOCAL_RUNTIME_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  fixture: {
    id: "tanstack-router";
    sourceRoot: string;
    projectRoot: string;
  };
  runtime: {
    applicationUrl?: string;
    daemonUrl?: string;
    studioUrl?: string;
    previewOrigins: string[];
  };
  browser: {
    name: "chromium";
    version?: string;
    pageErrors: string[];
    consoleErrors: string[];
    httpErrors: string[];
  };
  screenshot?: string;
  checks: LocalRuntimeCheck[];
  summary: { passed: number; failed: number; total: number };
}

const CHECK_ORDER: readonly LocalRuntimeCheckId[] = [
  "local-runtime",
  "daemon-graph",
  "profile-gateway",
  "studio-atlas",
  "native-live-frame",
  "dynamic-route-preview",
  "visual-baseline-comparison",
  "configured-component-preview",
  "flow-context",
  "note-lifecycle",
  "runtime-shutdown",
];

const EXPECTED_ROUTES = ["/", "/jobs", "/jobs/:jobId", "/settings/profile"];
const EXPECTED_ROUTE_GROUPS = [
  "/:Entry:route:/",
  "workspace:Workspace:route:/jobs,route:/jobs/:jobId,route:/settings/profile",
];
const EXPECTED_ROUTE_SECTIONS = [
  "section:top-level:/",
  "section:configured:workspace:workspace",
];

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Port reservation did not receive a TCP address.");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function originReleased(origin: string): Promise<boolean> {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(1_000) });
    return false;
  } catch {
    return true;
  }
}

async function prepareProject(
  repositoryRoot: string,
  previewPort: number,
): Promise<TopoProject> {
  const sourceRoot = path.join(
    repositoryRoot,
    "apps",
    "playground-tanstack-router",
  );
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), "topo-local-runtime-proof-"),
  );
  await writeFile(
    path.join(projectRoot, "package.json"),
    `${JSON.stringify({ name: "topo-local-runtime-proof", private: true }, null, 2)}\n`,
    "utf8",
  );
  await mkdir(path.join(projectRoot, ".topo"), { recursive: true });
  await cp(
    path.join(sourceRoot, ".topo", "flows"),
    path.join(projectRoot, ".topo", "flows"),
    { recursive: true },
  );
  return {
    projectRoot,
    sourceRoot,
    configPath: path.join(projectRoot, "topo.config.ts"),
    config: defineConfig({
      rootDir: sourceRoot,
      preview: {
        baseUrl: `http://127.0.0.1:${previewPort}`,
        server: { mode: "managed", readyTimeoutMs: 60_000 },
        routes: {
          "/jobs/:jobId": "/jobs/rf-1042",
        },
        components: {
          "src/components/StatusCard.tsx": {
            source: "src/previews/StatusCard.preview.tsx",
            exportName: "ConfiguredStatusCard",
            title: "Configured status card",
          },
        },
      },
      atlas: {
        routeGroups: {
          workspace: {
            label: "Workspace",
            order: 10,
            prefixes: ["/jobs", "/settings"],
          },
        },
      },
      profiles: [{ name: "Anonymous" }],
    }),
  };
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `${init?.method ?? "GET"} ${url} returned ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return (await response.json()) as T;
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const actual = [...left].sort();
  const expected = [...right].sort();
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

async function waitForStudio(page: Page, board: string): Promise<void> {
  await page.locator(`main[data-studio-board="${board}"]`).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.locator('[data-studio-ready="true"]').waitFor({
    state: "attached",
    timeout: 20_000,
  });
  await page.getByText("Daemon connected", { exact: true }).waitFor({
    state: "visible",
    timeout: 20_000,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export async function runLocalRuntimeCheck(
  repositoryRoot: string,
  options: {
    headless?: boolean;
    screenshotPath?: string;
  } = {},
): Promise<LocalRuntimeReport> {
  const checks = new Map<LocalRuntimeCheckId, LocalRuntimeCheck>();
  const record = (check: LocalRuntimeCheck): void => {
    checks.set(check.id, check);
  };
  const previewPort = await reservePort();
  const project = await prepareProject(repositoryRoot, previewPort);
  const studioAssetsDir = path.join(repositoryRoot, "apps", "studio", "dist");
  const screenshotPath = options.screenshotPath
    ? path.resolve(options.screenshotPath)
    : undefined;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  let runtime: TopoLocalRuntime | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let browserVersion: string | undefined;
  let noteCreated = false;
  let flowCreated = false;
  let tracedFlowId: string | undefined;
  let screenshotWritten = false;

  try {
    try {
      runtime = await startTopoLocalRuntime({
        project,
        studioAssetsDir,
        previewPort,
        daemonPort: 0,
        studioPort: 0,
        watch: false,
      });
      const runtimeMatches =
        runtime.application?.ownership === "managed" &&
        runtime.application.adapterId === "tanstack" &&
        new URL(runtime.application.baseUrl).origin ===
          `http://127.0.0.1:${previewPort}` &&
        runtime.studio !== undefined;
      record({
        id: "local-runtime",
        status: runtimeMatches ? "pass" : "fail",
        detail: runtimeMatches
          ? "One runtime handle owns the native app, daemon, gateway, and Studio."
          : "The local stack did not start with the expected managed TanStack runtime.",
        evidence: {
          applicationOwnership: runtime.application?.ownership ?? "missing",
          applicationAdapter: runtime.application?.adapterId ?? "missing",
          daemonPort: runtime.daemon.port,
          studioPort: runtime.studio?.port ?? -1,
          watching: runtime.watching,
        },
      });
    } catch (error) {
      record({
        id: "local-runtime",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error) },
      });
    }

    if (!runtime?.studio) {
      throw new Error("The local runtime did not expose a Studio URL.");
    }

    try {
      const [health, graph, projectSettings] = await Promise.all([
        readJson<{ ok: boolean; version: string }>(
          `${runtime.daemon.url}/health`,
        ),
        readJson<{
          framework: string;
          screens: Array<{ routePath: string }>;
          previewBaseUrl?: string;
        }>(`${runtime.daemon.url}/graph`),
        readJson<{
          schemaVersion: number;
          name: string;
          projectRoot: string;
          sourceRoot: string;
          configPath: string;
          capture: {
            version: number;
            autoCapture: boolean;
            headless: boolean;
            viewport: { width: number; height: number };
          };
        }>(`${runtime.daemon.url}/project`),
      ]);
      const routes = graph.screens.map((screen) => screen.routePath);
      const graphMatches =
        health.ok &&
        graph.framework === "tanstack-router" &&
        sameValues(routes, EXPECTED_ROUTES) &&
        graph.previewBaseUrl === runtime.preview.baseUrl &&
        projectSettings.schemaVersion === 1 &&
        projectSettings.name === "@topo/playground-tanstack-router" &&
        projectSettings.projectRoot === project.projectRoot &&
        projectSettings.sourceRoot === project.sourceRoot &&
        projectSettings.capture.version === 1 &&
        projectSettings.capture.autoCapture &&
        projectSettings.capture.headless &&
        projectSettings.capture.viewport.width === 1440 &&
        projectSettings.capture.viewport.height === 1000;
      record({
        id: "daemon-graph",
        status: graphMatches ? "pass" : "fail",
        detail: graphMatches
          ? "The daemon exposes the exact native TanStack graph and sanitized project capture policy."
          : "The daemon graph or project settings did not match the fixture contract.",
        evidence: {
          health: health.ok,
          framework: graph.framework,
          routes,
          previewBaseUrl: graph.previewBaseUrl ?? "missing",
          projectName: projectSettings.name,
          projectRoot: projectSettings.projectRoot,
          sourceRoot: projectSettings.sourceRoot,
          configPath: projectSettings.configPath,
          capturePolicy: `${projectSettings.capture.autoCapture ? "auto" : "manual"}:${projectSettings.capture.headless ? "headless" : "visible"}:${projectSettings.capture.viewport.width}x${projectSettings.capture.viewport.height}`,
        },
      });
    } catch (error) {
      record({
        id: "daemon-graph",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error) },
      });
    }

    try {
      const sessionResponse = await readJson<{
        sessions: Array<{
          profileName: string;
          baseUrl: string;
          launchUrl: string;
        }>;
      }>(`${runtime.daemon.url}/preview/sessions`);
      const sessions = sessionResponse.sessions;
      const session = sessions[0];
      const gatewayMatches =
        sessions.length === 1 &&
        session?.profileName === "Anonymous" &&
        session.baseUrl === runtime.preview.origins[0] &&
        session.launchUrl.startsWith(session.baseUrl);
      record({
        id: "profile-gateway",
        status: gatewayMatches ? "pass" : "fail",
        detail: gatewayMatches
          ? "The Anonymous profile has one isolated signed loopback gateway."
          : "The profile gateway contract did not match the runtime summary.",
        evidence: {
          sessions: sessions.length,
          profiles: sessions.map((candidate) => candidate.profileName),
          cleanOrigin: session?.baseUrl ?? "missing",
          signedLaunchCapability: Boolean(session?.launchUrl),
        },
      });
    } catch (error) {
      record({
        id: "profile-gateway",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error) },
      });
    }

    browser = await chromium.launch({ headless: options.headless ?? true });
    browserVersion = browser.version();
    context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1_440, height: 900 },
    });
    page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location().url;
      consoleErrors.push(
        location
          ? `${message.text()} @ ${sanitizedUrl(location)}`
          : message.text(),
      );
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        const request = response.request();
        let frameUrl = "unavailable";
        try {
          frameUrl = sanitizedUrl(request.frame().url() || "about:blank");
        } catch {
          // Some service-worker requests do not have a frame.
        }
        httpErrors.push(
          `${response.status()} ${sanitizedUrl(response.url())} [${request.resourceType()}; frame=${frameUrl}]`,
        );
      }
    });

    try {
      await page.goto(new URL("/atlas/routes", runtime.studio.url).toString(), {
        waitUntil: "domcontentloaded",
      });
      await waitForStudio(page, "atlas-routes");
      await page.locator('[data-renderer="pixi-hybrid"] canvas').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.locator("iframe[data-live-frame-id]").waitFor({
        state: "visible",
        timeout: 20_000,
      });
      const [routeScene, routeContext] = await Promise.all([
        readJson<{
          version: number;
          routeMap: {
            sections: Array<{
              id: string;
              groupIds: string[];
            }>;
            groups: Array<{
              id: string;
              label: string;
              routeNodeIds: string[];
            }>;
            routes: Array<{ routePath: string }>;
          };
        }>(`${runtime.daemon.url}/atlas/scene`),
        readJson<{
          items: Array<{
            id: string;
            kind: string;
            routePath?: string;
            relationships: Array<{
              type: string;
              targetKind: string;
              targetId: string;
            }>;
            data: {
              atlas?: {
                hierarchy?: {
                  parentRouteId?: string;
                  childRouteIds?: string[];
                };
              };
            };
          }>;
        }>(`${runtime.daemon.url}/context?kind=route&limit=20`),
      ]);
      const routeSceneGroups = routeScene.routeMap.groups.map(
        (group) => `${group.id}:${group.label}:${group.routeNodeIds.join(",")}`,
      );
      const routeSceneSections = routeScene.routeMap.sections.map(
        (section) => `${section.id}:${section.groupIds.join(",")}`,
      );
      const jobsRouteRecord = routeContext.items.find(
        (item) => item.routePath === "/jobs",
      );
      const jobDetailRouteRecord = routeContext.items.find(
        (item) => item.routePath === "/jobs/:jobId",
      );
      const canonicalHierarchyMatches = Boolean(
        jobsRouteRecord &&
        jobDetailRouteRecord &&
        jobDetailRouteRecord.data.atlas?.hierarchy?.parentRouteId ===
          jobsRouteRecord.id &&
        jobsRouteRecord.data.atlas?.hierarchy?.childRouteIds?.includes(
          jobDetailRouteRecord.id,
        ) &&
        jobDetailRouteRecord.relationships.some(
          (relationship) =>
            relationship.type === "parent-route" &&
            relationship.targetKind === "route" &&
            relationship.targetId === jobsRouteRecord.id,
        ) &&
        jobsRouteRecord.relationships.some(
          (relationship) =>
            relationship.type === "child-route" &&
            relationship.targetKind === "route" &&
            relationship.targetId === jobDetailRouteRecord.id,
        ),
      );
      const pageEvidence = await page.evaluate(() => ({
        canvasMode:
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-canvas-mode") ?? "missing",
        canvases: document.querySelectorAll("canvas").length,
        mountedLiveFrames: document.querySelectorAll(
          "iframe[data-live-frame-id]",
        ).length,
        reportedLiveFrames: Number(
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-live-frame-count") ?? "0",
        ),
        routeMapCount: Number(
          document
            .querySelector(".atlas-pixi-host")
            ?.getAttribute("data-route-count") ?? "0",
        ),
        routeSectionCount: Number(
          document
            .querySelector(".atlas-pixi-host")
            ?.getAttribute("data-section-count") ?? "0",
        ),
        routeLocation:
          document
            .querySelector(".route-canvas-context")
            ?.getAttribute("data-route-location") ?? "",
        routeCount: Number(
          document
            .querySelector(".route-index-summary")
            ?.getAttribute("data-route-count") ?? "0",
        ),
        routeRegionCount: Number(
          document
            .querySelector(".route-index-summary")
            ?.getAttribute("data-region-count") ?? "0",
        ),
        routeAreaCount: Number(
          document
            .querySelector(".route-index-summary")
            ?.getAttribute("data-area-count") ?? "0",
        ),
        routeCountText:
          document.querySelector(".studio-statusbar")?.textContent ?? "",
        hasViteClient: [...document.scripts].some((script) =>
          script.src.includes("/@vite/client"),
        ),
        liveFrames: Number(
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-live-frame-count") ?? "0",
        ),
      }));
      const atlasMatches =
        pageEvidence.canvases === 1 &&
        pageEvidence.canvasMode === "screen" &&
        pageEvidence.mountedLiveFrames === 1 &&
        pageEvidence.reportedLiveFrames === 1 &&
        pageEvidence.routeMapCount === EXPECTED_ROUTES.length &&
        pageEvidence.routeSectionCount === 2 &&
        pageEvidence.routeLocation === "Entry / Entry" &&
        pageEvidence.routeCount === EXPECTED_ROUTES.length &&
        pageEvidence.routeRegionCount === 2 &&
        pageEvidence.routeAreaCount === 2 &&
        pageEvidence.routeCountText.includes("4 routes") &&
        routeScene.version === 4 &&
        routeSceneSections.length === EXPECTED_ROUTE_SECTIONS.length &&
        routeSceneSections.every(
          (section, index) => section === EXPECTED_ROUTE_SECTIONS[index],
        ) &&
        routeSceneGroups.length === EXPECTED_ROUTE_GROUPS.length &&
        routeSceneGroups.every(
          (group, index) => group === EXPECTED_ROUTE_GROUPS[index],
        ) &&
        sameValues(
          routeScene.routeMap.routes.map((route) => route.routePath),
          EXPECTED_ROUTES,
        ) &&
        canonicalHierarchyMatches &&
        !pageEvidence.hasViteClient &&
        pageErrors.length === 0 &&
        consoleErrors.length === 0 &&
        httpErrors.length === 0;
      if (screenshotPath) {
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: false });
        screenshotWritten = true;
      }
      record({
        id: "studio-atlas",
        status: atlasMatches ? "pass" : "fail",
        detail: atlasMatches
          ? "The compiled Studio opened the selected signed live screen in one Pixi canvas while retaining the exact four-route scene-v4 regional atlas contract."
          : "The compiled Studio did not satisfy the connected Atlas contract.",
        evidence: {
          canvases: pageEvidence.canvases,
          canvasMode: pageEvidence.canvasMode,
          mountedLiveFrames: pageEvidence.mountedLiveFrames,
          reportedLiveFrames: pageEvidence.reportedLiveFrames,
          routeMapCount: pageEvidence.routeMapCount,
          routeSectionCount: pageEvidence.routeSectionCount,
          routeLocation: pageEvidence.routeLocation,
          routeCount: pageEvidence.routeCount,
          routeRegionCount: pageEvidence.routeRegionCount,
          routeAreaCount: pageEvidence.routeAreaCount,
          routeSceneSections,
          routeSceneGroups,
          routeSceneVersion: routeScene.version,
          routeScenePaths: routeScene.routeMap.routes.map(
            (route) => route.routePath,
          ),
          canonicalHierarchyMatches,
          parentRouteRecordId: jobsRouteRecord?.id ?? "missing",
          childRouteRecordId: jobDetailRouteRecord?.id ?? "missing",
          routeCountText: pageEvidence.routeCountText,
          hasViteClient: pageEvidence.hasViteClient,
          pageErrors,
          consoleErrors,
          httpErrors,
        },
      });
    } catch (error) {
      record({
        id: "studio-atlas",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error), pageErrors, consoleErrors },
      });
    }

    try {
      const initialSelection = await page
        .locator(".screen-canvas")
        .getAttribute("data-selected-screen-id");
      if (!initialSelection) {
        throw new Error("Studio did not expose its selected screen identity.");
      }
      await page.getByRole("button", { name: "Map", exact: true }).click();
      await page.locator('[data-canvas-mode="map"]').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.waitForFunction(
        () =>
          document.querySelectorAll("iframe[data-live-frame-id]").length === 0,
      );
      const mapEvidence = await page.evaluate(() => ({
        canvasMode:
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-canvas-mode") ?? "missing",
        canvasQuery: new URL(window.location.href).searchParams.get("canvas"),
        mountedLiveFrames: document.querySelectorAll(
          "iframe[data-live-frame-id]",
        ).length,
        reportedLiveFrames: Number(
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-live-frame-count") ?? "0",
        ),
        selectedScreen:
          document
            .querySelector(".screen-canvas")
            ?.getAttribute("data-selected-screen-id") ?? null,
        selectionQuery: new URL(window.location.href).searchParams.get(
          "screen",
        ),
      }));

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForStudio(page, "atlas-routes");
      await page.locator('[data-canvas-mode="map"]').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      const reloadedMapEvidence = await page.evaluate(() => ({
        canvasMode:
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-canvas-mode") ?? "missing",
        canvasQuery: new URL(window.location.href).searchParams.get("canvas"),
        mountedLiveFrames: document.querySelectorAll(
          "iframe[data-live-frame-id]",
        ).length,
        reportedLiveFrames: Number(
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-live-frame-count") ?? "0",
        ),
        selectedScreen:
          document
            .querySelector(".screen-canvas")
            ?.getAttribute("data-selected-screen-id") ?? null,
        selectionQuery: new URL(window.location.href).searchParams.get(
          "screen",
        ),
      }));

      await page.getByRole("button", { name: "Screen", exact: true }).click();
      await page.locator('[data-canvas-mode="screen"]').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.locator("iframe[data-live-frame-id]").waitFor({
        state: "visible",
        timeout: 20_000,
      });
      const liveFrame = page
        .frames()
        .find(
          (frame) =>
            frame !== page!.mainFrame() &&
            runtime!.preview.origins.some((origin) =>
              frame.url().startsWith(origin),
            ),
        );
      if (!liveFrame)
        throw new Error("Studio did not promote a live application frame.");
      await liveFrame.locator('[data-topo-screen="overview"]').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      const identity = await liveFrame
        .locator('[data-topo-screen="overview"]')
        .getAttribute("data-topo-screen");
      const screenEvidence = await page.evaluate(() => ({
        canvasMode:
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-canvas-mode") ?? "missing",
        mountedLiveFrames: document.querySelectorAll(
          "iframe[data-live-frame-id]",
        ).length,
        reportedLiveFrames: Number(
          document
            .querySelector('[data-renderer="pixi-hybrid"]')
            ?.getAttribute("data-live-frame-count") ?? "0",
        ),
        canvasQuery: new URL(window.location.href).searchParams.get("canvas"),
        selectedScreen:
          document
            .querySelector(".screen-canvas")
            ?.getAttribute("data-selected-screen-id") ?? null,
        selectionQuery: new URL(window.location.href).searchParams.get(
          "screen",
        ),
      }));
      const liveFrameMatches =
        mapEvidence.canvasMode === "map" &&
        mapEvidence.canvasQuery === "map" &&
        mapEvidence.mountedLiveFrames === 0 &&
        mapEvidence.reportedLiveFrames === 0 &&
        mapEvidence.selectedScreen === initialSelection &&
        reloadedMapEvidence.canvasMode === "map" &&
        reloadedMapEvidence.canvasQuery === "map" &&
        reloadedMapEvidence.mountedLiveFrames === 0 &&
        reloadedMapEvidence.reportedLiveFrames === 0 &&
        reloadedMapEvidence.selectedScreen === initialSelection &&
        identity === "overview" &&
        screenEvidence.canvasMode === "screen" &&
        screenEvidence.mountedLiveFrames === 1 &&
        screenEvidence.reportedLiveFrames === 1 &&
        screenEvidence.canvasQuery === null &&
        screenEvidence.selectedScreen === initialSelection;
      record({
        id: "native-live-frame",
        status: liveFrameMatches ? "pass" : "fail",
        detail: liveFrameMatches
          ? "Studio preserved exact selection through a reload-safe zero-frame route map and returned to the gateway-backed native overview screen."
          : "The Screen-to-Map-to-Screen round trip lost its presentation, frame boundary, or selected native screen.",
        evidence: {
          initialCanvasMode: "screen",
          initialSelectedScreen: initialSelection ?? "missing",
          mapCanvasMode: mapEvidence.canvasMode,
          mapQuery: mapEvidence.canvasQuery ?? "missing",
          mapSelectedScreen: mapEvidence.selectedScreen ?? "missing",
          mapSelectionQuery: mapEvidence.selectionQuery ?? "none",
          mapMountedLiveFrames: mapEvidence.mountedLiveFrames,
          mapReportedLiveFrames: mapEvidence.reportedLiveFrames,
          reloadedMapCanvasMode: reloadedMapEvidence.canvasMode,
          reloadedMapQuery: reloadedMapEvidence.canvasQuery ?? "missing",
          reloadedMapSelectedScreen:
            reloadedMapEvidence.selectedScreen ?? "missing",
          reloadedMapSelectionQuery:
            reloadedMapEvidence.selectionQuery ?? "none",
          finalCanvasMode: screenEvidence.canvasMode,
          finalCanvasQuery: screenEvidence.canvasQuery ?? "none",
          finalSelectedScreen: screenEvidence.selectedScreen ?? "missing",
          finalSelectionQuery: screenEvidence.selectionQuery ?? "none",
          frameUrl: sanitizedUrl(liveFrame.url()),
          mountedLiveFrames: screenEvidence.mountedLiveFrames,
          reportedLiveFrames: screenEvidence.reportedLiveFrames,
          screenIdentity: identity ?? "missing",
        },
      });
    } catch (error) {
      record({
        id: "native-live-frame",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error) },
      });
    }

    try {
      const graph = await readJson<{
        screens: Array<{ id: string; routePath: string }>;
      }>(`${runtime.daemon.url}/graph`);
      const screen = graph.screens.find(
        (candidate) => candidate.routePath === "/",
      );
      if (!screen) throw new Error("The overview screen was not discovered.");

      const captured = await readJson<{
        snapshots: Array<{
          routePath: string;
          previewPath?: string;
          status: string;
        }>;
        failures: Array<{ routePath: string; error: string }>;
      }>(`${runtime.daemon.url}/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: "Anonymous" }),
      });
      const dynamicSnapshot = captured.snapshots.find(
        (snapshot) => snapshot.routePath === "/jobs/:jobId",
      );
      const dynamicRouteMatches =
        dynamicSnapshot?.status === "captured" &&
        dynamicSnapshot.previewPath === "/jobs/rf-1042" &&
        !captured.failures.some(
          (failure) => failure.routePath === "/jobs/:jobId",
        );
      record({
        id: "dynamic-route-preview",
        status: dynamicRouteMatches ? "pass" : "fail",
        detail: dynamicRouteMatches
          ? "The canonical parameterized route was captured through its project-owned concrete preview path."
          : "The parameterized route did not produce a successful concrete-path capture.",
        evidence: {
          routePath: dynamicSnapshot?.routePath ?? "/jobs/:jobId",
          previewPath: dynamicSnapshot?.previewPath ?? "missing",
          captureStatus: dynamicSnapshot?.status ?? "missing",
          routeFailures: captured.failures.filter(
            (failure) => failure.routePath === "/jobs/:jobId",
          ).length,
        },
      });
      const accepted = await readJson<{
        baseline: { id: string; contentHash: string };
        comparison: { id: string; status: string };
      }>(`${runtime.daemon.url}/visuals/baseline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ screenId: screen.id }),
      });
      const recapture = await readJson<{
        comparisons: Array<{
          id: string;
          screenId: string;
          status: string;
          changedPixels: number;
          totalPixels: number;
          changeRatio: number;
        }>;
      }>(`${runtime.daemon.url}/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: "Anonymous" }),
      });
      const [visuals, visualContext] = await Promise.all([
        readJson<{
          baselines: Array<{
            id: string;
            screenId: string;
            imageUrl?: string;
          }>;
          comparisons: Array<{
            id: string;
            screenId: string;
            status: string;
            changedPixels: number;
          }>;
        }>(`${runtime.daemon.url}/visuals`),
        readJson<{
          manifest: { schemaVersion: number };
          items: Array<{ id: string; kind: string; data?: unknown }>;
        }>(
          `${runtime.daemon.url}/context?kind=visual-baseline,visual-comparison&route=/&limit=10`,
        ),
      ]);
      const baseline = visuals.baselines.find(
        (candidate) => candidate.screenId === screen.id,
      );
      const comparison = visuals.comparisons.find(
        (candidate) => candidate.screenId === screen.id,
      );
      const baselineImage = baseline?.imageUrl
        ? await fetch(baseline.imageUrl)
        : undefined;
      await page.goto(new URL("/atlas/routes", runtime.studio.url).toString(), {
        waitUntil: "domcontentloaded",
      });
      await waitForStudio(page, "atlas-routes");
      const visualStatus = await page
        .locator("[data-visual-comparison-status]")
        .getAttribute("data-visual-comparison-status");
      const comparisonRecord = visualContext.items.find(
        (item) =>
          item.kind === "visual-comparison" && item.id === comparison?.id,
      );
      const baselineRecord = visualContext.items.find(
        (item) => item.kind === "visual-baseline" && item.id === baseline?.id,
      );
      const recapturedComparison = recapture.comparisons.find(
        (candidate) => candidate.screenId === screen.id,
      );
      const matches =
        accepted.baseline.id === baseline?.id &&
        accepted.comparison.status === "unchanged" &&
        recapturedComparison?.status === "unchanged" &&
        recapturedComparison.changedPixels === 0 &&
        recapturedComparison.changeRatio === 0 &&
        baselineImage?.ok === true &&
        baselineImage.headers.get("content-type") === "image/png" &&
        visualStatus === "unchanged" &&
        visualContext.manifest.schemaVersion === LLM_CONTEXT_VERSION &&
        Boolean(baselineRecord) &&
        Boolean(comparisonRecord);
      record({
        id: "visual-baseline-comparison",
        status: matches ? "pass" : "fail",
        detail: matches
          ? "A real screen capture became an accepted local baseline, a hash-fast comparison, Studio review state, and two LLM records."
          : "Visual baseline evidence did not reach every runtime representation.",
        evidence: {
          screenId: screen.id,
          baselineId: baseline?.id ?? "missing",
          comparisonId: comparison?.id ?? "missing",
          comparisonStatus: comparison?.status ?? "missing",
          changedPixels: recapturedComparison?.changedPixels ?? -1,
          totalPixels: recapturedComparison?.totalPixels ?? -1,
          baselineImageStatus: baselineImage?.status ?? -1,
          studioStatus: visualStatus ?? "missing",
          contextSchemaVersion: visualContext.manifest.schemaVersion,
          baselineContext: Boolean(baselineRecord),
          comparisonContext: Boolean(comparisonRecord),
        },
      });
    } catch (error) {
      if (!checks.has("dynamic-route-preview")) {
        record({
          id: "dynamic-route-preview",
          status: "fail",
          detail: errorMessage(error),
          evidence: { error: errorMessage(error) },
        });
      }
      record({
        id: "visual-baseline-comparison",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error) },
      });
    }

    try {
      const graph = await readJson<{
        components: Array<{
          id: string;
          name: string;
          previewStatus: string;
          previewSources: Array<{
            id: string;
            title: string;
            discovery?: string;
          }>;
        }>;
      }>(`${runtime.daemon.url}/graph`);
      const component = graph.components.find(
        (candidate) => candidate.name === "StatusCard",
      );
      if (!component) {
        throw new Error("Configured StatusCard was not present in the graph.");
      }
      const preview = component.previewSources.find(
        (candidate) => candidate.discovery === "configured",
      );
      if (!preview) {
        throw new Error(
          "StatusCard did not retain configured-preview provenance.",
        );
      }
      const capture = await readJson<{
        artifacts: Array<{
          id: string;
          targetId: string;
          previewId: string;
          status: string;
          contentHash?: string;
        }>;
        failures: unknown[];
      }>(`${runtime.daemon.url}/capture/components`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          componentIds: [component.id],
          profile: "Anonymous",
        }),
      });
      const artifact = capture.artifacts.find(
        (candidate) => candidate.previewId === preview.id,
      );
      const [previewResources, contextResult] = await Promise.all([
        readJson<{
          previewArtifacts: Array<{
            id: string;
            status: string;
            imageUrl?: string;
          }>;
        }>(`${runtime.daemon.url}/component-previews`),
        readJson<{
          items: Array<{
            kind: string;
            id: string;
            data?: {
              previewSources?: Array<{ discovery?: string }>;
              resourceUri?: string;
            };
          }>;
        }>(
          `${runtime.daemon.url}/context?kind=component,component-preview&limit=50`,
        ),
      ]);
      const previewResource = previewResources.previewArtifacts.find(
        (candidate) => candidate.id === artifact?.id,
      );
      const imageResponse = previewResource?.imageUrl
        ? await fetch(previewResource.imageUrl)
        : undefined;
      const componentPreviewUrl = new URL(
        "/atlas/components",
        runtime.studio.url,
      );
      componentPreviewUrl.searchParams.set("component", component.id);
      componentPreviewUrl.searchParams.set("preview", preview.id);
      await page.goto(componentPreviewUrl.toString(), {
        waitUntil: "domcontentloaded",
      });
      await waitForStudio(page, "atlas-components");
      const componentPreviewStage = page
        .locator('[data-component-preview-kind="captured"]')
        .first();
      await componentPreviewStage.waitFor({
        state: "visible",
        timeout: 20_000,
      });
      const studioSelection = await componentPreviewStage.evaluate(
        (element) => ({
          componentId: element.getAttribute("data-selected-component-id"),
          previewId: element.getAttribute("data-selected-preview-id"),
          previewKind: element.getAttribute("data-component-preview-kind"),
        }),
      );
      const componentRecord = contextResult.items.find(
        (item) => item.kind === "component" && item.id === component.id,
      );
      const previewRecord = contextResult.items.find(
        (item) => item.kind === "component-preview" && item.id === artifact?.id,
      );
      const matches =
        component.previewStatus === "renderable" &&
        capture.failures.length === 0 &&
        artifact?.status === "captured" &&
        Boolean(artifact.contentHash) &&
        imageResponse?.ok === true &&
        imageResponse.headers.get("content-type") === "image/png" &&
        componentRecord?.data?.previewSources?.some(
          (source) => source.discovery === "configured",
        ) === true &&
        Boolean(previewRecord?.data?.resourceUri) &&
        studioSelection.componentId === component.id &&
        studioSelection.previewId === preview.id &&
        studioSelection.previewKind === "captured";
      record({
        id: "configured-component-preview",
        status: matches ? "pass" : "fail",
        detail: matches
          ? "A keyed config entry became graph provenance, a real Chromium PNG, Studio state, and bounded LLM context."
          : "The configured component preview did not reach every runtime representation.",
        evidence: {
          componentId: component.id,
          previewId: preview.id,
          discovery: preview.discovery ?? "missing",
          captureStatus: artifact?.status ?? "missing",
          captureFailures: capture.failures.length,
          imageStatus: imageResponse?.status ?? -1,
          studioObserved:
            studioSelection.componentId === component.id &&
            studioSelection.previewId === preview.id &&
            studioSelection.previewKind === "captured",
          studioComponentId: studioSelection.componentId ?? "missing",
          studioPreviewId: studioSelection.previewId ?? "missing",
          studioPreviewKind: studioSelection.previewKind ?? "missing",
          componentContext: Boolean(componentRecord),
          previewContext: Boolean(previewRecord?.data?.resourceUri),
        },
      });
    } catch (error) {
      record({
        id: "configured-component-preview",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error) },
      });
    }

    try {
      const [flows, contextResult] = await Promise.all([
        readJson<{ flows: Array<{ id: string; steps: unknown[] }> }>(
          `${runtime.daemon.url}/flows`,
        ),
        readJson<{
          items: Array<{ kind: string; id: string }>;
        }>(`${runtime.daemon.url}/context?kind=flow,flow-step&limit=10`),
      ]);
      await page.goto(new URL("/atlas/flows", runtime.studio.url).toString(), {
        waitUntil: "domcontentloaded",
      });
      await waitForStudio(page, "atlas-flows");
      await page.getByText("Review a job", { exact: true }).first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.locator('[data-renderer="pixi-topology"] canvas').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      const flow = flows.flows.find(
        (candidate) => candidate.id === "review-job",
      );
      const flowRecords = contextResult.items.filter(
        (item) => item.kind === "flow",
      );
      const stepRecords = contextResult.items.filter(
        (item) => item.kind === "flow-step",
      );
      const flowMatches =
        flow?.steps.length === 3 &&
        flowRecords.length === 1 &&
        stepRecords.length === 3;
      const authoredFlowId = "local-runtime-flow";
      const authoredFlowTitle = "Live branching flow";
      await readJson(`${runtime.daemon.url}/flows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: authoredFlowId,
          title: authoredFlowTitle,
          entryStepId: "open",
          steps: [
            {
              id: "open",
              title: "Open jobs",
              routePath: "/jobs",
              noteIds: [],
              nextStepIds: [],
            },
          ],
        }),
      });
      flowCreated = true;
      const authoredFlowListEntry = page
        .locator(".flow-list")
        .getByText(authoredFlowTitle, { exact: true });
      await authoredFlowListEntry.waitFor({
        state: "visible",
        timeout: 20_000,
      });
      const updatedFlow = await readJson<{
        status: string;
        steps: Array<{ id: string; nextStepIds: string[] }>;
      }>(`${runtime.daemon.url}/flows/${authoredFlowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "verified",
          steps: [
            {
              id: "open",
              title: "Open jobs",
              routePath: "/jobs",
              noteIds: [],
              nextStepIds: ["inspect"],
            },
            {
              id: "inspect",
              title: "Inspect a job",
              routePath: "/jobs/:jobId",
              noteIds: [],
              nextStepIds: [],
            },
          ],
        }),
      });
      const authoredContext = await readJson<{
        items: Array<{ kind: string; id: string }>;
      }>(
        `${runtime.daemon.url}/context?kind=flow,flow-step&q=${authoredFlowId}&limit=10`,
      );
      const authoredContextKinds = authoredContext.items.map(
        (item) => item.kind,
      );
      const deleteResponse = await fetch(
        `${runtime.daemon.url}/flows/${authoredFlowId}`,
        { method: "DELETE" },
      );
      if (deleteResponse.status !== 204) {
        throw new Error(
          `DELETE flow returned ${deleteResponse.status}: ${await deleteResponse.text()}`,
        );
      }
      flowCreated = false;
      await authoredFlowListEntry.waitFor({
        state: "hidden",
        timeout: 20_000,
      });
      const deletedFlowStatus = (
        await fetch(`${runtime.daemon.url}/flows/${authoredFlowId}`)
      ).status;
      const lifecycleMatches =
        updatedFlow.status === "verified" &&
        updatedFlow.steps.length === 2 &&
        updatedFlow.steps[0]?.nextStepIds[0] === "inspect" &&
        authoredContextKinds.filter((kind) => kind === "flow").length === 1 &&
        authoredContextKinds.filter((kind) => kind === "flow-step").length ===
          2 &&
        deleteResponse.status === 204 &&
        deletedFlowStatus === 404;

      await page
        .getByRole("button", { name: "Trace flow", exact: true })
        .click();
      await waitForStudio(page, "atlas-routes");
      const traceHud = page.locator('[data-flow-trace-state="recording"]');
      await traceHud.waitFor({ state: "visible", timeout: 20_000 });
      const previewFrame = page.frameLocator("iframe[data-live-frame-id]");
      await previewFrame.locator('[data-topo-screen="overview"]').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await previewFrame
        .getByRole("link", { name: "Explore jobs", exact: true })
        .click();
      await previewFrame.locator('[data-topo-screen="jobs"]').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-flow-trace-state="recording"]')
            ?.getAttribute("data-flow-trace-step-count") === "2",
      );
      await previewFrame.locator(".fixture-job-list a").first().click();
      await previewFrame.locator('[data-topo-screen="job-detail"]').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-flow-trace-state="recording"]')
            ?.getAttribute("data-flow-trace-step-count") === "3",
      );
      await traceHud.locator("button.is-primary").click();
      await waitForStudio(page, "atlas-flows");
      await page
        .getByText("Review a job trace", { exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
      tracedFlowId = new URL(page.url()).searchParams.get("flow") ?? undefined;
      if (!tracedFlowId) {
        throw new Error("The recorded flow did not expose its durable id.");
      }
      const tracedFlow = await readJson<{
        title: string;
        steps: Array<{
          routePath?: string;
          nextStepIds: string[];
        }>;
      }>(`${runtime.daemon.url}/flows/${tracedFlowId}`);
      const tracedContext = await readJson<{
        items: Array<{ kind: string; id: string }>;
      }>(
        `${runtime.daemon.url}/context?kind=flow,flow-step&q=${encodeURIComponent(tracedFlowId)}&limit=10`,
      );
      const tracedKinds = tracedContext.items.map((item) => item.kind);
      const traceMatches =
        tracedFlow.title === "Review a job trace" &&
        sameValues(
          tracedFlow.steps.map((step) => step.routePath ?? ""),
          ["/", "/jobs", "/jobs/:jobId"],
        ) &&
        tracedFlow.steps[0]?.nextStepIds[0] === "step-2" &&
        tracedFlow.steps[1]?.nextStepIds[0] === "step-3" &&
        tracedFlow.steps[2]?.nextStepIds.length === 0 &&
        tracedKinds.filter((kind) => kind === "flow").length === 1 &&
        tracedKinds.filter((kind) => kind === "flow-step").length === 3;
      const tracedDeleteResponse = await fetch(
        `${runtime.daemon.url}/flows/${tracedFlowId}`,
        { method: "DELETE" },
      );
      if (tracedDeleteResponse.status !== 204) {
        throw new Error(
          `DELETE traced flow returned ${tracedDeleteResponse.status}: ${await tracedDeleteResponse.text()}`,
        );
      }
      tracedFlowId = undefined;
      record({
        id: "flow-context",
        status:
          flowMatches && lifecycleMatches && traceMatches ? "pass" : "fail",
        detail:
          flowMatches && lifecycleMatches && traceMatches
            ? "Checked-in, live-authored, and signed-preview-traced flows agree across JSON, daemon mutation, Studio SSE, and LLM records."
            : "Flow source, mutation lifecycle, preview trace, Studio, and LLM context did not agree.",
        evidence: {
          sourceSteps: flow?.steps.length ?? 0,
          flowRecords: flowRecords.length,
          stepRecords: stepRecords.length,
          authoredStatus: updatedFlow.status,
          authoredSteps: updatedFlow.steps.length,
          authoredContextFlows: authoredContextKinds.filter(
            (kind) => kind === "flow",
          ).length,
          authoredContextSteps: authoredContextKinds.filter(
            (kind) => kind === "flow-step",
          ).length,
          studioObserved: true,
          deletedStatus: deletedFlowStatus,
          tracedTitle: tracedFlow.title,
          tracedSteps: tracedFlow.steps.length,
          tracedRoutes: tracedFlow.steps.map((step) => step.routePath ?? ""),
          tracedContextFlows: tracedKinds.filter((kind) => kind === "flow")
            .length,
          tracedContextSteps: tracedKinds.filter((kind) => kind === "flow-step")
            .length,
        },
      });
    } catch (error) {
      record({
        id: "flow-context",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error) },
      });
    }

    try {
      await page.goto(new URL("/notes", runtime.studio.url).toString(), {
        waitUntil: "domcontentloaded",
      });
      await waitForStudio(page, "notes-all");
      const noteId = "local-runtime-proof";
      const noteTitle = "Local runtime proof note";
      await readJson(`${runtime.daemon.url}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: noteId,
          type: "screen",
          title: noteTitle,
          body: "Created through the live daemon and observed by Studio.",
          targetKind: "screen",
          targetRoute: "/",
          author: "runtime-verifier",
          anchor: {
            status: "attached",
            source: { filePath: "src/routes/index.tsx", line: 1 },
          },
        }),
      });
      noteCreated = true;
      await page.getByText(noteTitle, { exact: true }).waitFor({
        state: "visible",
        timeout: 20_000,
      });
      const [noteSource, noteContext] = await Promise.all([
        readFile(
          path.join(project.projectRoot, ".topo", "notes", `${noteId}.md`),
          "utf8",
        ),
        readJson<{ items: Array<{ id: string; kind: string }> }>(
          `${runtime.daemon.url}/context?kind=note&q=${encodeURIComponent(noteId)}&limit=10`,
        ),
      ]);
      const persisted =
        noteSource.includes(noteTitle) &&
        noteContext.items.some(
          (item) => item.kind === "note" && item.id.includes(noteId),
        );
      const deleteResponse = await fetch(
        `${runtime.daemon.url}/notes/${encodeURIComponent(noteId)}`,
        { method: "DELETE" },
      );
      if (deleteResponse.status !== 204) {
        throw new Error(`DELETE note returned ${deleteResponse.status}`);
      }
      noteCreated = false;
      await page.getByText(noteTitle, { exact: true }).waitFor({
        state: "detached",
        timeout: 20_000,
      });
      record({
        id: "note-lifecycle",
        status: persisted ? "pass" : "fail",
        detail: persisted
          ? "A daemon mutation became Markdown, LLM context, and live Studio state before clean deletion."
          : "The note did not reach every durable and live representation.",
        evidence: {
          markdown: noteSource.includes(noteTitle),
          contextRecord: noteContext.items.some((item) => item.kind === "note"),
          studioObserved: true,
          deleted: true,
        },
      });
    } catch (error) {
      record({
        id: "note-lifecycle",
        status: "fail",
        detail: errorMessage(error),
        evidence: { error: errorMessage(error) },
      });
    }
  } catch (error) {
    const detail = errorMessage(error);
    for (const id of CHECK_ORDER.slice(1, -1)) {
      if (!checks.has(id)) {
        record({
          id,
          status: "fail",
          detail: `Not reached: ${detail}`,
          evidence: { error: detail },
        });
      }
    }
  } finally {
    if (flowCreated && runtime) {
      await fetch(`${runtime.daemon.url}/flows/local-runtime-flow`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    if (tracedFlowId && runtime) {
      await fetch(`${runtime.daemon.url}/flows/${tracedFlowId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    if (noteCreated && runtime) {
      await fetch(`${runtime.daemon.url}/notes/local-runtime-proof`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);

    const origins = runtime
      ? [
          runtime.application?.baseUrl,
          runtime.daemon.url,
          runtime.studio?.url,
          ...runtime.preview.origins,
        ].filter((origin): origin is string => Boolean(origin))
      : [];
    let closeError: string | undefined;
    if (runtime) {
      try {
        await runtime.close();
      } catch (error) {
        closeError = errorMessage(error);
      }
    }
    const released = await Promise.all(origins.map(originReleased));
    const allReleased = runtime !== undefined && released.every(Boolean);
    record({
      id: "runtime-shutdown",
      status: allReleased && !closeError ? "pass" : "fail",
      detail:
        allReleased && !closeError
          ? "One idempotent close released the app, daemon, Studio, and profile gateway origins."
          : (closeError ??
            "At least one local runtime origin remained reachable."),
      evidence: {
        origins,
        released: released.map(String),
        closeError: closeError ?? "none",
      },
    });
  }

  const orderedChecks = CHECK_ORDER.map((id) => checks.get(id)).filter(
    (check): check is LocalRuntimeCheck => Boolean(check),
  );
  const failed = orderedChecks.filter(
    (check) => check.status === "fail",
  ).length;
  const report: LocalRuntimeReport = {
    schemaVersion: LOCAL_RUNTIME_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    status: failed === 0 ? "pass" : "fail",
    fixture: {
      id: "tanstack-router",
      sourceRoot: project.sourceRoot,
      projectRoot: project.projectRoot,
    },
    runtime: {
      applicationUrl: runtime?.application?.baseUrl,
      daemonUrl: runtime?.daemon.url,
      studioUrl: runtime?.studio?.url,
      previewOrigins: [...(runtime?.preview.origins ?? [])],
    },
    browser: {
      name: "chromium",
      version: browserVersion,
      pageErrors,
      consoleErrors,
      httpErrors,
    },
    ...(screenshotWritten && screenshotPath
      ? { screenshot: screenshotPath }
      : {}),
    checks: orderedChecks,
    summary: {
      passed: orderedChecks.length - failed,
      failed,
      total: orderedChecks.length,
    },
  };
  await rm(project.projectRoot, { recursive: true, force: true });
  return report;
}
