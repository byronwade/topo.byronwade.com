import type { ComponentType, LazyExoticComponent } from "react";
import {
  Camera,
  CheckCircle2,
  Command as CommandIcon,
  Download,
  FileText,
  LayoutGrid,
  Pencil,
  RefreshCw,
  Settings,
  type LucideIcon,
} from "lucide-react";

import {
  defineStudio,
  type StudioCommand,
  type StudioDefinition,
  type StudioDefinitionInput,
  type StudioDestination,
} from "@topo/studio-api";

import {
  AtlasDestination,
  DoctorDestination,
  EditorDestination,
  NotesDestination,
  SettingsDestination,
} from "./studio-destinations";
import type { TopoStudioRuntime } from "./studio-runtime";

export type StudioToolset = "canvas" | "none";
export type StudioPrimaryAction = "rescan" | "preview" | "filter" | "none";
export type TopoStudioDestinationComponent =
  ComponentType | LazyExoticComponent<ComponentType>;

export interface TopoStudioDestination extends StudioDestination {
  icon: LucideIcon;
  component: TopoStudioDestinationComponent;
  tools: StudioToolset;
  primaryAction: StudioPrimaryAction;
  immersiveViews?: readonly string[];
  statusBar?: boolean;
  chromeTitleByView?: Readonly<Record<string, string>>;
  navigationDescription?: (runtime: TopoStudioRuntime) => string;
  status?: (runtime: TopoStudioRuntime) => string;
}

export interface TopoStudioCommand extends StudioCommand {
  icon: LucideIcon;
  closePalette?: boolean;
  run(runtime: TopoStudioRuntime): void | Promise<void>;
}

export type TopoStudioDefinition = StudioDefinition<
  TopoStudioDestination,
  TopoStudioCommand
>;

export type TopoStudioDefinitionInput = StudioDefinitionInput<
  TopoStudioDestination,
  TopoStudioCommand
>;

export type TopoStudioDestinationInput = Partial<TopoStudioDestination>;
export type TopoStudioCommandInput =
  | TopoStudioCommand["run"]
  | (Partial<Omit<TopoStudioCommand, "run">> & {
      run?: TopoStudioCommand["run"];
    });

/** The intentionally small public customization shape. */
export interface TopoStudioCustomization {
  defaultDestination?: string;
  remove?: {
    destinations?: readonly string[];
    commands?: readonly string[];
  };
  destinations?: Record<string, TopoStudioDestinationInput | false>;
  commands?: Record<string, TopoStudioCommandInput | false>;
}

export function defineTopoStudio(
  input: TopoStudioDefinitionInput,
): TopoStudioDefinition {
  return defineStudio<TopoStudioDestination, TopoStudioCommand>(input);
}

function atlasStatus(runtime: TopoStudioRuntime): string {
  if (runtime.location.view === "flows") {
    const routePaths = new Set(
      runtime.data.graph.screens.map((screen) => screen.routePath),
    );
    const breaks = runtime.data.flows.reduce(
      (count, flow) =>
        count +
        flow.steps.filter(
          (step) => step.routePath && !routePaths.has(step.routePath),
        ).length,
      0,
    );
    return `${runtime.data.flows.length} flows · ${breaks} ${breaks === 1 ? "break" : "breaks"}`;
  }
  const live = runtime.data.graph.screens.filter(
    (screen) => screen.renderStatus === "live",
  ).length;
  const captured = runtime.data.graph.screens.filter(
    (screen) => screen.renderStatus === "captured",
  ).length;
  return `${live} live · ${captured} snapshots`;
}

export const defaultStudio = defineTopoStudio({
  defaultDestination: "atlas",
  destinations: {
    atlas: {
      label: "Atlas",
      description: "Route, component, and flow map",
      path: "/atlas/flows",
      icon: LayoutGrid,
      component: AtlasDestination,
      tools: "canvas",
      primaryAction: "rescan",
      immersiveViews: ["live", "probe"],
      chromeTitleByView: {
        routes: "Atlas · Routes",
        components: "Atlas · Components",
        apis: "Atlas · APIs",
        flows: "Atlas · Flows",
        live: "Atlas · Live preview",
        probe: "Atlas · Probe",
      },
      statusBar: true,
      status: atlasStatus,
    },
    editor: {
      label: "Editor",
      description: "Inspect source-backed screen evidence",
      path: "/editor/canvas",
      icon: Pencil,
      component: EditorDestination,
      tools: "canvas",
      primaryAction: "preview",
      statusBar: true,
      status: ({ data, selection }) => {
        const screen =
          data.graph.screens.find((item) => item.id === selection.screenId) ??
          data.graph.screens[0];
        const snapshot = data.snapshots.find(
          (item) => item.screenId === screen?.id && item.status === "captured",
        );
        const previewStatus =
          data.connected && screen?.renderStatus === "live"
            ? "live"
            : snapshot
              ? "snapshot"
              : screen?.renderStatus;
        return screen
          ? `${screen.routePath} · ${previewStatus}`
          : "No screens discovered";
      },
    },
    notes: {
      label: "Notes",
      description: "Review context stored as Markdown",
      path: "/notes",
      icon: FileText,
      component: NotesDestination,
      tools: "canvas",
      primaryAction: "rescan",
      statusBar: true,
      chromeTitleByView: { detail: "Atlas" },
      navigationDescription: ({ data }) =>
        `${data.notes.length} pinned to screens and elements`,
      status: ({ data }) =>
        `${data.notes.length} notes · ${data.notes.filter((note) => note.anchor?.status === "drifted").length} drifted`,
    },
    doctor: {
      label: "Doctor",
      description: "Application and environment health",
      path: "/doctor",
      icon: CheckCircle2,
      component: DoctorDestination,
      tools: "canvas",
      primaryAction: "filter",
      statusBar: true,
      chromeTitleByView: { findings: "Atlas" },
      navigationDescription: ({ data }) =>
        `${data.graph.findings.length} in the app · ${data.doctorReport.checks.length} environment and readiness checks`,
      status: ({ data }) =>
        `${data.graph.findings.length} findings · ${data.doctorReport.summary.errors} Doctor errors · ${data.doctorReport.summary.warnings} warnings`,
    },
    settings: {
      label: "Settings",
      description: "Adapters, capture, and cache",
      path: "/settings/general",
      icon: Settings,
      component: SettingsDestination,
      tools: "none",
      primaryAction: "none",
      statusBar: false,
    },
  },
  commands: {
    rescan: {
      label: "Rescan workspace",
      shortcut: "R",
      icon: RefreshCw,
      run: ({ data }) => void data.rescan(),
    },
    capture: {
      label: "Capture all screens",
      shortcut: "C",
      icon: Camera,
      run: ({ data, settings }) => {
        const session = data.getPreviewSession(settings.previewProfile);
        void data.capture(session?.profileName ?? settings.previewProfile);
      },
    },
    doctor: {
      label: "Re-run environment checks",
      shortcut: "⌘ ↵",
      icon: CheckCircle2,
      run: ({ data }) => void data.runChecks(),
    },
    export: {
      label: "Export review…",
      icon: Download,
      closePalette: false,
      run: ({ actions }) => actions.openOverlay("export"),
    },
  },
});

function humanizeId(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : id;
}

function destinationPath(id: string): string {
  return `/${id
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase()}`;
}

function normalizeDestination(
  base: TopoStudioDefinition,
  id: string,
  input: TopoStudioDestinationInput,
): TopoStudioDestination {
  const inherited = base.destinations[id];
  const label = input.label ?? inherited?.label ?? humanizeId(id);
  const component = input.component ?? inherited?.component;
  if (!component) {
    throw new Error(
      `Custom Studio destination "${id}" needs a React component`,
    );
  }
  return {
    ...inherited,
    ...input,
    label,
    description:
      input.description ?? inherited?.description ?? `${label} workspace`,
    path: input.path ?? inherited?.path ?? destinationPath(id),
    icon: input.icon ?? inherited?.icon ?? LayoutGrid,
    component,
    tools: input.tools ?? inherited?.tools ?? "none",
    primaryAction: input.primaryAction ?? inherited?.primaryAction ?? "none",
    statusBar: input.statusBar ?? inherited?.statusBar ?? true,
  };
}

function normalizeCommand(
  base: TopoStudioDefinition,
  id: string,
  input: Exclude<TopoStudioCommandInput, false>,
): TopoStudioCommand {
  const inherited = base.commands[id];
  const changes = typeof input === "function" ? { run: input } : input;
  const run = changes.run ?? inherited?.run;
  if (!run) {
    throw new Error(`Custom Studio command "${id}" needs a run function`);
  }
  return {
    ...inherited,
    ...changes,
    label: changes.label ?? inherited?.label ?? humanizeId(id),
    icon: changes.icon ?? inherited?.icon ?? CommandIcon,
    run,
  };
}

/**
 * Customize the built-in Studio through one keyed object. Set a destination or
 * command to false (or list it under `remove`) to remove it. New destinations
 * need only a component; labels, routes, icons, and chrome behavior have useful
 * defaults. Commands may be written as a single runtime function.
 */
export function customizeStudio(
  changes: TopoStudioCustomization = {},
  base: TopoStudioDefinition = defaultStudio,
): TopoStudioDefinition {
  const destinations: Record<string, TopoStudioDestination | false> = {};
  for (const [id, destination] of Object.entries(changes.destinations ?? {})) {
    destinations[id] =
      destination === false
        ? false
        : normalizeDestination(base, id, destination);
  }
  const commands: Record<string, TopoStudioCommand | false> = {};
  for (const [id, command] of Object.entries(changes.commands ?? {})) {
    commands[id] =
      command === false ? false : normalizeCommand(base, id, command);
  }
  return defineTopoStudio({
    extends: base,
    defaultDestination: changes.defaultDestination,
    remove: changes.remove,
    destinations,
    commands,
  });
}

/** The only value a custom Studio source build needs to replace. */
export const studio = customizeStudio();
