import {
  BookOpen,
  Bug,
  ChevronLeft,
  Code2,
  ExternalLink,
  Shield,
} from "lucide-react";

import type { ApplicationGraph } from "@topo/schema";
import type {
  AdapterInventoryResponse,
  CacheReport,
  PreviewGatewaySession,
  ProjectSettingsResponse,
} from "@topo/protocol";

import {
  groupAdapterInventory,
  presentAdapterStatus,
} from "../adapter-inventory-view";
import type { StudioSettings } from "../studio-model";
import { distributionLabel, topoProduct } from "../product-meta";
import type { TopoDataMode } from "../useTopoData";

interface SettingsWorkspaceProps {
  view: string;
  graph: ApplicationGraph;
  projectSettings: ProjectSettingsResponse;
  adapterInventory: AdapterInventoryResponse;
  settings: StudioSettings;
  cacheReport: CacheReport;
  dataMode: TopoDataMode;
  busyAction?: string;
  previewSessions: readonly PreviewGatewaySession[];
  onChange: (settings: StudioSettings) => void;
  onCleanCache: () => void;
  onNavigate: (path: string) => void;
}

export function formatCacheBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1_024;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

const navGroups = [
  {
    label: "SETTINGS",
    links: [
      ["general", "General"],
      ["adapters", "Adapters"],
      ["capture", "Capture & cache"],
    ],
  },
  {
    label: "ABOUT",
    links: [
      ["shortcuts", "Shortcuts"],
      ["about", "About Topo"],
    ],
  },
] as const;

function SettingsNav({
  view,
  onNavigate,
}: Pick<SettingsWorkspaceProps, "view" | "onNavigate">) {
  return (
    <aside className="settings-nav">
      <button
        className="back-to-atlas"
        onClick={() => onNavigate("/atlas/flows")}
        type="button"
      >
        <ChevronLeft size={13} /> Back to atlas
      </button>
      {navGroups.map((group) => (
        <section key={group.label}>
          <span className="section-label">{group.label}</span>
          {group.links.map(([value, label]) => (
            <button
              className={
                view === value || (view === "light" && value === "general")
                  ? "is-selected"
                  : ""
              }
              key={value}
              onClick={() => onNavigate(`/settings/${value}`)}
              type="button"
            >
              {label}
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      className={`toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

function GeneralSettings(props: SettingsWorkspaceProps) {
  const s = props.settings;
  const set = (patch: Partial<StudioSettings>) =>
    props.onChange({ ...s, ...patch });
  return (
    <div className="settings-content">
      <header>
        <h1>General</h1>
        <p>
          Project identity comes from source; visual preferences stay in this
          browser.
        </p>
      </header>
      <div className="settings-form-row">
        <div>
          <strong>Project name</strong>
          <p>Read from the application package and shown in the title bar.</p>
        </div>
        <code className="settings-value">{props.projectSettings.name}</code>
      </div>
      <div className="settings-form-row">
        <div>
          <strong>Workspace root</strong>
          <p>Where Topo scans for your application.</p>
        </div>
        <code className="settings-value settings-path">
          {props.projectSettings.sourceRoot}
        </code>
      </div>
      <div className="settings-form-row">
        <div>
          <strong>Theme</strong>
          <p>How the studio looks on this device.</p>
        </div>
        <div className="segmented-control">
          {(["light", "dark", "system"] as const).map((theme) => (
            <button
              className={
                s.theme === theme ||
                (props.view === "light" && theme === "light")
                  ? "is-active"
                  : ""
              }
              key={theme}
              onClick={() => {
                set({ theme });
                if (theme === "light") props.onNavigate("/settings/light");
                else if (props.view === "light")
                  props.onNavigate("/settings/general");
              }}
              type="button"
            >
              {theme[0]?.toUpperCase() + theme.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-form-row">
        <div>
          <strong>Outbound telemetry</strong>
          <p>No telemetry client is included in this source preview.</p>
        </div>
        <em className="status-badge">Disabled</em>
      </div>
    </div>
  );
}

function AdaptersSettings(props: SettingsWorkspaceProps) {
  const activeSession =
    props.previewSessions.find(
      (session) => session.profileName === props.settings.previewProfile,
    ) ?? props.previewSessions[0];
  const inventoryAvailable =
    props.dataMode === "daemon" || props.dataMode === "demo";
  const groups = groupAdapterInventory(props.adapterInventory);
  return (
    <div className="settings-content">
      <header>
        <h1>Adapters</h1>
        <p>
          One truthful inventory for route discovery, previews, and application
          runtimes.
        </p>
      </header>
      {inventoryAvailable ? (
        <>
          <div className="adapter-inventory-summary">
            <span>
              <strong>{props.adapterInventory.summary.total}</strong>
              <small>Known</small>
            </span>
            <span>
              <strong>{props.adapterInventory.summary.active}</strong>
              <small>Active</small>
            </span>
            <span>
              <strong>{props.adapterInventory.summary.registered}</strong>
              <small>Registered</small>
            </span>
          </div>
          <div className="adapter-inventory-groups">
            {groups.map((group) => (
              <section className="adapter-inventory-group" key={group.kind}>
                <header>
                  <span>
                    <strong>{group.label}</strong>
                    <p>{group.description}</p>
                  </span>
                  <small>{group.entries.length}</small>
                </header>
                <div className="adapter-inventory-list">
                  {group.entries.map((adapter) => (
                    <article className="adapter-inventory-row" key={adapter.id}>
                      <div className="adapter-identity">
                        <span
                          aria-hidden="true"
                          className={`adapter-state-dot ${adapter.active ? "is-active" : adapter.registered ? "is-registered" : ""}`}
                        />
                        <span>
                          <strong>{adapter.displayName}</strong>
                          <p>
                            {adapter.provenance === "built-in"
                              ? "Built into Topo"
                              : adapter.provenance === "scaffold"
                                ? "Project-owned scaffold"
                                : adapter.provenance === "configured"
                                  ? "Registered in topo.config.ts"
                                  : "Observed in the current graph"}
                            {adapter.moduleSpecifier ? (
                              <code>{adapter.moduleSpecifier}</code>
                            ) : null}
                          </p>
                        </span>
                      </div>
                      <em
                        className={`status-badge ${adapter.active ? "is-live" : adapter.registered ? "is-primary" : ""}`}
                      >
                        {presentAdapterStatus(adapter)}
                      </em>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {props.adapterInventory.issues.length > 0 ? (
            <aside className="adapter-inventory-issues" role="status">
              <strong>
                {props.adapterInventory.issues.length} manifest issue
                {props.adapterInventory.issues.length === 1 ? "" : "s"}
              </strong>
              {props.adapterInventory.issues.map((issue) => (
                <p key={issue.filePath}>
                  <code>{issue.filePath}</code> {issue.message}
                </p>
              ))}
            </aside>
          ) : null}
        </>
      ) : (
        <div className="adapter-inventory-offline" role="status">
          <strong>Adapter inventory unavailable</strong>
          <p>Start the local Topo daemon to inspect this project.</p>
        </div>
      )}
      <section className="adapter-runtime-settings">
        <header>
          <strong>Runtime safeguards</strong>
          <p>Local preview isolation and bounded interaction diagnostics.</p>
        </header>
        <div className="adapter-rows">
          <div>
            <span>
              <strong>Preview gateway</strong>
              <p>
                Signed, origin-isolated session in front of your dev server.
              </p>
            </span>
            <div className="gateway-profile-control">
              <label className="sr-only" htmlFor="topo-preview-profile">
                Preview profile
              </label>
              <select
                aria-label="Preview profile"
                className="select-control"
                disabled={props.previewSessions.length === 0}
                id="topo-preview-profile"
                name="preview-profile"
                onChange={(event) =>
                  props.onChange({
                    ...props.settings,
                    previewProfile: event.target.value,
                  })
                }
                value={
                  activeSession?.profileName ?? props.settings.previewProfile
                }
              >
                {(props.previewSessions.length > 0
                  ? props.previewSessions.map((session) => session.profileName)
                  : [props.settings.previewProfile]
                ).map((profileName) => (
                  <option key={profileName} value={profileName}>
                    {profileName}
                  </option>
                ))}
              </select>
              <code>
                {activeSession
                  ? new URL(activeSession.baseUrl).host
                  : new URL(props.graph.previewBaseUrl).host}
              </code>
            </div>
          </div>
          <div>
            <span>
              <strong>Playwright diagnostics</strong>
              <p>
                Include bounded runtime probes when Doctor is re-run.
                Destructive controls are never probed.
              </p>
            </span>
            <Toggle
              checked={props.settings.runtimeDiagnostics}
              onChange={(runtimeDiagnostics) =>
                props.onChange({ ...props.settings, runtimeDiagnostics })
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function CaptureSettings(props: SettingsWorkspaceProps) {
  const s = props.settings;
  const cacheBusy = props.busyAction === "cache-clean";
  const cacheEmpty = props.cacheReport.totals.bytes === 0;
  const cacheStatus =
    props.dataMode === "demo"
      ? "Demo project · no local disk cache"
      : props.dataMode === "offline" || props.dataMode === "connecting"
        ? "Connect the local daemon to inspect disk usage"
        : `${formatCacheBytes(props.cacheReport.totals.bytes)} · ${props.cacheReport.totals.files} file(s)`;
  const projectPolicyAvailable =
    props.dataMode === "daemon" || props.dataMode === "demo";
  const autoCaptureLabel = projectPolicyAvailable
    ? props.projectSettings.capture.autoCapture
      ? "Enabled"
      : "Disabled"
    : "Unavailable";
  const set = (patch: Partial<StudioSettings>) =>
    props.onChange({ ...s, ...patch });
  return (
    <div className="settings-content">
      <header>
        <h1>Capture &amp; cache</h1>
        <p>
          Project capture policy comes from topo.config.ts; live promotion is a
          browser preference.
        </p>
      </header>
      <div className="settings-form-row">
        <div>
          <strong>Auto-capture on change</strong>
          <p>Re-snapshot affected screens when source files change.</p>
        </div>
        <em
          className={`status-badge ${projectPolicyAvailable && props.projectSettings.capture.autoCapture ? "is-live" : ""}`}
        >
          {autoCaptureLabel}
        </em>
      </div>
      <div className="settings-form-row">
        <div>
          <strong>Live screens</strong>
          <p>Maximum screens promoted to real iframes at once.</p>
        </div>
        <label className="sr-only" htmlFor="topo-live-screen-limit">
          Maximum live screens
        </label>
        <select
          aria-label="Maximum live screens"
          className="select-control live-screen-limit"
          id="topo-live-screen-limit"
          name="maximum-live-screens"
          onChange={(event) =>
            set({ maxLiveScreens: Number(event.target.value) })
          }
          value={s.maxLiveScreens}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((limit) => (
            <option key={limit} value={limit}>
              {limit} maximum
            </option>
          ))}
        </select>
      </div>
      <div className="settings-form-row">
        <div>
          <strong>Promote on hover</strong>
          <p>Temporarily make nearby screens live while panning.</p>
        </div>
        <Toggle
          checked={s.promoteOnHover}
          onChange={(promoteOnHover) => set({ promoteOnHover })}
        />
      </div>
      <div className="settings-form-row">
        <div>
          <strong>Capture viewport</strong>
          <p>Size used when snapshotting a screen.</p>
        </div>
        <code className="settings-value">
          {projectPolicyAvailable
            ? `${props.projectSettings.capture.viewport.width} × ${props.projectSettings.capture.viewport.height}`
            : "Unavailable"}
        </code>
      </div>
      <div className="settings-form-row">
        <div>
          <strong>Capture browser</strong>
          <p>Whether Playwright capture opens a visible browser window.</p>
        </div>
        <code className="settings-value">
          {projectPolicyAvailable
            ? props.projectSettings.capture.headless
              ? "Headless"
              : "Visible"
            : "Unavailable"}
        </code>
      </div>
      <div className="settings-form-row">
        <div>
          <strong>Derived cache</strong>
          <p>
            Regenerable working data only. Snapshots, notes, flows, and LLM
            exports are retained.
          </p>
        </div>
        <div className="cache-control">
          <code aria-live="polite">{cacheStatus}</code>
          <button
            className="secondary-button"
            disabled={props.dataMode !== "daemon" || cacheEmpty || cacheBusy}
            onClick={props.onCleanCache}
            type="button"
          >
            {cacheBusy ? "Cleaning…" : "Clean cache"}
          </button>
        </div>
      </div>
    </div>
  );
}

const shortcutGroups = [
  [
    "NAVIGATE",
    [
      ["Select / inspect", "V"],
      ["Go to route", "R"],
      ["Add note", "N"],
      ["Next finding", "J"],
    ],
  ],
  [
    "CANVAS",
    [
      ["Zoom to fit", "⌘ 0"],
      ["Zoom in / out", "⌘ ±"],
      ["Pan canvas", "Space"],
      ["Promote to live", "⌘ ↵"],
    ],
  ],
  [
    "WORKSPACE",
    [
      ["Rescan", "⌘ R"],
      ["Switch profile", "⌘ P"],
      ["Export review", "⌘ E"],
    ],
  ],
] as const;

function ShortcutSettings() {
  return (
    <div className="settings-content shortcut-settings">
      <header>
        <h1>Keyboard shortcuts</h1>
        <p>
          Speed up common actions. Source writes require an explicit command or
          Studio action.
        </p>
      </header>
      {shortcutGroups.map(([label, items]) => (
        <section key={label}>
          <span className="section-label">{label}</span>
          {items.map(([name, keys]) => (
            <div className="shortcut-row" key={name}>
              <strong>{name}</strong>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function AboutSettings() {
  const resources = [
    [Code2, "Source code", topoProduct.repository, topoProduct.links.source],
    [
      BookOpen,
      "Documentation",
      "Repository docs",
      topoProduct.links.documentation,
    ],
    [Bug, "Report an issue", "GitHub Issues", topoProduct.links.issues],
    [Shield, "License", topoProduct.license, topoProduct.links.license],
  ] as const;
  return (
    <div className="settings-content about-settings">
      <header>
        <h1>About Topo</h1>
        <p>Version, license and project links.</p>
      </header>
      <div className="about-product">
        <div className="about-mark">T</div>
        <div>
          <h2>
            Topo{" "}
            <span>{distributionLabel(topoProduct.distribution.status)}</span>
          </h2>
          <p>
            Version {topoProduct.version} · {topoProduct.license} ·{" "}
            {topoProduct.distribution.packageName}
          </p>
        </div>
        <a href={topoProduct.links.releases} rel="noreferrer" target="_blank">
          View releases
        </a>
      </div>
      <p className="about-copy">
        A local-first, code-native application atlas. Your repository stays the
        only source of truth — Topo just keeps the map current.
      </p>
      <div className="resource-list">
        {resources.map(([Icon, label, value, href]) => {
          const ResourceIcon = Icon as typeof Code2;
          return (
            <a href={href} key={String(label)} rel="noreferrer" target="_blank">
              <ResourceIcon size={14} />
              <strong>{String(label)}</strong>
              <span>{String(value)}</span>
              <ExternalLink size={11} />
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  const view = props.view === "light" ? "light" : props.view;
  return (
    <div className="settings-view">
      <div className="settings-layout">
        <SettingsNav onNavigate={props.onNavigate} view={view} />
        {view === "adapters" ? (
          <AdaptersSettings {...props} />
        ) : view === "capture" ? (
          <CaptureSettings {...props} />
        ) : view === "shortcuts" ? (
          <ShortcutSettings />
        ) : view === "about" ? (
          <AboutSettings />
        ) : (
          <GeneralSettings {...props} />
        )}
      </div>
    </div>
  );
}
