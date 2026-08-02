import type { ReactNode } from "react";
import {
  Box,
  ChevronDown,
  Filter,
  GitBranch,
  Hand,
  Maximize,
  MousePointer2,
  Plus,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";

import type { CanvasInteractionMode } from "@topo/react";
import type { ApplicationGraph } from "@topo/schema";

import { presentConnection, presentScanState } from "../studio-presentation";
import type { TopoDataMode } from "../useTopoData";

import type { StudioPrimaryAction, StudioToolset } from "../studio-config";

export function TopoMark({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
      <path d="M3 6.2 9 3.2v14.6l-6 3V6.2Z" fill="currentColor" />
      <path
        d="M9 3.2 15 6.2v14.6l-6-3V3.2Z"
        fill="currentColor"
        opacity=".45"
      />
      <path d="M15 6.2 21 3.2v14.6l-6 3V6.2Z" fill="currentColor" />
    </svg>
  );
}

export function IconButton({
  active,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`icon-button ${active ? "is-active" : ""}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export interface StudioContextAction {
  kind: "note" | "trace" | "finish";
  label: string;
  active?: boolean;
  onClick: () => void;
}

interface StudioTopbarProps {
  destinationLabel: string;
  tools: StudioToolset;
  primaryAction: StudioPrimaryAction;
  workspaceName: string;
  connected: boolean;
  busyAction?: string;
  canvasMode: CanvasInteractionMode;
  onDestinationMenu: () => void;
  onCommand: () => void;
  onCanvasModeChange: (mode: CanvasInteractionMode) => void;
  onFitCanvas: () => void;
  onRescan: () => void;
  onFilter?: () => void;
  onPreview?: () => void;
  contextAction: StudioContextAction;
}

function ToolRail({
  canvasMode,
  contextAction,
  onCanvasModeChange,
  onFitCanvas,
}: Pick<
  StudioTopbarProps,
  "canvasMode" | "contextAction" | "onCanvasModeChange" | "onFitCanvas"
>) {
  return (
    <div className="topbar-tool-rail" aria-label="Canvas tools">
      <IconButton
        active={canvasMode === "select"}
        label="Select"
        onClick={() => onCanvasModeChange("select")}
      >
        <MousePointer2 size={14} />
      </IconButton>
      <IconButton
        active={canvasMode === "pan"}
        label="Pan"
        onClick={() => onCanvasModeChange("pan")}
      >
        <Hand size={14} />
      </IconButton>
      <span className="tool-separator" />
      <IconButton label="Fit canvas" onClick={onFitCanvas}>
        <Maximize size={14} />
      </IconButton>
      <span className="tool-separator" />
      <button
        aria-pressed={contextAction.active}
        className={`rail-action ${contextAction.active ? "is-active" : ""}`}
        data-context-action={contextAction.kind}
        onClick={contextAction.onClick}
        type="button"
      >
        {contextAction.kind === "note" ? (
          <Plus size={13} />
        ) : contextAction.kind === "trace" ? (
          <GitBranch size={13} />
        ) : (
          <Square size={11} />
        )}
        {contextAction.label}
      </button>
    </div>
  );
}

function PrimaryAction(props: StudioTopbarProps) {
  switch (props.primaryAction) {
    case "filter":
      return (
        <button
          className="secondary-button"
          onClick={props.onFilter}
          type="button"
        >
          <Filter size={13} /> Filter
        </button>
      );
    case "preview":
      return (
        <button
          className="primary-button"
          onClick={props.onPreview}
          type="button"
        >
          <span className="play-triangle" /> Preview
        </button>
      );
    case "rescan":
      return (
        <button
          className="primary-button"
          disabled={props.busyAction === "rescan" || !props.connected}
          onClick={props.onRescan}
          type="button"
        >
          <RefreshCw
            className={props.busyAction === "rescan" ? "is-spinning" : ""}
            size={13}
          />
          {props.busyAction === "rescan" ? "Scanning" : "Rescan"}
        </button>
      );
    case "none":
      return null;
  }
}

export function StudioTopbar(props: StudioTopbarProps) {
  const chromeOnly = props.tools === "none";
  const commandShortcut =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘K"
      : "Ctrl K";
  return (
    <header className="studio-topbar">
      <div className="topbar-zone topbar-zone-start">
        <div className="topo-app-mark">
          <TopoMark />
        </div>
        <button
          className="destination-switcher"
          onClick={props.onDestinationMenu}
          type="button"
        >
          <Box size={13} />
          <strong>{props.destinationLabel}</strong>
          <ChevronDown size={11} />
        </button>
        {!chromeOnly && (
          <span className="workspace-title">{props.workspaceName}</span>
        )}
      </div>

      {!chromeOnly && (
        <ToolRail
          canvasMode={props.canvasMode}
          contextAction={props.contextAction}
          onCanvasModeChange={props.onCanvasModeChange}
          onFitCanvas={props.onFitCanvas}
        />
      )}

      {!chromeOnly && (
        <div className="topbar-zone topbar-zone-end">
          <button
            aria-keyshortcuts="Control+K Meta+K"
            aria-label="Search routes, components, APIs, flows, notes, and findings"
            className="global-search"
            onClick={props.onCommand}
            type="button"
          >
            <Search size={13} />
            <span>Search project…</span>
            <kbd>{commandShortcut}</kbd>
          </button>
          <PrimaryAction {...props} />
        </div>
      )}
    </header>
  );
}

interface StatusBarProps {
  mode: TopoDataMode;
  graph: ApplicationGraph;
  branch?: string;
  routes: number;
  components: number;
  rightLabel: string;
  lastScannedAt?: string;
}

export function StatusBar({
  mode,
  graph,
  branch = "main",
  routes,
  components,
  rightLabel,
  lastScannedAt,
}: StatusBarProps) {
  const connectionLabel = presentConnection(mode, graph);
  const scanLabel = presentScanState(mode, graph, lastScannedAt);
  return (
    <footer className="studio-statusbar">
      <div className="statusbar-group">
        <span
          className={`connection-dot ${mode === "daemon" ? "is-live" : mode === "demo" ? "is-demo" : ""}`}
        />
        <span>{connectionLabel}</span>
        <span className="status-divider" />
        <code>{branch}</code>
        <span className="status-divider" />
        <span>
          {routes} routes · {components} components · {scanLabel}
        </span>
      </div>
      <div className="statusbar-group">
        <span>{rightLabel}</span>
        <span className="status-divider" />
        <span>100%</span>
      </div>
    </footer>
  );
}
