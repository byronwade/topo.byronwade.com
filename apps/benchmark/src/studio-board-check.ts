import path from "node:path";
import { mkdir } from "node:fs/promises";

import { chromium } from "playwright";

import {
  studioBoards,
  studioFrame,
  type StudioBoard,
  type StudioBoardLayout,
  type StudioBoardShell,
} from "@topo/studio-api";
import { startStudioHost } from "@topo/studio-host";

export const STUDIO_BOARD_REPORT_VERSION = 1 as const;

export interface StudioBoardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioBoardBorderStyle {
  topWidth: string;
  rightWidth: string;
  bottomWidth: string;
  leftWidth: string;
  bottomStyle: string;
  bottomColor: string;
}

export interface StudioBoardCheck {
  id:
    | "http"
    | "identity"
    | "ready"
    | "errors"
    | "frame"
    | "chrome"
    | "shell-style"
    | "layout"
    | "canvas-shell"
    | "renderer"
    | "theme"
    | "annotation-palette"
    | "annotation-composer"
    | "notes-index"
    | "note-workbench"
    | "note-placement"
    | "editor-evidence-navigation"
    | "doctor-report-triage"
    | "doctor-finding-links"
    | "route-presentation-links"
    | "component-evidence-contract"
    | "component-scene-contract"
    | "component-preview-artifact"
    | "flow-scene-contract"
    | "flow-trace"
    | "probe-selection-links"
    | "form-controls"
    | "text-contrast"
    | "selection-links";
  status: "pass" | "fail";
  detail: string;
}

export interface StudioBoardEvidence {
  id: string;
  name: string;
  path: string;
  status: "pass" | "fail";
  readyMs: number;
  finalPath: string;
  screenshot?: string;
  runtime: {
    boardId: string | null;
    boardName: string | null;
    destination: string | null;
    view: string | null;
    overlay: string | null;
    theme: string | null;
    ready: boolean;
    readySelector: boolean;
    globalErrors: string[];
  };
  geometry: {
    viewport: { width: number; height: number };
    root: StudioBoardBox | null;
    topbar: StudioBoardBox | null;
    body: StudioBoardBox | null;
    statusbar: StudioBoardBox | null;
    layout: StudioBoardLayout;
    shell: StudioBoardShell;
    layoutRoot: StudioBoardBox | null;
    panes: StudioBoardBox[];
    canvasViewport: StudioBoardBox | null;
    canvasStyle: {
      borderRadius: string;
      marginTop: string;
      marginLeft: string;
      marginRight: string;
      overflow: string;
    } | null;
    shellStyle: {
      topbar: StudioBoardBorderStyle | null;
      body: StudioBoardBorderStyle | null;
      layoutRoot: StudioBoardBorderStyle | null;
      panes: StudioBoardBorderStyle[];
      canvasTitlebar: StudioBoardBorderStyle | null;
      canvasViewport: StudioBoardBorderStyle | null;
      statusbar: StudioBoardBorderStyle | null;
    };
  };
  renderer: {
    kind: string | null;
    canvasCount: number;
    shell: Record<string, string>;
    host: Record<string, string>;
    error: string | null;
  };
  errors: {
    page: string[];
    console: string[];
  };
  accessibility: {
    visibleFormControls: number;
    unlabeledFormControls: string[];
    unnamedFormControls: string[];
    orphanedLabels: string[];
    contrastPairs: Array<{ id: string; ratio: number }>;
  };
  checks: StudioBoardCheck[];
}

export interface StudioBoardReport {
  schemaVersion: typeof STUDIO_BOARD_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  source: "Paper board contract";
  viewport: typeof studioFrame;
  browser: { name: "chromium"; version: string };
  summary: { passed: number; failed: number; total: number };
  boards: StudioBoardEvidence[];
}

interface StudioBoardCheckOptions {
  headless?: boolean;
  screenshotDir?: string;
}

function withDemoSession(boardPath: string): string {
  const url = new URL(boardPath, "http://topo.local");
  url.searchParams.set("demo", "1");
  return `${url.pathname}${url.search}`;
}

function sameBox(
  box: StudioBoardBox | null,
  expected: Partial<StudioBoardBox>,
): boolean {
  if (!box) return false;
  return Object.entries(expected).every(
    ([key, value]) => box[key as keyof StudioBoardBox] === value,
  );
}

function check(
  id: StudioBoardCheck["id"],
  passed: boolean,
  passDetail: string,
  failDetail: string,
): StudioBoardCheck {
  return {
    id,
    status: passed ? "pass" : "fail",
    detail: passed ? passDetail : failDetail,
  };
}

function expectedBodyHeight(board: Readonly<StudioBoard>): number {
  if (board.shell === "immersive") return studioFrame.height;
  return (
    studioFrame.height -
    studioFrame.topbarHeight -
    (board.shell === "settings" ? 0 : studioFrame.statusbarHeight)
  );
}

function layoutPasses(
  board: Readonly<StudioBoard>,
  panes: StudioBoardBox[],
): boolean {
  if (board.layout === "three-pane") {
    return (
      panes.length === 3 &&
      panes[0]?.width === studioFrame.leftPaneWidth &&
      panes[1]?.width === studioFrame.centerPaneWidth &&
      panes[2]?.width === studioFrame.rightPaneWidth
    );
  }
  if (board.layout === "two-pane") {
    return (
      panes.length === 2 &&
      panes[0]?.width === studioFrame.leftPaneWidth &&
      panes[1]?.width === studioFrame.width - studioFrame.leftPaneWidth
    );
  }
  return true;
}

function isBorderless(style: StudioBoardBorderStyle | null): boolean {
  return (
    style !== null &&
    style.topWidth === "0px" &&
    style.rightWidth === "0px" &&
    style.bottomWidth === "0px" &&
    style.leftWidth === "0px"
  );
}

function shellStylePasses(
  shell: StudioBoardShell,
  theme: string | null,
  style: StudioBoardEvidence["geometry"]["shellStyle"],
): boolean {
  const expectedDividerColor =
    theme === "light" ? "rgb(201, 201, 197)" : "rgb(8, 8, 8)";
  const topbarPasses =
    shell === "immersive"
      ? style.topbar === null
      : style.topbar !== null &&
        style.topbar.topWidth === "0px" &&
        style.topbar.rightWidth === "0px" &&
        style.topbar.bottomWidth === "1px" &&
        style.topbar.leftWidth === "0px" &&
        style.topbar.bottomStyle === "solid" &&
        style.topbar.bottomColor === expectedDividerColor;
  const statusbarPasses =
    shell === "immersive" || shell === "settings"
      ? style.statusbar === null
      : isBorderless(style.statusbar);

  return (
    topbarPasses &&
    isBorderless(style.body) &&
    isBorderless(style.layoutRoot) &&
    style.panes.every(isBorderless) &&
    (style.canvasTitlebar === null || isBorderless(style.canvasTitlebar)) &&
    (style.canvasViewport === null || isBorderless(style.canvasViewport)) &&
    statusbarPasses
  );
}

export async function runStudioBoardCheck(
  assetsDir: string,
  options: StudioBoardCheckOptions = {},
): Promise<StudioBoardReport> {
  const host = await startStudioHost({
    assetsDir,
    daemonUrl: "http://127.0.0.1:4599",
    port: 0,
  });
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const browserVersion = browser.version();
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width: studioFrame.width, height: studioFrame.height },
  });
  await context.grantPermissions(["clipboard-write"], { origin: host.url });
  const page = await context.newPage();
  let pageErrors: string[] = [];
  let consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  if (options.screenshotDir) {
    await mkdir(options.screenshotDir, { recursive: true });
  }

  const boards: StudioBoardEvidence[] = [];
  try {
    for (const board of studioBoards) {
      pageErrors = [];
      consoleErrors = [];
      const startedAt = performance.now();
      const response = await page.goto(
        `${host.url}${withDemoSession(board.path)}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      await page.locator('[data-studio-ready="true"]').waitFor({
        state: "attached",
        timeout: 15_000,
      });
      await page.locator(board.readySelector).waitFor({
        state: "visible",
        timeout: 15_000,
      });
      if (board.renderer) {
        await page
          .locator(
            `[data-renderer="${board.renderer}"] canvas[data-topo-renderer]`,
          )
          .waitFor({ state: "visible", timeout: 15_000 });
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const readyMs = Math.round((performance.now() - startedAt) * 10) / 10;

      const dom = await page.evaluate(
        ({ layout, readySelector, renderer }) => {
          const box = (element: Element | null) => {
            if (!(element instanceof HTMLElement)) return null;
            const value = element.getBoundingClientRect();
            return {
              x: Math.round(value.x),
              y: Math.round(value.y),
              width: Math.round(value.width),
              height: Math.round(value.height),
            };
          };
          const dataset = (element: HTMLElement | null | undefined) =>
            Object.fromEntries(
              Object.entries(element?.dataset ?? {}).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            );
          const borderStyle = (
            element: Element | null,
          ): StudioBoardBorderStyle | null => {
            if (!(element instanceof HTMLElement)) return null;
            const style = getComputedStyle(element);
            return {
              topWidth: style.borderTopWidth,
              rightWidth: style.borderRightWidth,
              bottomWidth: style.borderBottomWidth,
              leftWidth: style.borderLeftWidth,
              bottomStyle: style.borderBottomStyle,
              bottomColor: style.borderBottomColor,
            };
          };
          const root = document.querySelector<HTMLElement>(".topo-studio");
          const ready = document.querySelector<HTMLElement>(
            '[data-studio-ready="true"]',
          );
          const readyElement =
            document.querySelector<HTMLElement>(readySelector);
          const layoutElement =
            layout === "three-pane"
              ? document.querySelector<HTMLElement>(".three-pane, .editor-view")
              : layout === "two-pane"
                ? document.querySelector<HTMLElement>(
                    ".notes-index-view, .doctor-report-view",
                  )
                : readyElement;
          const rendererShell = renderer
            ? document.querySelector<HTMLElement>(
                `[data-renderer="${renderer}"]`,
              )
            : document.querySelector<HTMLElement>("[data-renderer]");
          const rendererHost = rendererShell?.querySelector<HTMLElement>(
            ".atlas-pixi-host, .topology-pixi-host, .editor-pixi-host",
          );
          const rendererStyle = rendererShell
            ? getComputedStyle(rendererShell)
            : null;
          const visibleFormControls = Array.from(
            document.querySelectorAll<
              HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
            >("input, select, textarea"),
          ).filter(
            (control) =>
              control.type !== "hidden" && control.offsetParent !== null,
          );
          const visibleLabels = Array.from(
            document.querySelectorAll<HTMLLabelElement>("label"),
          ).filter((label) => label.offsetParent !== null);
          const rootStyle = getComputedStyle(document.documentElement);
          const colorChannels = (value: string): [number, number, number] => {
            const probe = document.createElement("span");
            probe.style.color = value;
            document.body.append(probe);
            const channels = getComputedStyle(probe)
              .color.match(/[\d.]+/g)
              ?.slice(0, 3)
              .map(Number);
            probe.remove();
            return channels?.length === 3
              ? [channels[0]!, channels[1]!, channels[2]!]
              : [0, 0, 0];
          };
          const relativeLuminance = (value: string) => {
            const normalize = (channel: number) => {
              const normalized = channel / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            };
            const [redChannel, greenChannel, blueChannel] =
              colorChannels(value);
            const red = normalize(redChannel);
            const green = normalize(greenChannel);
            const blue = normalize(blueChannel);
            return red * 0.2126 + green * 0.7152 + blue * 0.0722;
          };
          const contrastRatio = (foreground: string, background: string) => {
            const foregroundLuminance = relativeLuminance(foreground);
            const backgroundLuminance = relativeLuminance(background);
            return (
              (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
              (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
            );
          };
          const semanticContrastPairs = [
            {
              id: "faint-on-surface",
              foreground: rootStyle.getPropertyValue("--color-text-faint"),
              background: rootStyle.getPropertyValue("--color-surface"),
            },
            {
              id: "faint-on-well",
              foreground: rootStyle.getPropertyValue("--color-text-faint"),
              background: rootStyle.getPropertyValue("--color-well"),
            },
            {
              id: "error-on-active",
              foreground: rootStyle.getPropertyValue("--color-error"),
              background: rootStyle.getPropertyValue("--color-surface-active"),
            },
          ];
          const describeControl = (
            control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
          ) => {
            const hint =
              control.getAttribute("aria-label") ??
              control.getAttribute("placeholder") ??
              control.getAttribute("type") ??
              "control";
            return `${control.tagName.toLowerCase()}[${hint}]`;
          };
          return {
            runtime: {
              boardId: root?.dataset.studioBoard ?? null,
              boardName: root?.dataset.studioBoardName ?? null,
              destination: root?.dataset.studioDestination ?? null,
              view: root?.dataset.studioView ?? null,
              overlay: root?.dataset.studioOverlay ?? null,
              theme: document.documentElement.dataset.theme ?? null,
              ready: Boolean(ready),
              readySelector: Boolean(readyElement),
              globalErrors: Array.from(
                document.querySelectorAll<HTMLElement>(".global-error"),
              )
                .filter((element) => element.offsetParent !== null)
                .map((element) => element.innerText.trim()),
            },
            geometry: {
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
              root: box(root),
              topbar: box(document.querySelector(".studio-topbar")),
              body: box(document.querySelector(".studio-body")),
              statusbar: box(document.querySelector(".studio-statusbar")),
              layoutRoot: box(layoutElement),
              panes: layoutElement
                ? Array.from(layoutElement.children)
                    .map((element) => box(element))
                    .filter(
                      (value): value is NonNullable<typeof value> =>
                        value !== null,
                    )
                : [],
              canvasViewport: box(rendererShell ?? null),
              canvasStyle: rendererStyle
                ? {
                    borderRadius: rendererStyle.borderRadius,
                    marginTop: rendererStyle.marginTop,
                    marginLeft: rendererStyle.marginLeft,
                    marginRight: rendererStyle.marginRight,
                    overflow: rendererStyle.overflow,
                  }
                : null,
              shellStyle: {
                topbar: borderStyle(document.querySelector(".studio-topbar")),
                body: borderStyle(document.querySelector(".studio-body")),
                layoutRoot: borderStyle(layoutElement),
                panes:
                  layoutElement &&
                  (layout === "three-pane" || layout === "two-pane")
                    ? Array.from(layoutElement.children)
                        .map((element) => borderStyle(element))
                        .filter(
                          (value): value is StudioBoardBorderStyle =>
                            value !== null,
                        )
                    : [],
                canvasTitlebar: borderStyle(
                  document.querySelector(
                    ".canvas-titlebar, .editor-canvas-toolbar",
                  ),
                ),
                canvasViewport: borderStyle(rendererShell ?? null),
                statusbar: borderStyle(
                  document.querySelector(".studio-statusbar"),
                ),
              },
            },
            renderer: {
              kind: rendererShell?.dataset.renderer ?? null,
              canvasCount:
                rendererShell?.querySelectorAll("canvas[data-topo-renderer]")
                  .length ?? 0,
              shell: dataset(rendererShell),
              host: dataset(rendererHost),
              error:
                rendererHost?.dataset.rendererError ??
                rendererShell?.dataset.rendererError ??
                null,
            },
            accessibility: {
              visibleFormControls: visibleFormControls.length,
              unlabeledFormControls: visibleFormControls
                .filter((control) => (control.labels?.length ?? 0) === 0)
                .map(describeControl),
              unnamedFormControls: visibleFormControls
                .filter((control) => !control.name.trim())
                .map(describeControl),
              orphanedLabels: visibleLabels
                .filter((label) => label.control === null)
                .map(
                  (label) =>
                    `label[${label.textContent?.trim().replace(/\s+/g, " ") || "empty"}]`,
                ),
              contrastPairs: semanticContrastPairs.map((pair) => ({
                id: pair.id,
                ratio:
                  Math.round(
                    contrastRatio(pair.foreground, pair.background) * 1_000,
                  ) / 1_000,
              })),
            },
          };
        },
        {
          layout: board.layout,
          readySelector: board.readySelector,
          renderer: board.renderer,
        },
      );

      const screenshotPath = options.screenshotDir
        ? path.join(options.screenshotDir, `${board.id}.png`)
        : undefined;
      if (screenshotPath) {
        await page.screenshot({
          animations: "disabled",
          fullPage: false,
          path: screenshotPath,
        });
      }

      const componentEvidence =
        board.id === "atlas-components"
          ? await page
              .locator(".component-evidence-view")
              .evaluate((element) => {
                const renderer = element.querySelector<HTMLElement>(
                  '[data-renderer="pixi-hybrid"]',
                );
                return {
                  componentId: element.dataset.selectedComponentId,
                  screenId: element.dataset.selectedScreenId,
                  rendererScreenId: renderer?.dataset.screenId,
                  previewKind: renderer?.dataset.previewKind,
                };
              })
          : undefined;

      let routePresentationPasses: boolean | undefined;
      if (board.id === "atlas-routes") {
        const routeCanvas = page.locator(".screen-canvas");
        const selectedScreen = page.locator(".atlas-screen-world");
        const initialScreenId =
          await selectedScreen.getAttribute("data-screen-id");
        const visualCaptionsPass = await page
          .locator(".visual-evidence-strip figure")
          .evaluateAll((figures) =>
            figures.every((figure) => {
              const caption = figure.querySelector("figcaption");
              if (!(caption instanceof HTMLElement)) return false;
              const figureRect = figure.getBoundingClientRect();
              const captionRect = caption.getBoundingClientRect();
              return (
                captionRect.left >= figureRect.left &&
                captionRect.right <= figureRect.right
              );
            }),
          );
        const defaultScreenPasses =
          (await routeCanvas.getAttribute("data-canvas-mode")) === "screen" &&
          !new URL(page.url()).searchParams.has("canvas") &&
          Boolean(initialScreenId) &&
          (await selectedScreen.count()) === 1 &&
          visualCaptionsPass;

        await page.getByRole("button", { name: "Map", exact: true }).click();
        await page.waitForFunction(() => {
          const url = new URL(window.location.href);
          return (
            url.searchParams.get("canvas") === "map" &&
            document.querySelector<HTMLElement>(".screen-canvas")?.dataset
              .canvasMode === "map"
          );
        });
        const mapPasses = await routeCanvas.evaluate((element) => {
          const width = Number(element.getAttribute("data-route-map-width"));
          const height = Number(element.getAttribute("data-route-map-height"));
          const aspect = Number(element.getAttribute("data-route-map-aspect"));
          return (
            Number(element.getAttribute("data-route-area-count")) > 1 &&
            Number(element.getAttribute("data-route-region-count")) > 1 &&
            width > height &&
            aspect >= 1.35
          );
        });
        if (options.screenshotDir) {
          await page.screenshot({
            animations: "disabled",
            fullPage: false,
            path: path.join(options.screenshotDir, `${board.id}-map.png`),
          });
        }

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        const reloadMapPasses =
          new URL(page.url()).searchParams.get("canvas") === "map" &&
          (await routeCanvas.getAttribute("data-canvas-mode")) === "map";

        await page.getByRole("button", { name: "Screen", exact: true }).click();
        await page.waitForFunction(() => {
          const url = new URL(window.location.href);
          return (
            !url.searchParams.has("canvas") &&
            document.querySelector<HTMLElement>(".screen-canvas")?.dataset
              .canvasMode === "screen"
          );
        });
        const restoredScreenId =
          await selectedScreen.getAttribute("data-screen-id");
        routePresentationPasses =
          defaultScreenPasses &&
          mapPasses &&
          reloadMapPasses &&
          restoredScreenId === initialScreenId;
      }

      let annotationEvidence:
        | {
            palettePasses: boolean;
            composerPasses: boolean;
          }
        | undefined;
      if (board.id === "notes-annotate") {
        const palettePasses = await page
          .locator(".annotate-popover")
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const grids = Array.from(
              element.querySelectorAll<HTMLElement>(".annotate-grid"),
            );
            return (
              Math.round(rect.width) === 416 &&
              Math.round(rect.height) === 224 &&
              style.borderRadius === "14px" &&
              style.backgroundColor === "rgb(27, 27, 31)" &&
              element.querySelectorAll("[data-note-preset]").length === 8 &&
              grids.length === 2 &&
              grids.every(
                (grid) =>
                  getComputedStyle(grid).gridTemplateColumns.split(" ")
                    .length === 4,
              )
            );
          });
        const flowMarker = page.locator('[data-note-preset="flow-marker"]');
        let composerPasses = false;
        if ((await flowMarker.count()) === 1) {
          await flowMarker.click();
          const composer = page.locator(
            'form.annotate-composer[data-note-preset="flow-marker"]',
          );
          await composer.waitFor({ state: "visible", timeout: 5_000 });
          composerPasses = await composer.evaluate((element) => {
            const title = element.querySelector<HTMLInputElement>(
              'input[placeholder="What should change?"]',
            );
            return (
              element.dataset.targetKind === "unbound" &&
              Boolean(title?.value.trim()) &&
              element.textContent?.includes("NO DURABLE TARGET") === true &&
              element.textContent?.includes("type flow") === true
            );
          });
          if (options.screenshotDir) {
            await page.screenshot({
              animations: "disabled",
              fullPage: false,
              path: path.join(
                options.screenshotDir,
                `${board.id}-composer.png`,
              ),
            });
          }
        }
        annotationEvidence = { palettePasses, composerPasses };
      }

      let notePlacementPasses: boolean | undefined;
      let notesIndexPasses: boolean | undefined;
      let editorEvidenceNavigationPasses: boolean | undefined;
      if (board.id === "editor-canvas") {
        const navigator = page.locator(".editor-pages");
        const screenRows = page.locator(".editor-screen-list > button");
        const totalScreens = Number(
          await navigator.getAttribute("data-total-screens"),
        );
        const completeInventoryPasses =
          totalScreens === 47 && (await screenRows.count()) === totalScreens;

        await page
          .getByRole("searchbox", { name: "Search screens" })
          .fill("workspace dispatch map");
        const matchedRows = await screenRows.count();
        const matchedScreenId =
          matchedRows === 1
            ? await screenRows.first().getAttribute("data-screen-id")
            : null;
        let exactScreenPasses = false;
        if (matchedScreenId) {
          await screenRows.first().click();
          await page.waitForFunction((screenId) => {
            const url = new URL(window.location.href);
            return (
              url.searchParams.get("screen") === screenId &&
              document.querySelector<HTMLElement>(".editor-stage")?.dataset
                .screenId === screenId
            );
          }, matchedScreenId);
          exactScreenPasses = true;
        }

        await page.goto(
          `${host.url}/editor/canvas?demo=1&screen=${encodeURIComponent("fixture:screen:0")}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        const findingCards = page.locator(
          ".property-inspector .finding-card[data-finding-id]",
        );
        const clickedFindingId =
          (await findingCards.count()) > 1
            ? await findingCards.nth(1).getAttribute("data-finding-id")
            : null;
        let exactFindingPasses = false;
        if (clickedFindingId) {
          await findingCards.nth(1).click();
          await page.waitForFunction((findingId) => {
            const url = new URL(window.location.href);
            return (
              url.searchParams.get("finding") === findingId &&
              document.querySelector<HTMLElement>(".doctor-findings-view")
                ?.dataset.selectedFindingId === findingId
            );
          }, clickedFindingId);
          exactFindingPasses = true;
        }

        editorEvidenceNavigationPasses =
          completeInventoryPasses &&
          matchedRows === 1 &&
          exactScreenPasses &&
          exactFindingPasses;
      } else if (board.id === "editor-assets") {
        const assets = page.locator(".assets-panel");
        const componentRows = page.locator(
          ".assets-panel .asset-component[data-component-id]",
        );
        const totalComponents = Number(
          await assets.getAttribute("data-total-components"),
        );
        const completeInventoryPasses =
          totalComponents === 128 &&
          (await componentRows.count()) === totalComponents;
        await page
          .getByRole("searchbox", { name: "Search component assets" })
          .fill("technician picker");
        editorEvidenceNavigationPasses =
          completeInventoryPasses &&
          Number(await assets.getAttribute("data-matched-components")) === 1 &&
          (await componentRows.count()) === 1 &&
          (await componentRows.first().textContent())?.includes(
            "TechnicianPicker",
          ) === true;
      } else if (board.id === "editor-insert") {
        const insertPanel = page.locator(".insert-panel");
        const totalComponents = Number(
          await insertPanel.getAttribute("data-total-components"),
        );
        const boundedCatalogPasses =
          totalComponents === 128 &&
          Number(await insertPanel.getAttribute("data-matched-components")) ===
            128 &&
          Number(await insertPanel.getAttribute("data-rendered-components")) ===
            8 &&
          (await page.locator(".insert-view-all").count()) === 1;
        await page
          .getByRole("searchbox", { name: "Search component evidence" })
          .fill("technician picker");
        editorEvidenceNavigationPasses =
          boundedCatalogPasses &&
          Number(await insertPanel.getAttribute("data-matched-components")) ===
            1 &&
          Number(await insertPanel.getAttribute("data-rendered-components")) ===
            1;
      }
      if (board.id === "notes-all") {
        const search = page.getByRole("searchbox", { name: "Search notes" });
        const rows = page.locator(".notes-table > button");
        const initialCount = await rows.count();
        await search.fill("technician");
        const queryCount = await rows.count();
        const queryTitles = await rows
          .locator(".note-row-copy strong")
          .allTextContents();
        await page.getByRole("button", { name: /^Drifted / }).click();
        const driftedQueryCount = await rows.count();
        notesIndexPasses =
          initialCount === 11 &&
          queryCount === 2 &&
          queryTitles.every((title) =>
            title.toLocaleLowerCase().includes("tech"),
          ) &&
          driftedQueryCount === 1;
      }

      let noteWorkbenchPasses: boolean | undefined;
      if (board.id === "notes-detail") {
        const edit = page.getByRole("button", { name: "Edit" });
        const initialReadMode =
          (await page.locator(".note-read-card").count()) === 1 &&
          (await page.getByRole("textbox", { name: "Note title" }).count()) ===
            0 &&
          (await page
            .getByRole("button", { name: "Previous note" })
            .count()) === 1 &&
          (await page.getByRole("button", { name: "Next note" }).count()) === 1;
        await edit.click();
        const editingMode =
          (await page.getByRole("textbox", { name: "Note title" }).count()) ===
            1 &&
          (await page.getByRole("textbox", { name: "Note body" }).count()) ===
            1 &&
          (await page.getByRole("button", { name: "Delete note" }).count()) ===
            1;
        await page.getByRole("button", { name: "Cancel" }).click();
        const restoredReadMode =
          (await page.locator(".note-read-card").count()) === 1 &&
          (await page.getByRole("textbox", { name: "Note title" }).count()) ===
            0;
        noteWorkbenchPasses =
          initialReadMode && editingMode && restoredReadMode;

        const placementAction = page.locator(
          '[data-note-placement-action="point"]',
        );
        if ((await placementAction.count()) === 1) {
          await placementAction.click();
          const surface = page.locator(
            '.note-placement-surface[data-note-placement-mode="point"]',
          );
          await surface.waitFor({ state: "visible", timeout: 5_000 });
          await surface.click({ position: { x: 468, y: 318 } });
          const recordedAnchor = page.locator(
            '.note-evidence-anchor.is-point[data-anchor-status="attached"]',
          );
          await recordedAnchor.waitFor({ state: "visible", timeout: 5_000 });
          notePlacementPasses = await recordedAnchor.evaluate((element) => {
            const x = Number(element.getAttribute("data-anchor-x"));
            const y = Number(element.getAttribute("data-anchor-y"));
            return (
              Math.abs(x - 0.6) < 0.01 &&
              Math.abs(y - 0.45) < 0.01 &&
              document.querySelectorAll(".note-placement-surface").length ===
                0 &&
              document.querySelector(
                '[data-anchor-status="attached"][data-note-id="fixture-note-1"]',
              ) !== null
            );
          });
          if (options.screenshotDir) {
            await page.screenshot({
              animations: "disabled",
              fullPage: false,
              path: path.join(
                options.screenshotDir,
                `${board.id}-placement.png`,
              ),
            });
          }
        } else {
          notePlacementPasses = false;
        }
      }

      let doctorReportPasses: boolean | undefined;
      if (board.id === "doctor-report") {
        const findingRows = page.locator(".doctor-finding-list > button");
        const allFindingsPass = (await findingRows.count()) === 14;
        const scopedChecksPass =
          (await page
            .locator('[data-doctor-scope="IN THE ENVIRONMENT"]')
            .count()) === 1 &&
          (await page.locator('[data-doctor-scope="SECURITY"]').count()) === 1;
        const remediation = page.locator(
          '[data-doctor-check-id="demo.runtime-probes"] button',
        );
        await remediation.click();
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLElement>(
              '[data-doctor-check-id="demo.runtime-probes"] button',
            )?.dataset.copyState !== "ready",
        );
        const remediationPass =
          (await remediation.getAttribute("data-copy-state")) === "copied";
        const findingId = "fixture:finding:2";
        await page.locator(`[data-finding-id="${findingId}"]`).click();
        await page.waitForFunction((expectedFindingId) => {
          const url = new URL(window.location.href);
          return (
            url.searchParams.get("finding") === expectedFindingId &&
            document.querySelector<HTMLElement>(".doctor-findings-view")
              ?.dataset.selectedFindingId === expectedFindingId
          );
        }, findingId);
        doctorReportPasses =
          allFindingsPass &&
          scopedChecksPass &&
          remediationPass &&
          new URL(page.url()).searchParams.get("finding") === findingId;
      }

      let doctorFindingLinksPasses: boolean | undefined;
      if (board.id === "doctor-findings") {
        const directFindingId = "fixture:finding:4";
        const clickedFindingId = "fixture:finding:2";
        await page.goto(
          `${host.url}/doctor/findings?demo=1&finding=${encodeURIComponent(directFindingId)}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        await page.waitForFunction(
          (findingId) =>
            document.querySelector<HTMLElement>(".doctor-findings-view")
              ?.dataset.selectedFindingId === findingId,
          directFindingId,
        );
        const directPass =
          new URL(page.url()).searchParams.get("finding") === directFindingId &&
          (await page
            .locator(`[data-finding-id="${directFindingId}"].is-selected`)
            .count()) === 1;
        await page
          .locator(`[data-finding-id="${clickedFindingId}"]`)
          .last()
          .click();
        await page.waitForFunction((findingId) => {
          const url = new URL(window.location.href);
          return (
            url.searchParams.get("finding") === findingId &&
            document.querySelector<HTMLElement>(".doctor-findings-view")
              ?.dataset.selectedFindingId === findingId
          );
        }, clickedFindingId);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        await page.waitForFunction(
          (findingId) =>
            document.querySelector<HTMLElement>(".doctor-findings-view")
              ?.dataset.selectedFindingId === findingId,
          clickedFindingId,
        );
        doctorFindingLinksPasses =
          directPass &&
          new URL(page.url()).searchParams.get("finding") === clickedFindingId;
      }

      let probeSelectionPasses: boolean | undefined;
      if (board.id === "atlas-interaction-probe") {
        const directProbeId = "fixture-interaction-probe-open-dashboard";
        const selectedProbeId = "fixture-interaction-probe-delete-customer";
        await page.goto(
          `${host.url}/atlas/probe?demo=1&probe=${encodeURIComponent(directProbeId)}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        const probeView = page.locator(".probe-view");
        await page.waitForFunction(
          (probeId) =>
            document.querySelector<HTMLElement>(".probe-view")?.dataset
              .selectedProbeId === probeId,
          directProbeId,
        );
        const picker = page.getByRole("combobox", {
          name: "Interaction probe target for /",
        });
        const directPass =
          Number(await probeView.getAttribute("data-probe-count")) === 3 &&
          (await picker.locator("option").count()) === 3 &&
          (await probeView.getAttribute("data-selected-probe-id")) ===
            directProbeId &&
          (await page
            .locator(
              '.probe-selected-card[data-probe-status="effect-observed"]',
            )
            .count()) === 1;

        await picker.selectOption(selectedProbeId);
        await page.waitForFunction((probeId) => {
          const url = new URL(window.location.href);
          return (
            url.searchParams.get("probe") === probeId &&
            document.querySelector<HTMLElement>(".probe-view")?.dataset
              .selectedProbeId === probeId &&
            document.querySelector<HTMLElement>(".probe-selected-card")?.dataset
              .probeStatus === "skipped"
          );
        }, selectedProbeId);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        await page.waitForFunction(
          (probeId) =>
            document.querySelector<HTMLElement>(".probe-view")?.dataset
              .selectedProbeId === probeId,
          selectedProbeId,
        );
        probeSelectionPasses =
          directPass &&
          new URL(page.url()).searchParams.get("probe") === selectedProbeId &&
          (await picker.inputValue()) === selectedProbeId;
      }

      let componentSceneEvidence:
        | {
            groupCount: number;
            sceneAspect: number;
            sceneVersion?: string;
            selectedGroup?: string;
          }
        | undefined;
      let selectionLinksPasses: boolean | undefined;
      let componentPreviewPasses: boolean | undefined;
      let flowTracePasses: boolean | undefined;
      if (board.id === "atlas-components") {
        const directComponentId = "fixture:component:1";
        const clickedComponentId = "fixture:component:2";
        await page.goto(
          `${host.url}/atlas/components?demo=1&canvas=map&component=${encodeURIComponent(directComponentId)}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        const componentCanvas = page.locator(".component-topology-canvas");
        await componentCanvas.waitFor({ state: "visible", timeout: 15_000 });
        await page.waitForFunction(
          () =>
            Number(
              document.querySelector<HTMLElement>(".topology-pixi-host")
                ?.dataset.visibleNodeCount ?? 0,
            ) > 0,
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        if (options.screenshotDir) {
          await page.screenshot({
            animations: "disabled",
            fullPage: false,
            path: path.join(options.screenshotDir, `${board.id}-map.png`),
          });
        }
        componentSceneEvidence = await componentCanvas.evaluate((element) => ({
          groupCount: Number(element.dataset.componentGroupCount ?? 0),
          sceneAspect: Number(element.dataset.componentSceneAspect ?? 0),
          sceneVersion: element.dataset.componentSceneVersion,
          selectedGroup: element.dataset.selectedComponentGroup,
        }));
        await page.waitForFunction(
          (componentId) =>
            document.querySelector<HTMLElement>(".component-topology-canvas")
              ?.dataset.selectedComponentId === componentId,
          directComponentId,
        );
        const directComponentPasses =
          new URL(page.url()).searchParams.get("component") ===
            directComponentId &&
          (await componentCanvas.getAttribute("data-selected-component-id")) ===
            directComponentId;

        const clickedComponent = page.locator(
          `[data-component-id="${clickedComponentId}"]`,
        );
        for (let index = 0; index < 32; index += 1) {
          if ((await clickedComponent.count()) > 0) break;
          const collapsedGroup = page.locator(
            ".component-domain-heading[aria-expanded=false]",
          );
          if ((await collapsedGroup.count()) === 0) break;
          await collapsedGroup.first().click();
        }
        await clickedComponent.click();
        await page.waitForFunction((componentId) => {
          const url = new URL(window.location.href);
          return (
            url.searchParams.get("component") === componentId &&
            document.querySelector<HTMLElement>(".component-topology-canvas")
              ?.dataset.selectedComponentId === componentId
          );
        }, clickedComponentId);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        await page.waitForFunction(
          (componentId) =>
            document.querySelector<HTMLElement>(".component-topology-canvas")
              ?.dataset.selectedComponentId === componentId,
          clickedComponentId,
        );
        selectionLinksPasses =
          directComponentPasses &&
          new URL(page.url()).searchParams.get("component") ===
            clickedComponentId;

        const previewComponentId = "fixture:component:0";
        const defaultPreviewId = "topo:components/ui/Button.topo.tsx#Default";
        const loadingPreviewId = "topo:components/ui/Button.topo.tsx#Loading";
        await page.goto(
          `${host.url}/atlas/components?demo=1&component=${encodeURIComponent(previewComponentId)}&preview=${encodeURIComponent(defaultPreviewId)}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        const artifactPanel = page.locator(
          '.component-artifact-panel[data-component-preview-kind="captured"]',
        );
        await artifactPanel.waitFor({ state: "visible", timeout: 15_000 });
        const defaultPreviewPasses = await artifactPanel.evaluate(
          (element, expected) => {
            const image = element.querySelector<HTMLImageElement>("img");
            return (
              element.dataset.selectedComponentId === expected.componentId &&
              element.dataset.selectedPreviewId === expected.previewId &&
              Boolean(image && image.complete && image.naturalWidth > 0)
            );
          },
          { componentId: previewComponentId, previewId: defaultPreviewId },
        );
        await page
          .locator(`[data-component-preview-id="${loadingPreviewId}"]`)
          .click();
        await page.waitForFunction(
          ({ componentId, previewId }) => {
            const panel = document.querySelector<HTMLElement>(
              ".component-artifact-panel",
            );
            const image = panel?.querySelector<HTMLImageElement>("img");
            const url = new URL(window.location.href);
            return (
              url.searchParams.get("component") === componentId &&
              url.searchParams.get("preview") === previewId &&
              panel?.dataset.selectedComponentId === componentId &&
              panel.dataset.selectedPreviewId === previewId &&
              Boolean(image && image.complete && image.naturalWidth > 0)
            );
          },
          { componentId: previewComponentId, previewId: loadingPreviewId },
        );
        if (options.screenshotDir) {
          await page.screenshot({
            animations: "disabled",
            fullPage: false,
            path: path.join(options.screenshotDir, `${board.id}-artifact.png`),
          });
        }
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        await page.waitForFunction(
          (previewId) =>
            document.querySelector<HTMLElement>(".component-artifact-panel")
              ?.dataset.selectedPreviewId === previewId,
          loadingPreviewId,
        );
        componentPreviewPasses =
          defaultPreviewPasses &&
          new URL(page.url()).searchParams.get("component") ===
            previewComponentId &&
          new URL(page.url()).searchParams.get("preview") === loadingPreviewId;
      }

      if (board.id === "atlas-flows") {
        const directFlowId = "sign-up";
        const directStepId = "sign-up-step-2";
        const clickedFlowId = "book-a-job";
        const clickedStepId = "book-a-job-step-1";
        await page.goto(
          `${host.url}/atlas/flows?demo=1&flow=${encodeURIComponent(directFlowId)}&step=${encodeURIComponent(directStepId)}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        const flowCanvas = page.locator(".flow-topology-canvas");
        await flowCanvas.waitFor({ state: "visible", timeout: 15_000 });
        await page.waitForFunction(
          ({ flowId, stepId }) => {
            const canvas = document.querySelector<HTMLElement>(
              ".flow-topology-canvas",
            );
            return (
              canvas?.dataset.selectedFlowId === flowId &&
              canvas.dataset.selectedFlowStepId === stepId
            );
          },
          { flowId: directFlowId, stepId: directStepId },
        );
        const directUrl = new URL(page.url());
        const directFlowPasses =
          directUrl.searchParams.get("flow") === directFlowId &&
          directUrl.searchParams.get("step") === directStepId;

        await page.locator(`[data-flow-id="${clickedFlowId}"]`).click();
        await page.waitForFunction(
          ({ flowId, stepId }) => {
            const url = new URL(window.location.href);
            const canvas = document.querySelector<HTMLElement>(
              ".flow-topology-canvas",
            );
            return (
              url.searchParams.get("flow") === flowId &&
              url.searchParams.get("step") === stepId &&
              canvas?.dataset.selectedFlowId === flowId &&
              canvas.dataset.selectedFlowStepId === stepId
            );
          },
          { flowId: clickedFlowId, stepId: clickedStepId },
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
        await page.waitForFunction(
          ({ flowId, stepId }) => {
            const canvas = document.querySelector<HTMLElement>(
              ".flow-topology-canvas",
            );
            return (
              canvas?.dataset.selectedFlowId === flowId &&
              canvas.dataset.selectedFlowStepId === stepId
            );
          },
          { flowId: clickedFlowId, stepId: clickedStepId },
        );
        const reloadedUrl = new URL(page.url());
        selectionLinksPasses =
          directFlowPasses &&
          reloadedUrl.searchParams.get("flow") === clickedFlowId &&
          reloadedUrl.searchParams.get("step") === clickedStepId;

        const traceAction = page.getByRole("button", {
          name: "Trace flow",
          exact: true,
        });
        const traceActionVisible = await traceAction.isVisible();
        await traceAction.click();
        await page.locator('main[data-studio-board="atlas-routes"]').waitFor({
          state: "visible",
          timeout: 15_000,
        });
        const traceHud = page.locator('[data-flow-trace-state="recording"]');
        await traceHud.waitFor({ state: "visible", timeout: 15_000 });
        const seededSteps = Number(
          (await traceHud.getAttribute("data-flow-trace-step-count")) ?? "0",
        );
        await traceHud.getByRole("button", { name: "Cancel" }).click();
        await traceHud.waitFor({ state: "hidden", timeout: 15_000 });
        flowTracePasses = traceActionVisible && seededSteps === 1;
        await page.goto(
          `${host.url}/atlas/flows?demo=1&flow=${encodeURIComponent(clickedFlowId)}&step=${encodeURIComponent(clickedStepId)}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.locator('[data-studio-ready="true"]').waitFor({
          state: "attached",
          timeout: 15_000,
        });
      }

      const shell = board.shell ?? "standard";
      const chromePasses =
        shell === "immersive"
          ? dom.geometry.topbar === null &&
            sameBox(dom.geometry.body, {
              x: 0,
              y: 0,
              width: studioFrame.width,
              height: expectedBodyHeight(board),
            }) &&
            dom.geometry.statusbar === null
          : sameBox(dom.geometry.topbar, {
              x: 0,
              y: 0,
              width: studioFrame.width,
              height: studioFrame.topbarHeight,
            }) &&
            sameBox(dom.geometry.body, {
              x: 0,
              y: studioFrame.topbarHeight,
              width: studioFrame.width,
              height: expectedBodyHeight(board),
            }) &&
            (shell === "settings"
              ? dom.geometry.statusbar === null
              : sameBox(dom.geometry.statusbar, {
                  x: 0,
                  y: studioFrame.height - studioFrame.statusbarHeight,
                  width: studioFrame.width,
                  height: studioFrame.statusbarHeight,
                }));
      const framePasses =
        dom.geometry.viewport.width === studioFrame.width &&
        dom.geometry.viewport.height === studioFrame.height &&
        sameBox(dom.geometry.root, {
          x: 0,
          y: 0,
          width: studioFrame.width,
          height: studioFrame.height,
        });
      const structuralStylePasses = shellStylePasses(
        shell,
        dom.runtime.theme,
        dom.geometry.shellStyle,
      );
      const rendererPasses = board.renderer
        ? dom.renderer.kind === board.renderer &&
          dom.renderer.canvasCount === 1 &&
          dom.renderer.error === null
        : dom.renderer.kind === null && dom.renderer.canvasCount === 0;
      const canvasShellPasses = board.renderer
        ? sameBox(dom.geometry.canvasViewport, {
            x: studioFrame.leftPaneWidth + studioFrame.canvasInsetX,
            y:
              studioFrame.topbarHeight +
              studioFrame.canvasTitlebarHeight +
              studioFrame.canvasInsetTop,
            width: studioFrame.centerPaneWidth - studioFrame.canvasInsetX * 2,
            height:
              expectedBodyHeight(board) -
              studioFrame.canvasTitlebarHeight -
              studioFrame.canvasInsetTop -
              studioFrame.canvasInsetBottom,
          }) &&
          dom.geometry.canvasStyle?.borderRadius ===
            `${studioFrame.canvasRadius}px` &&
          dom.geometry.canvasStyle.marginTop ===
            `${studioFrame.canvasInsetTop}px` &&
          dom.geometry.canvasStyle.marginLeft ===
            `${studioFrame.canvasInsetX}px` &&
          dom.geometry.canvasStyle.marginRight ===
            `${studioFrame.canvasInsetX}px` &&
          dom.geometry.canvasStyle.overflow === "hidden"
        : dom.geometry.canvasViewport === null &&
          dom.geometry.canvasStyle === null;
      const checks: StudioBoardCheck[] = [
        check(
          "http",
          response?.status() === 200,
          "The production host returned HTTP 200.",
          `The production host returned HTTP ${response?.status() ?? "no response"}.`,
        ),
        check(
          "identity",
          dom.runtime.boardId === board.id &&
            dom.runtime.boardName === board.name,
          `The shell identified ${board.id}.`,
          `Expected ${board.id}; received ${dom.runtime.boardId ?? "no board id"}.`,
        ),
        check(
          "ready",
          dom.runtime.ready && dom.runtime.readySelector,
          `The destination and ${board.readySelector} mounted.`,
          `The destination or ${board.readySelector} did not mount.`,
        ),
        check(
          "errors",
          pageErrors.length === 0 &&
            consoleErrors.length === 0 &&
            dom.runtime.globalErrors.length === 0,
          "No page, console, or visible Studio errors were observed.",
          `${pageErrors.length} page, ${consoleErrors.length} console, and ${dom.runtime.globalErrors.length} visible Studio error(s) were observed.`,
        ),
        check(
          "frame",
          framePasses,
          "The root matches the approved 1440 x 900 frame.",
          `The root or viewport drifted from ${studioFrame.width} x ${studioFrame.height}.`,
        ),
        check(
          "chrome",
          chromePasses,
          "Topbar, body, and statusbar geometry match the Paper frame.",
          "Topbar, body, or statusbar geometry drifted from the Paper frame.",
        ),
        check(
          "shell-style",
          structuralStylePasses,
          "Structural surfaces are borderless and the header retains its single theme-correct divider.",
          "A structural surface gained a border or the header divider drifted from the Open Design shell contract.",
        ),
        check(
          "layout",
          layoutPasses(board, dom.geometry.panes),
          `${board.layout} geometry matches the board contract.`,
          `${board.layout} geometry does not match the board contract.`,
        ),
        check(
          "canvas-shell",
          canvasShellPasses,
          board.renderer
            ? "The renderer viewport has the approved inset, clipping, and 16px radius."
            : "The DOM-only board has no renderer viewport.",
          board.renderer
            ? "The renderer viewport drifted from the approved rounded canvas shell."
            : "A renderer viewport mounted on a DOM-only board.",
        ),
        check(
          "renderer",
          rendererPasses,
          board.renderer
            ? `${board.renderer} mounted one canvas without a renderer error.`
            : "The DOM-only board mounted no Pixi canvas.",
          board.renderer
            ? `${board.renderer} did not mount exactly one healthy canvas.`
            : `A renderer mounted unexpectedly: ${dom.renderer.kind ?? "unknown"}.`,
        ),
        check(
          "theme",
          board.theme
            ? dom.runtime.theme === board.theme
            : dom.runtime.theme === "dark",
          `The ${board.theme ?? "dark"} theme is active.`,
          `Expected ${board.theme ?? "dark"}; received ${dom.runtime.theme ?? "no theme"}.`,
        ),
        check(
          "form-controls",
          dom.accessibility.unlabeledFormControls.length === 0 &&
            dom.accessibility.unnamedFormControls.length === 0 &&
            dom.accessibility.orphanedLabels.length === 0,
          `${dom.accessibility.visibleFormControls} visible form controls retain associated labels and stable names, with no orphaned label elements.`,
          `${dom.accessibility.unlabeledFormControls.length} visible form controls lack associated labels, ${dom.accessibility.unnamedFormControls.length} lack stable names, and ${dom.accessibility.orphanedLabels.length} label elements have no associated control: ${[
            ...dom.accessibility.unlabeledFormControls,
            ...dom.accessibility.unnamedFormControls,
            ...dom.accessibility.orphanedLabels,
          ].join(", ")}.`,
        ),
        check(
          "text-contrast",
          dom.accessibility.contrastPairs.every((pair) => pair.ratio >= 4.5),
          `Semantic caption and error text pairs meet 4.5:1: ${dom.accessibility.contrastPairs.map((pair) => `${pair.id} ${pair.ratio.toFixed(3)}`).join(", ")}.`,
          `Semantic text contrast fell below 4.5:1: ${dom.accessibility.contrastPairs.map((pair) => `${pair.id} ${pair.ratio.toFixed(3)}`).join(", ")}.`,
        ),
      ];
      if (annotationEvidence) {
        checks.push(
          check(
            "annotation-palette",
            annotationEvidence.palettePasses,
            "The annotation palette matches the approved 416 x 224 Paper surface with eight aligned presets.",
            "The annotation palette geometry, surface styling, or preset grid drifted from Paper.",
          ),
          check(
            "annotation-composer",
            annotationEvidence.composerPasses,
            "Flow marker opens a typed composer that discloses its target-free canonical flow representation.",
            "Flow marker did not open the typed target-free flow composer.",
          ),
        );
      }
      if (notePlacementPasses !== undefined) {
        checks.push(
          check(
            "note-placement",
            notePlacementPasses,
            "The detail canvas captured and persisted one normalized element-pin position on the exact selected screen.",
            "The detail canvas did not persist the normalized point placement as attached note evidence.",
          ),
        );
      }
      if (editorEvidenceNavigationPasses !== undefined) {
        checks.push(
          check(
            "editor-evidence-navigation",
            editorEvidenceNavigationPasses,
            board.id === "editor-canvas"
              ? "Editor exposes all 47 screens, searches the complete inventory, and preserves exact screen and finding identities across destination changes."
              : board.id === "editor-assets"
                ? "Editor Assets exposes all 128 component records and searches the complete canonical inventory."
                : "Editor Insert discloses its bounded eight-card preview and can search all 128 canonical component records.",
            board.id === "editor-canvas"
              ? "Editor truncated screen evidence, returned the wrong search result, or lost an exact screen or finding identity during navigation."
              : "Editor component evidence was silently truncated or its complete-inventory search returned the wrong canonical records.",
          ),
        );
      }
      if (notesIndexPasses !== undefined) {
        checks.push(
          check(
            "notes-index",
            notesIndexPasses,
            "The Notes index combines lifecycle or anchor facets with searchable Markdown and structured anchor evidence.",
            "The Notes index search or facet composition returned the wrong authoritative records.",
          ),
        );
      }
      if (noteWorkbenchPasses !== undefined) {
        checks.push(
          check(
            "note-workbench",
            noteWorkbenchPasses,
            "Note detail opens in evidence-first read mode and discloses a cancellable editor with destructive actions only on request.",
            "Note detail exposed editing by default or failed to restore the evidence-first read state after cancellation.",
          ),
        );
      }
      if (doctorReportPasses !== undefined) {
        checks.push(
          check(
            "doctor-report-triage",
            doctorReportPasses,
            "Doctor preserves canonical check scopes, exposes all source findings, copies remediation, and opens the exact selected finding.",
            "Doctor scope grouping, complete finding coverage, remediation copy, or report-to-evidence identity failed.",
          ),
        );
      }
      if (doctorFindingLinksPasses !== undefined) {
        checks.push(
          check(
            "doctor-finding-links",
            doctorFindingLinksPasses,
            "Direct and clicked finding identities remain selected through the Studio URL and reload.",
            "The selected Doctor finding drifted from the Studio URL before or after reload.",
          ),
        );
      }
      if (routePresentationPasses !== undefined) {
        checks.push(
          check(
            "route-presentation-links",
            routePresentationPasses,
            "Routes opens on selected-screen evidence, exposes the complete organized map at ?canvas=map, and preserves both presentation and selection through reload.",
            "The default route evidence, addressable map, map telemetry, reload retention, or selected-screen identity drifted.",
          ),
        );
      }
      if (board.id === "atlas-components") {
        const componentGroupCount = componentSceneEvidence?.groupCount ?? 0;
        const componentSceneAspect = componentSceneEvidence?.sceneAspect ?? 0;
        checks.push(
          check(
            "component-evidence-contract",
            Boolean(componentEvidence?.componentId) &&
              Boolean(componentEvidence?.screenId) &&
              componentEvidence?.screenId ===
                componentEvidence?.rendererScreenId &&
              ["live", "snapshot", "empty"].includes(
                componentEvidence?.previewKind ?? "",
              ),
            `The selected component resolves to consuming screen ${componentEvidence?.screenId ?? "unknown"} in the shared hybrid evidence stage.`,
            `The selected component did not retain one exact consuming-screen identity through the hybrid evidence stage.`,
          ),
        );
        checks.push(
          check(
            "component-scene-contract",
            componentSceneEvidence?.sceneVersion === "2" &&
              componentGroupCount >= 8 &&
              componentSceneAspect >= 1.4 &&
              Boolean(componentSceneEvidence.selectedGroup),
            `Component scene version 2 exposed ${componentGroupCount} source-domain groups in a ${componentSceneAspect.toFixed(3)} landscape atlas and retained an exact selected-group identity.`,
            `Expected component scene version 2, at least eight source-domain groups, a landscape aspect of at least 1.4, and one selected-group identity; received version ${componentSceneEvidence?.sceneVersion ?? "none"}, ${componentGroupCount} groups, aspect ${componentSceneAspect.toFixed(3)}, and ${componentSceneEvidence?.selectedGroup ?? "no selection"}.`,
          ),
        );
        checks.push(
          check(
            "component-preview-artifact",
            Boolean(componentPreviewPasses),
            "Renderable component variants display their exact captured artifact, update the Studio address, and retain component and preview identity through reload.",
            "The captured component artifact, preview-variant address, image pixels, or reload identity drifted.",
          ),
        );
      }
      if (board.id === "atlas-flows") {
        const flowLaneCount = Number(dom.renderer.shell.flowLaneCount ?? 0);
        const flowFocusCount = Number(dom.renderer.shell.flowFocusCount ?? 0);
        const flowSceneAspect = Number(dom.renderer.shell.flowSceneAspect ?? 0);
        checks.push(
          check(
            "flow-scene-contract",
            dom.renderer.shell.flowSceneVersion === "1" &&
              flowLaneCount >= 5 &&
              flowFocusCount === 2 &&
              flowSceneAspect >= 1.4 &&
              Boolean(dom.renderer.shell.selectedFlowId),
            `Flow scene version 1 exposed ${flowLaneCount} source flows in a ${flowSceneAspect.toFixed(3)} landscape atlas, retained two-lane focus, and kept an exact selected-flow identity.`,
            `Expected flow scene version 1, at least five source flows, two-lane focus, a landscape aspect of at least 1.4, and one selected-flow identity; received version ${dom.renderer.shell.flowSceneVersion ?? "none"}, ${flowLaneCount} flows, ${flowFocusCount} focus lanes, aspect ${flowSceneAspect.toFixed(3)}, and ${dom.renderer.shell.selectedFlowId ?? "no selection"}.`,
          ),
        );
        checks.push(
          check(
            "flow-trace",
            Boolean(flowTracePasses),
            "Trace flow opens a one-step recording session on the exact source entry route and Cancel removes the ephemeral recorder without creating a flow.",
            "Trace flow did not expose the seeded recording state or Cancel failed to remove it cleanly.",
          ),
        );
      }
      if (selectionLinksPasses !== undefined) {
        checks.push(
          check(
            "selection-links",
            selectionLinksPasses,
            board.id === "atlas-components"
              ? "Direct component identities, clicked selections, and reload retention agree with the Studio URL."
              : "Direct flow-step identities, clicked flow selections, and reload retention agree with the Studio URL.",
            "The selected evidence identity drifted from the Studio URL before or after reload.",
          ),
        );
      }
      if (probeSelectionPasses !== undefined) {
        checks.push(
          check(
            "probe-selection-links",
            probeSelectionPasses,
            "Every route probe is selectable by exact identity and remains selected through URL reload.",
            "The selected interaction probe collapsed to another control or drifted from the Studio URL.",
          ),
        );
      }
      const failed = checks.some((item) => item.status === "fail");
      const finalUrl = new URL(page.url());
      boards.push({
        id: board.id,
        name: board.name,
        path: board.path,
        status: failed ? "fail" : "pass",
        readyMs,
        finalPath: `${finalUrl.pathname}${finalUrl.search}`,
        ...(screenshotPath ? { screenshot: screenshotPath } : {}),
        runtime: dom.runtime,
        geometry: { ...dom.geometry, layout: board.layout, shell },
        renderer: dom.renderer,
        errors: { page: pageErrors, console: consoleErrors },
        accessibility: dom.accessibility,
        checks,
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await host.close();
  }

  const failed = boards.filter((board) => board.status === "fail").length;
  return {
    schemaVersion: STUDIO_BOARD_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    status: failed === 0 ? "pass" : "fail",
    source: "Paper board contract",
    viewport: studioFrame,
    browser: { name: "chromium", version: browserVersion },
    summary: {
      passed: boards.length - failed,
      failed,
      total: boards.length,
    },
    boards,
  };
}
