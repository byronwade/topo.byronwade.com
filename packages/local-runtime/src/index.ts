import { isIP } from "node:net";

import {
  startApplicationRuntime,
  type ApplicationRuntimeExit,
  type ApplicationRuntimeLog,
  type ApplicationRuntimeOwnership,
  type TopoApplicationRuntime,
} from "@topo/application-runtime";
import {
  TopoConfigSchema,
  type TopoConfig,
  type TopoProject,
} from "@topo/config";
import { createDaemon, type TopoDaemon } from "@topo/daemon";
import {
  createPreviewGateway,
  type PreviewGateway,
  type PreviewGatewaySession,
} from "@topo/gateway";
import { startStudioHost, type TopoStudioHost } from "@topo/studio-host";

export interface StartTopoLocalRuntimeOptions {
  project: TopoProject;
  /** Compiled production Studio directory. Required when Studio is enabled. */
  studioAssetsDir?: string;
  /** Runtime-only override for the configured application preview port. */
  previewPort?: number;
  /** Zero selects an ephemeral daemon port. */
  daemonPort?: number;
  /** Zero selects an ephemeral Studio port. */
  studioPort?: number;
  watch?: boolean;
  startApplication?: boolean;
  startStudio?: boolean;
  onApplicationLog?: (entry: ApplicationRuntimeLog) => void;
}

export interface TopoLocalRuntime {
  readonly projectRoot: string;
  readonly sourceRoot: string;
  readonly application?: {
    readonly baseUrl: string;
    readonly ownership: ApplicationRuntimeOwnership;
    readonly adapterId: string;
    readonly pid?: number;
  };
  readonly applicationExit?: Promise<ApplicationRuntimeExit>;
  readonly daemon: {
    readonly host: string;
    readonly port: number;
    readonly url: string;
  };
  readonly preview: {
    readonly mode: "gateway" | "direct";
    /** Native application origin behind any profile gateway. */
    readonly targetBaseUrl: string;
    /** First clean profile origin, or the direct native application origin. */
    readonly baseUrl: string;
    readonly profiles: readonly string[];
    readonly origins: readonly string[];
  };
  readonly studio?: {
    readonly host: string;
    readonly port: number;
    readonly url: string;
  };
  readonly watching: boolean;
  close(): Promise<void>;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

function browserOrigin(host: string, port: number): string {
  let browserHost = host.replace(/^\[|\]$/g, "");
  if (browserHost === "0.0.0.0") browserHost = "127.0.0.1";
  if (browserHost === "::") browserHost = "::1";
  if (browserHost.includes(":")) browserHost = `[${browserHost}]`;
  return `http://${browserHost}:${port}`;
}

function validatePort(
  value: number | undefined,
  name: string,
  allowZero: boolean,
): void {
  if (value === undefined) return;
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum || value > 65_535) {
    throw new Error(
      `${name} must be an integer from ${minimum} through 65535.`,
    );
  }
}

function withPreviewPort(config: TopoConfig, port?: number): TopoConfig {
  if (port === undefined) return config;
  validatePort(port, "previewPort", false);
  const baseUrl = new URL(config.preview.baseUrl);
  if (baseUrl.protocol !== "http:" || !isLoopbackHostname(baseUrl.hostname)) {
    throw new Error(
      "previewPort can override only a loopback HTTP application origin.",
    );
  }
  baseUrl.port = String(port);
  return TopoConfigSchema.parse({
    ...config,
    preview: { ...config.preview, baseUrl: baseUrl.origin },
  });
}

async function closeStartedResources(resources: {
  studio?: TopoStudioHost;
  daemon?: TopoDaemon;
  gateway?: PreviewGateway;
  application?: TopoApplicationRuntime;
}): Promise<void> {
  const results = await Promise.allSettled([
    resources.studio?.close() ?? Promise.resolve(),
    resources.daemon?.close() ?? Promise.resolve(),
    resources.gateway?.close() ?? Promise.resolve(),
    resources.application?.close() ?? Promise.resolve(),
  ]);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "Topo local runtime shutdown failed.");
  }
}

function publicPreviewSummary(
  config: TopoConfig,
  sessions: readonly PreviewGatewaySession[],
): TopoLocalRuntime["preview"] {
  if (sessions.length === 0) {
    return Object.freeze({
      mode: "direct" as const,
      targetBaseUrl: config.preview.baseUrl,
      baseUrl: config.preview.baseUrl,
      profiles: Object.freeze(config.profiles.map((profile) => profile.name)),
      origins: Object.freeze([new URL(config.preview.baseUrl).origin]),
    });
  }
  return Object.freeze({
    mode: "gateway" as const,
    targetBaseUrl: config.preview.baseUrl,
    baseUrl: sessions[0]!.baseUrl,
    profiles: Object.freeze(sessions.map((session) => session.profileName)),
    origins: Object.freeze(sessions.map((session) => session.baseUrl)),
  });
}

/**
 * Start the complete local Topo stack transactionally.
 *
 * The returned handle is the only lifecycle interface callers need. If any
 * startup stage fails, every stage that already started is closed before the
 * error is rethrown. `close()` is idempotent.
 */
export async function startTopoLocalRuntime(
  options: StartTopoLocalRuntimeOptions,
): Promise<TopoLocalRuntime> {
  validatePort(options.daemonPort, "daemonPort", true);
  validatePort(options.studioPort, "studioPort", true);
  const project = options.project;
  const config = withPreviewPort(project.config, options.previewPort);
  const watching = options.watch ?? true;
  const shouldStartApplication = options.startApplication ?? true;
  const shouldStartStudio = options.startStudio ?? true;
  if (shouldStartStudio && !options.studioAssetsDir) {
    throw new Error(
      "studioAssetsDir is required when the local Studio is enabled.",
    );
  }

  let application: TopoApplicationRuntime | undefined;
  let gateway: PreviewGateway | undefined;
  let sessions: readonly PreviewGatewaySession[] = [];
  let daemon: TopoDaemon | undefined;
  let studio: TopoStudioHost | undefined;

  try {
    if (shouldStartApplication) {
      const command = config.preview.server.command;
      application = await startApplicationRuntime({
        rootDir: project.sourceRoot,
        adapterRootDir: project.projectRoot,
        baseUrl: config.preview.baseUrl,
        mode: config.preview.server.mode,
        command: command ? (command as [string, ...string[]]) : undefined,
        cwd: config.preview.server.cwd,
        readyTimeoutMs: config.preview.server.readyTimeoutMs,
        adapterModules: config.extensions.applicationRuntimeAdapters,
        onLog: options.onApplicationLog,
      });
    }

    const previewUrl = new URL(config.preview.baseUrl);
    if (
      previewUrl.protocol === "http:" &&
      isLoopbackHostname(previewUrl.hostname)
    ) {
      gateway = createPreviewGateway({
        targetBaseUrl: config.preview.baseUrl,
        host: "127.0.0.1",
        port: 0,
        profiles: config.profiles,
      });
      sessions = await gateway.listen();
    }

    daemon = await createDaemon({
      projectRoot: project.projectRoot,
      sourceRoot: project.sourceRoot,
      config,
      host: config.daemon.host,
      port: options.daemonPort ?? config.daemon.port,
      watch: watching,
      previewSessions: sessions,
      livePreviewBaseUrl: sessions[0]?.baseUrl,
    });
    await daemon.listen();

    if (shouldStartStudio) {
      studio = await startStudioHost({
        assetsDir: options.studioAssetsDir!,
        daemonUrl: browserOrigin(daemon.host, daemon.port),
        frameOrigins: [
          ...sessions.map((session) => session.baseUrl),
          ...Object.values(config.studio.destinations).flatMap((destination) =>
            destination.url ? [new URL(destination.url).origin] : [],
          ),
        ],
        host: "127.0.0.1",
        port: options.studioPort ?? 4173,
        fallbackToRandomPort: options.studioPort === undefined,
      });
    }
  } catch (error) {
    try {
      await closeStartedResources({ studio, daemon, gateway, application });
    } catch (shutdownError) {
      throw new AggregateError(
        [error, shutdownError],
        "Topo local runtime startup and rollback failed.",
      );
    }
    throw error;
  }

  if (!daemon) throw new Error("Topo local runtime did not start its daemon.");
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= closeStartedResources({
      studio,
      daemon,
      gateway,
      application,
    });
    return closePromise;
  };
  const applicationSummary = application
    ? Object.freeze({
        baseUrl: application.baseUrl,
        ownership: application.ownership,
        adapterId: application.adapterId,
        ...(application.pid === undefined ? {} : { pid: application.pid }),
      })
    : undefined;
  const studioSummary = studio
    ? Object.freeze({ host: studio.host, port: studio.port, url: studio.url })
    : undefined;

  return Object.freeze({
    projectRoot: project.projectRoot,
    sourceRoot: project.sourceRoot,
    ...(applicationSummary ? { application: applicationSummary } : {}),
    ...(application?.exit ? { applicationExit: application.exit } : {}),
    daemon: Object.freeze({
      host: daemon.host,
      port: daemon.port,
      url: browserOrigin(daemon.host, daemon.port),
    }),
    preview: publicPreviewSummary(config, sessions),
    ...(studioSummary ? { studio: studioSummary } : {}),
    watching,
    close,
  });
}
