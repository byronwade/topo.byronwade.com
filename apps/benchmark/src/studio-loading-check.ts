import { chromium } from "playwright";

import {
  inspectStudioBuild,
  startStudioHost,
  type StudioBuildReport,
} from "@topo/studio-host";

export const STUDIO_LOADING_REPORT_VERSION = 2 as const;

export interface StudioLoadingCheck {
  id:
    | "offline-project-is-empty"
    | "invalid-graph-is-rejected"
    | "offline-excludes-demo-evidence"
    | "offline-writes-require-daemon"
    | "notes-destination-requested"
    | "notes-excludes-pixi"
    | "atlas-destination-requested"
    | "atlas-loads-pixi"
    | "page-errors";
  status: "pass" | "fail";
  detail: string;
  evidence: Record<string, boolean | number | string | string[]>;
}

export interface StudioLoadingReport {
  schemaVersion: typeof STUDIO_LOADING_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  browser: {
    name: "chromium";
    version: string;
  };
  offline: {
    readyMs: number;
    mode: string;
    routeCount: number;
    componentCount: number;
    forbiddenTerms: string[];
    graphError: string;
    noteCountAfterWrite: number;
    writeError: string;
  };
  notes: {
    readyMs: number;
    requestedAssets: string[];
    pixiAssets: string[];
  };
  atlas: {
    readyMs: number;
    requestedAssets: string[];
    pixiAssets: string[];
  };
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  checks: StudioLoadingCheck[];
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

function destinationFile(build: StudioBuildReport, source: string): string {
  const asset = build.destinations.find(
    (candidate) => candidate.source === source,
  );
  if (!asset) throw new Error(`Studio destination asset is missing: ${source}`);
  return asset.file;
}

export async function runStudioLoadingCheck(
  assetsDir: string,
  options: { headless?: boolean } = {},
): Promise<StudioLoadingReport> {
  const build = await inspectStudioBuild(assetsDir);
  if (build.status !== "pass") {
    throw new Error(
      "Studio runtime loading proof requires a passing build report",
    );
  }

  const host = await startStudioHost({
    assetsDir,
    daemonUrl: "http://127.0.0.1:4599",
    port: 0,
  });
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width: 1_440, height: 900 },
  });
  const page = await context.newPage();
  await page.route("http://127.0.0.1:4599/graph", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        version: 1,
        generatedAt: "not-a-date",
        rootDir: "C:/malformed-daemon-project",
        previewBaseUrl: "http://127.0.0.1:3000",
        framework: "next-app",
        screens: [
          {
            id: "next-app:/:default:app/page.tsx",
            kind: "screen",
            title: "Malformed daemon screen",
            routePath: "/",
            framework: "next-app",
            state: "default",
            group: "/",
            source: { filePath: "app/page.tsx", line: 1 },
            renderStatus: "unseen",
            tags: [],
          },
        ],
        components: [],
        edges: [],
        findings: [],
      }),
    });
  });
  const requestedAssets: string[] = [];
  const pageErrors: string[] = [];
  page.on("response", (response) => {
    const asset = assetPath(response.url());
    if (asset) requestedAssets.push(asset);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    const pixiFiles = new Set(build.pixi.assets.map((asset) => asset.file));
    const notesFile = destinationFile(
      build,
      "src/components/NotesWorkspace.tsx",
    );
    const atlasFile = destinationFile(
      build,
      "src/components/AtlasWorkspace.tsx",
    );

    const offlineStartedAt = performance.now();
    await page.goto(`${host.url}/welcome`, {
      waitUntil: "domcontentloaded",
    });
    const offlineStudio = page.locator('main[data-topo-data-mode="offline"]');
    await offlineStudio.waitFor({ state: "visible", timeout: 15_000 });
    await page.locator(".welcome-card").waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const offlineReadyMs = performance.now() - offlineStartedAt;
    const offlineEvidence = await offlineStudio.evaluate((element) => ({
      mode: element.getAttribute("data-topo-data-mode") ?? "missing",
      routeCount: Number(element.getAttribute("data-topo-route-count") ?? -1),
      componentCount: Number(
        element.getAttribute("data-topo-component-count") ?? -1,
      ),
      text: (element as HTMLElement).innerText,
    }));
    const forbiddenTerms = [
      "Fieldbase is loaded",
      "fixture fallback",
      "demo://fieldbase-web",
      "fieldbase-web is scanned",
    ].filter((term) => offlineEvidence.text.includes(term));
    const graphErrorLocator = page.locator(".global-error");
    await graphErrorLocator.waitFor({ state: "visible", timeout: 5_000 });
    const graphError = (await graphErrorLocator.textContent())?.trim() ?? "";

    await page.goto(`${host.url}/atlas/routes?overlay=annotate`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('main[data-topo-data-mode="offline"]')
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-note-preset="canvas-note"]').click();
    await page
      .getByRole("form", { name: "Compose Canvas note" })
      .getByPlaceholder("What should change?")
      .fill("Disconnected write must fail");
    await page.getByRole("button", { name: "Create note" }).click();
    const writeErrorLocator = page.locator(".global-error");
    await writeErrorLocator.waitFor({ state: "visible", timeout: 5_000 });
    const writeError = (await writeErrorLocator.textContent())?.trim() ?? "";
    const noteCountAfterWrite = Number(
      (await page
        .locator("main[data-topo-note-count]")
        .getAttribute("data-topo-note-count")) ?? -1,
    );

    requestedAssets.length = 0;

    const notesStartedAt = performance.now();
    await page.goto(`${host.url}/notes?demo=1`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".notes-index-view").waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const notesReadyMs = performance.now() - notesStartedAt;
    const notesAssets = [...new Set(requestedAssets)].sort();
    const notesPixiAssets = notesAssets.filter((asset) => pixiFiles.has(asset));

    requestedAssets.length = 0;
    const atlasStartedAt = performance.now();
    await page.goto(`${host.url}/atlas/flows?demo=1`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-renderer="pixi-topology"] canvas').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const atlasReadyMs = performance.now() - atlasStartedAt;
    const atlasAssets = [...new Set(requestedAssets)].sort();
    const atlasPixiAssets = atlasAssets.filter((asset) => pixiFiles.has(asset));

    const checks: StudioLoadingCheck[] = [
      {
        id: "offline-project-is-empty",
        status:
          offlineEvidence.mode === "offline" &&
          offlineEvidence.routeCount === 0 &&
          offlineEvidence.componentCount === 0
            ? "pass"
            : "fail",
        detail:
          offlineEvidence.mode === "offline" &&
          offlineEvidence.routeCount === 0 &&
          offlineEvidence.componentCount === 0
            ? "Production Studio exposed an explicit empty offline project state."
            : "Production Studio exposed project entities before daemon validation.",
        evidence: {
          mode: offlineEvidence.mode,
          routeCount: offlineEvidence.routeCount,
          componentCount: offlineEvidence.componentCount,
        },
      },
      {
        id: "invalid-graph-is-rejected",
        status:
          offlineEvidence.mode === "offline" &&
          offlineEvidence.routeCount === 0 &&
          graphError.includes("valid daemon graph")
            ? "pass"
            : "fail",
        detail:
          offlineEvidence.mode === "offline" &&
          offlineEvidence.routeCount === 0 &&
          graphError.includes("valid daemon graph")
            ? "A malformed daemon graph was rejected before it could enter Studio state."
            : "Studio did not fail closed on a malformed daemon graph.",
        evidence: {
          mode: offlineEvidence.mode,
          routeCount: offlineEvidence.routeCount,
          graphError,
        },
      },
      {
        id: "offline-excludes-demo-evidence",
        status: forbiddenTerms.length === 0 ? "pass" : "fail",
        detail:
          forbiddenTerms.length === 0
            ? "The disconnected production shell substituted no Fieldbase fixture evidence."
            : "The disconnected production shell rendered demo-only evidence.",
        evidence: { forbiddenTerms },
      },
      {
        id: "offline-writes-require-daemon",
        status:
          noteCountAfterWrite === 0 &&
          writeError.includes("local daemon is offline")
            ? "pass"
            : "fail",
        detail:
          noteCountAfterWrite === 0 &&
          writeError.includes("local daemon is offline")
            ? "A disconnected production note write was rejected without mutating Studio state."
            : "A disconnected production note write did not fail closed.",
        evidence: { noteCountAfterWrite, writeError },
      },
      {
        id: "notes-destination-requested",
        status: notesAssets.includes(notesFile) ? "pass" : "fail",
        detail: notesAssets.includes(notesFile)
          ? "The direct Notes route requested its destination chunk."
          : "The direct Notes route did not request its destination chunk.",
        evidence: {
          expectedAsset: notesFile,
          requested: notesAssets.includes(notesFile),
        },
      },
      {
        id: "notes-excludes-pixi",
        status: notesPixiAssets.length === 0 ? "pass" : "fail",
        detail:
          notesPixiAssets.length === 0
            ? "The DOM-only Notes route requested no Pixi runtime assets."
            : `${notesPixiAssets.length} Pixi runtime asset(s) loaded on Notes.`,
        evidence: { requestedPixiAssets: notesPixiAssets },
      },
      {
        id: "atlas-destination-requested",
        status: atlasAssets.includes(atlasFile) ? "pass" : "fail",
        detail: atlasAssets.includes(atlasFile)
          ? "The direct Atlas route requested its destination chunk."
          : "The direct Atlas route did not request its destination chunk.",
        evidence: {
          expectedAsset: atlasFile,
          requested: atlasAssets.includes(atlasFile),
        },
      },
      {
        id: "atlas-loads-pixi",
        status: atlasPixiAssets.length > 0 ? "pass" : "fail",
        detail:
          atlasPixiAssets.length > 0
            ? `Atlas loaded ${atlasPixiAssets.length} deferred Pixi runtime asset(s).`
            : "Atlas did not load a deferred Pixi runtime asset.",
        evidence: { requestedPixiAssets: atlasPixiAssets },
      },
      {
        id: "page-errors",
        status: pageErrors.length === 0 ? "pass" : "fail",
        detail:
          pageErrors.length === 0
            ? "No checked production or demo state emitted an uncaught page error."
            : `${pageErrors.length} uncaught page error(s) were observed.`,
        evidence: { errors: pageErrors },
      },
    ];
    const failed = checks.filter((check) => check.status === "fail").length;
    return {
      schemaVersion: STUDIO_LOADING_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      status: failed === 0 ? "pass" : "fail",
      browser: { name: "chromium", version: browser.version() },
      offline: {
        readyMs: Math.round(offlineReadyMs * 10) / 10,
        mode: offlineEvidence.mode,
        routeCount: offlineEvidence.routeCount,
        componentCount: offlineEvidence.componentCount,
        forbiddenTerms,
        graphError,
        noteCountAfterWrite,
        writeError,
      },
      notes: {
        readyMs: Math.round(notesReadyMs * 10) / 10,
        requestedAssets: notesAssets,
        pixiAssets: notesPixiAssets,
      },
      atlas: {
        readyMs: Math.round(atlasReadyMs * 10) / 10,
        requestedAssets: atlasAssets,
        pixiAssets: atlasPixiAssets,
      },
      summary: {
        passed: checks.length - failed,
        failed,
        total: checks.length,
      },
      checks,
    };
  } finally {
    await context.close();
    await browser.close();
    await host.close();
  }
}
