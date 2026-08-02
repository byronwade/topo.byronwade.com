export type StudioBoardRole = "destination" | "supporting-state" | "overlay";

export type StudioBoardLayout =
  "three-pane" | "two-pane" | "workspace" | "settings";

export type StudioBoardRenderer = "pixi-hybrid" | "pixi-topology";

export type StudioBoardShell = "standard" | "immersive" | "settings";

export interface StudioBoard {
  /** Stable machine id used in reports, screenshots, and DOM evidence. */
  id: string;
  /** Human-readable Paper artboard name. */
  name: string;
  /** Directly addressable Studio path. */
  path: string;
  destination: string;
  role: StudioBoardRole;
  summary: string;
  /** Selector that proves the intended state mounted, not only its route shell. */
  readySelector: string;
  layout: StudioBoardLayout;
  /** Omitted for the standard 52 / content / 30 shell. */
  shell?: Exclude<StudioBoardShell, "standard">;
  renderer?: StudioBoardRenderer;
  theme?: "light";
}

export interface StudioFrameContract {
  width: number;
  height: number;
  topbarHeight: number;
  statusbarHeight: number;
  leftPaneWidth: number;
  centerPaneWidth: number;
  rightPaneWidth: number;
  canvasTitlebarHeight: number;
  canvasInsetX: number;
  canvasInsetTop: number;
  canvasInsetBottom: number;
  canvasRadius: number;
}

/** Exact shared frame measured from the approved 1440 x 900 Paper boards. */
export const studioFrame: Readonly<StudioFrameContract> = Object.freeze({
  width: 1_440,
  height: 900,
  topbarHeight: 52,
  statusbarHeight: 30,
  leftPaneWidth: 248,
  centerPaneWidth: 928,
  rightPaneWidth: 264,
  canvasTitlebarHeight: 40,
  canvasInsetX: 14,
  canvasInsetTop: 4,
  canvasInsetBottom: 14,
  canvasRadius: 16,
});

/**
 * The shipped Paper board ledger. This is data, not a router: projects can
 * freely compose a different Studio while the default product stays testable.
 */
const studioBoardDefinitions: StudioBoard[] = [
  {
    id: "welcome-first-load",
    name: "Welcome — first load",
    path: "/welcome",
    destination: "welcome",
    role: "overlay",
    summary: "First-run scan summary and entry actions.",
    readySelector: ".welcome-card",
    layout: "three-pane",
    renderer: "pixi-topology",
  },
  {
    id: "global-navigation",
    name: "Global — Navigation dropdown",
    path: "/atlas/flows?overlay=navigation",
    destination: "global",
    role: "overlay",
    summary:
      "Destination switcher for Atlas, Editor, Notes, Doctor and Settings.",
    readySelector: ".destination-menu",
    layout: "three-pane",
    renderer: "pixi-topology",
  },
  {
    id: "global-command-palette",
    name: "Global — Command palette ⌘K",
    path: "/atlas/flows?overlay=command",
    destination: "global",
    role: "overlay",
    summary: "Workspace actions and jump-to-route search.",
    readySelector: ".command-palette",
    layout: "three-pane",
    renderer: "pixi-topology",
  },
  {
    id: "atlas-flows",
    name: "Atlas — Flows (landing)",
    path: "/atlas/flows",
    destination: "atlas",
    role: "destination",
    summary: "Default Atlas landing view for traced user journeys.",
    readySelector: ".atlas-flows-view",
    layout: "three-pane",
    renderer: "pixi-topology",
  },
  {
    id: "atlas-routes",
    name: "Atlas — Routes",
    path: "/atlas/routes",
    destination: "atlas",
    role: "destination",
    summary: "Route tree, selected application screen and evidence inspector.",
    readySelector: ".atlas-routes-view",
    layout: "three-pane",
    renderer: "pixi-hybrid",
  },
  {
    id: "atlas-components",
    name: "Atlas — Components",
    path: "/atlas/components",
    destination: "atlas",
    role: "destination",
    summary:
      "Component preview coverage, consuming-screen evidence, and optional source-domain topology.",
    readySelector: ".components-view",
    layout: "three-pane",
    renderer: "pixi-hybrid",
  },
  {
    id: "atlas-live-screen",
    name: "Atlas — Live screen",
    path: "/atlas/live",
    destination: "atlas",
    role: "supporting-state",
    summary: "Selected snapshot promoted to an isolated live iframe.",
    readySelector: ".live-screen-view",
    layout: "workspace",
    shell: "immersive",
  },
  {
    id: "atlas-interaction-probe",
    name: "Atlas — Interaction probe",
    path: "/atlas/probe",
    destination: "atlas",
    role: "supporting-state",
    summary: "Observed effects and confidence for an isolated control probe.",
    readySelector: ".probe-view",
    layout: "workspace",
    shell: "immersive",
  },
  {
    id: "editor-canvas",
    name: "Editor — Canvas",
    path: "/editor/canvas",
    destination: "editor",
    role: "destination",
    summary: "Selected screen, source-backed evidence and inspector.",
    readySelector: ".editor-view",
    layout: "three-pane",
    renderer: "pixi-hybrid",
  },
  {
    id: "editor-insert-panel",
    name: "Editor — Insert panel",
    path: "/editor/insert",
    destination: "editor",
    role: "supporting-state",
    summary: "Searchable catalog of discovered component previews.",
    readySelector: ".editor-view .insert-panel",
    layout: "three-pane",
    renderer: "pixi-hybrid",
  },
  {
    id: "editor-assets-panel",
    name: "Editor — Assets panel",
    path: "/editor/assets",
    destination: "editor",
    role: "supporting-state",
    summary: "Component, source identity and capture evidence.",
    readySelector: ".editor-view",
    layout: "three-pane",
    renderer: "pixi-hybrid",
  },
  {
    id: "notes-all",
    name: "Notes — All notes",
    path: "/notes",
    destination: "notes",
    role: "destination",
    summary: "All versioned Markdown notes filtered by state and anchor.",
    readySelector: ".notes-index-view",
    layout: "two-pane",
  },
  {
    id: "notes-annotate",
    name: "Notes — Annotate",
    path: "/atlas/routes?overlay=annotate",
    destination: "notes",
    role: "overlay",
    summary: "Anchor strategy chooser for a new visual note.",
    readySelector: ".annotate-popover",
    layout: "three-pane",
    renderer: "pixi-hybrid",
  },
  {
    id: "notes-detail",
    name: "Notes — Note detail",
    path: "/notes/detail",
    destination: "notes",
    role: "supporting-state",
    summary: "Markdown note content and anchor health evidence.",
    readySelector: ".note-detail-view",
    layout: "three-pane",
    renderer: "pixi-hybrid",
  },
  {
    id: "doctor-report",
    name: "Doctor — Report",
    path: "/doctor",
    destination: "doctor",
    role: "destination",
    summary: "Application findings and environment checks in one report.",
    readySelector: ".doctor-report-view",
    layout: "two-pane",
  },
  {
    id: "doctor-findings",
    name: "Doctor — Findings overlay",
    path: "/doctor/findings",
    destination: "doctor",
    role: "supporting-state",
    summary:
      "Evidence findings alongside their relevant live or captured screen.",
    readySelector: ".doctor-findings-view",
    layout: "three-pane",
    renderer: "pixi-hybrid",
  },
  {
    id: "doctor-export-review",
    name: "Doctor — Export review",
    path: "/doctor?overlay=export",
    destination: "doctor",
    role: "overlay",
    summary: "TOPO_REVIEW export controls and report preview.",
    readySelector: ".export-dialog",
    layout: "two-pane",
  },
  {
    id: "settings-general",
    name: "Settings — General",
    path: "/settings/general",
    destination: "settings",
    role: "destination",
    summary: "Workspace identity, root, theme and local telemetry.",
    readySelector: ".settings-view",
    layout: "settings",
    shell: "settings",
  },
  {
    id: "settings-adapters",
    name: "Settings — Adapters",
    path: "/settings/adapters",
    destination: "settings",
    role: "destination",
    summary: "Framework adapters, Storybook, gateway and diagnostics.",
    readySelector: ".settings-view",
    layout: "settings",
    shell: "settings",
  },
  {
    id: "settings-capture-cache",
    name: "Settings — Capture & cache",
    path: "/settings/capture",
    destination: "settings",
    role: "destination",
    summary: "Snapshot, live promotion and cache behavior.",
    readySelector: ".settings-view",
    layout: "settings",
    shell: "settings",
  },
  {
    id: "settings-shortcuts",
    name: "Settings — Shortcuts",
    path: "/settings/shortcuts",
    destination: "settings",
    role: "destination",
    summary: "Keyboard reference for navigation, canvas and workspace actions.",
    readySelector: ".settings-view",
    layout: "settings",
    shell: "settings",
  },
  {
    id: "settings-about",
    name: "Settings — About Topo",
    path: "/settings/about",
    destination: "settings",
    role: "destination",
    summary: "Version, license and project resources.",
    readySelector: ".settings-view",
    layout: "settings",
    shell: "settings",
  },
  {
    id: "settings-light-theme",
    name: "Settings — Light theme",
    path: "/settings/light",
    destination: "settings",
    role: "supporting-state",
    summary: "Light palette reference selected through General settings.",
    readySelector: ".settings-view",
    layout: "settings",
    shell: "settings",
    theme: "light",
  },
];

export const studioBoards: readonly Readonly<StudioBoard>[] = Object.freeze(
  studioBoardDefinitions.map((board) => Object.freeze(board)),
);

function canonicalBoardPath(href: string): string {
  const url = new URL(href, "http://topo.local");
  const overlay = url.searchParams.get("overlay");
  return `${url.pathname}${overlay ? `?overlay=${encodeURIComponent(overlay)}` : ""}`;
}

/** Finds a shipped board while ignoring session-only query parameters. */
export function findStudioBoard(
  href: string,
): Readonly<StudioBoard> | undefined {
  const path = canonicalBoardPath(href);
  return studioBoards.find((board) => board.path === path);
}
