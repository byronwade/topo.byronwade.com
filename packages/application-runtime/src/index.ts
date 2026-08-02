import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const APPLICATION_RUNTIME_ADAPTER_API_VERSION = 1 as const;

export type MaybePromise<T> = T | Promise<T>;
export type ApplicationRuntimeMode = "auto" | "external" | "managed";
export type ApplicationRuntimeOwnership = "reused" | "managed";
export type ApplicationPackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface ApplicationRuntimeContext {
  rootDir: string;
  baseUrl: string;
  host: string;
  port: number;
  packageManager: ApplicationPackageManager;
  packageName?: string;
  scripts: Readonly<Record<string, string>>;
  dependencies: ReadonlySet<string>;
}

export type ApplicationRuntimeCommand =
  | {
      type: "package-script";
      script: string;
      args?: readonly string[];
    }
  | {
      type: "process";
      executable: string;
      args?: readonly string[];
    };

export interface ApplicationRuntimeResolution {
  confidence: number;
  reasons: readonly string[];
  command: ApplicationRuntimeCommand;
}

export interface ResolvedApplicationRuntimeAdapter {
  adapterId: string;
  resolution: ApplicationRuntimeResolution;
}

export interface ApplicationRuntimeAdapter {
  readonly apiVersion: typeof APPLICATION_RUNTIME_ADAPTER_API_VERSION;
  readonly id: string;
  readonly displayName: string;
  resolve(
    context: ApplicationRuntimeContext,
  ): MaybePromise<ApplicationRuntimeResolution | undefined>;
}

export interface ApplicationRuntimeLog {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ApplicationRuntimeExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  expected: boolean;
}

export interface StartApplicationRuntimeOptions {
  /** Application package root used for commands and framework detection. */
  rootDir: string;
  /** Project root used to resolve configured adapter packages and relative modules. */
  adapterRootDir?: string;
  baseUrl: string;
  mode?: ApplicationRuntimeMode;
  /** A tokenized executable plus arguments. No shell interpolation is used. */
  command?: readonly [string, ...string[]];
  /** Relative to rootDir unless absolute. */
  cwd?: string;
  readyTimeoutMs?: number;
  adapterModules?: readonly string[];
  adapters?: readonly ApplicationRuntimeAdapter[];
  onLog?: (log: ApplicationRuntimeLog) => void;
  fetch?: typeof fetch;
  spawn?: typeof spawn;
}

export interface TopoApplicationRuntime {
  readonly baseUrl: string;
  readonly ownership: ApplicationRuntimeOwnership;
  readonly adapterId: string;
  readonly pid?: number;
  /** Present only for a process owned by Topo. */
  readonly exit?: Promise<ApplicationRuntimeExit>;
  getRecentLogs(): readonly ApplicationRuntimeLog[];
  close(): Promise<void>;
}

export class ApplicationRuntimeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationRuntimeContractError";
  }
}

export class ApplicationRuntimeStartError extends Error {
  readonly logs: readonly ApplicationRuntimeLog[];

  constructor(message: string, logs: readonly ApplicationRuntimeLog[] = []) {
    const evidence = logs.length
      ? `\n\nRecent application output:\n${logs.map((line) => `[${line.stream}] ${line.text}`).join("\n")}`
      : "";
    super(`${message}${evidence}`);
    this.name = "ApplicationRuntimeStartError";
    this.logs = logs;
  }
}

const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const MAX_LOG_LINES = 100;
const MAX_LOG_LINE_LENGTH = 2_000;
const DEFAULT_READY_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 2_000;
const POLL_INTERVAL_MS = 125;

function assertAdapter(adapter: ApplicationRuntimeAdapter): void {
  if (typeof adapter !== "object" || adapter === null) {
    throw new ApplicationRuntimeContractError(
      "An application runtime adapter export must be an object.",
    );
  }
  if (adapter.apiVersion !== APPLICATION_RUNTIME_ADAPTER_API_VERSION) {
    throw new ApplicationRuntimeContractError(
      `Application runtime adapter "${adapter.id || "<unknown>"}" targets API version ${String(adapter.apiVersion)}; Topo requires ${APPLICATION_RUNTIME_ADAPTER_API_VERSION}.`,
    );
  }
  if (typeof adapter.id !== "string" || !ADAPTER_ID_PATTERN.test(adapter.id)) {
    throw new ApplicationRuntimeContractError(
      "Application runtime adapter ids must begin with a lowercase letter and contain only lowercase letters, numbers, dots, and hyphens.",
    );
  }
  if (typeof adapter.displayName !== "string" || !adapter.displayName.trim()) {
    throw new ApplicationRuntimeContractError(
      `Application runtime adapter "${adapter.id}" must have a display name.`,
    );
  }
  if (typeof adapter.resolve !== "function") {
    throw new ApplicationRuntimeContractError(
      `Application runtime adapter "${adapter.id}" must implement resolve().`,
    );
  }
}

function assertResolution(
  adapter: ApplicationRuntimeAdapter,
  value: ApplicationRuntimeResolution | undefined,
): void {
  if (value === undefined) return;
  if (
    typeof value !== "object" ||
    value === null ||
    !Number.isFinite(value.confidence) ||
    value.confidence <= 0 ||
    value.confidence > 1 ||
    !Array.isArray(value.reasons) ||
    value.reasons.length === 0 ||
    value.reasons.some((reason) => typeof reason !== "string" || !reason.trim())
  ) {
    throw new ApplicationRuntimeContractError(
      `Application runtime adapter "${adapter.id}" returned invalid match evidence.`,
    );
  }
  const command = value.command;
  if (
    typeof command !== "object" ||
    command === null ||
    (command.type !== "package-script" && command.type !== "process") ||
    (command.type === "package-script" &&
      (typeof command.script !== "string" || !command.script.trim())) ||
    (command.type === "process" &&
      (typeof command.executable !== "string" || !command.executable.trim())) ||
    (command.args !== undefined &&
      (!Array.isArray(command.args) ||
        command.args.some((argument) => typeof argument !== "string")))
  ) {
    throw new ApplicationRuntimeContractError(
      `Application runtime adapter "${adapter.id}" returned an invalid command.`,
    );
  }
}

export function defineApplicationRuntimeAdapter<
  const TAdapter extends ApplicationRuntimeAdapter,
>(adapter: TAdapter): TAdapter {
  assertAdapter(adapter);
  return adapter;
}

function dependency(context: ApplicationRuntimeContext, name: string): boolean {
  return context.dependencies.has(name);
}

export const nextApplicationRuntimeAdapter = defineApplicationRuntimeAdapter({
  apiVersion: APPLICATION_RUNTIME_ADAPTER_API_VERSION,
  id: "next",
  displayName: "Next.js",
  resolve(context): ApplicationRuntimeResolution | undefined {
    if (!dependency(context, "next") || !context.scripts.dev) return undefined;
    return {
      confidence: 1,
      reasons: ["The package declares Next.js and a dev script."],
      command: {
        type: "package-script",
        script: "dev",
        args: ["--hostname", context.host, "--port", String(context.port)],
      },
    };
  },
});

export const tanStackApplicationRuntimeAdapter =
  defineApplicationRuntimeAdapter({
    apiVersion: APPLICATION_RUNTIME_ADAPTER_API_VERSION,
    id: "tanstack",
    displayName: "TanStack",
    resolve(context): ApplicationRuntimeResolution | undefined {
      const isTanStack =
        dependency(context, "@tanstack/react-router") ||
        dependency(context, "@tanstack/react-start") ||
        dependency(context, "@tanstack/start");
      if (!isTanStack || !context.scripts.dev) return undefined;
      const args = dependency(context, "vite")
        ? [
            "--host",
            context.host,
            "--port",
            String(context.port),
            "--strictPort",
          ]
        : [];
      return {
        confidence: 0.95,
        reasons: [
          "The package declares TanStack Router or Start and a dev script.",
        ],
        command: { type: "package-script", script: "dev", args },
      };
    },
  });

export const nuxtApplicationRuntimeAdapter = defineApplicationRuntimeAdapter({
  apiVersion: APPLICATION_RUNTIME_ADAPTER_API_VERSION,
  id: "nuxt",
  displayName: "Nuxt",
  resolve(context): ApplicationRuntimeResolution | undefined {
    if (!dependency(context, "nuxt") || !context.scripts.dev) return undefined;
    return {
      confidence: 1,
      reasons: ["The package declares Nuxt and a dev script."],
      command: {
        type: "package-script",
        script: "dev",
        args: ["--host", context.host, "--port", String(context.port)],
      },
    };
  },
});

export const viteApplicationRuntimeAdapter = defineApplicationRuntimeAdapter({
  apiVersion: APPLICATION_RUNTIME_ADAPTER_API_VERSION,
  id: "vite",
  displayName: "Vite",
  resolve(context): ApplicationRuntimeResolution | undefined {
    if (!dependency(context, "vite") || !context.scripts.dev) return undefined;
    return {
      confidence: 0.9,
      reasons: ["The package declares Vite and a dev script."],
      command: {
        type: "package-script",
        script: "dev",
        args: [
          "--host",
          context.host,
          "--port",
          String(context.port),
          "--strictPort",
        ],
      },
    };
  },
});

export const packageScriptApplicationRuntimeAdapter =
  defineApplicationRuntimeAdapter({
    apiVersion: APPLICATION_RUNTIME_ADAPTER_API_VERSION,
    id: "package-script",
    displayName: "Package dev script",
    resolve(context): ApplicationRuntimeResolution | undefined {
      if (!context.scripts.dev) return undefined;
      return {
        confidence: 0.25,
        reasons: ["The package declares a dev script."],
        command: { type: "package-script", script: "dev" },
      };
    },
  });

export const builtInApplicationRuntimeAdapters: readonly ApplicationRuntimeAdapter[] =
  Object.freeze([
    nextApplicationRuntimeAdapter,
    nuxtApplicationRuntimeAdapter,
    tanStackApplicationRuntimeAdapter,
    viteApplicationRuntimeAdapter,
    packageScriptApplicationRuntimeAdapter,
  ]);

function adapterExports(value: unknown): ApplicationRuntimeAdapter[] {
  if (Array.isArray(value)) return value.flatMap(adapterExports);
  if (typeof value !== "object" || value === null) return [];
  return [value as ApplicationRuntimeAdapter];
}

async function loadAdapterModule(
  rootDir: string,
  specifier: string,
): Promise<ApplicationRuntimeAdapter[]> {
  try {
    const projectRequire = createRequire(path.join(rootDir, "package.json"));
    const resolved =
      specifier.startsWith(".") || path.isAbsolute(specifier)
        ? path.resolve(rootDir, specifier)
        : projectRequire.resolve(specifier);
    const loaded = (await import(pathToFileURL(resolved).href)) as Record<
      string,
      unknown
    >;
    const exported =
      loaded.applicationRuntimeAdapters ??
      loaded.applicationRuntimeAdapter ??
      loaded.default;
    const adapters = adapterExports(exported);
    if (adapters.length === 0) {
      throw new Error(
        "Expected a default export, applicationRuntimeAdapter export, or applicationRuntimeAdapters array.",
      );
    }
    adapters.forEach(assertAdapter);
    return adapters;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApplicationRuntimeContractError(
      `Unable to load application runtime adapter module "${specifier}": ${detail}`,
    );
  }
}

export async function loadApplicationRuntimeAdapterModules(
  rootDir: string,
  specifiers: readonly string[],
): Promise<ApplicationRuntimeAdapter[]> {
  const loaded = await Promise.all(
    specifiers.map((specifier) => loadAdapterModule(rootDir, specifier)),
  );
  return loaded.flat();
}

interface PackageManifest {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readManifest(
  filePath: string,
): Promise<PackageManifest | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PackageManifest;
  } catch {
    return undefined;
  }
}

function declaredPackageManager(
  value: string | undefined,
): ApplicationPackageManager | undefined {
  const name = value?.split("@")[0];
  return name === "pnpm" || name === "npm" || name === "yarn" || name === "bun"
    ? name
    : undefined;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(
  rootDir: string,
  manifest: PackageManifest,
): Promise<ApplicationPackageManager> {
  const declared = declaredPackageManager(manifest.packageManager);
  if (declared) return declared;
  let current = rootDir;
  while (true) {
    const parentManifest = await readManifest(
      path.join(current, "package.json"),
    );
    const parentDeclared = declaredPackageManager(
      parentManifest?.packageManager,
    );
    if (parentDeclared) return parentDeclared;
    if (await exists(path.join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (await exists(path.join(current, "bun.lock"))) return "bun";
    if (await exists(path.join(current, "bun.lockb"))) return "bun";
    if (await exists(path.join(current, "yarn.lock"))) return "yarn";
    if (await exists(path.join(current, "package-lock.json"))) return "npm";
    const parent = path.dirname(current);
    if (parent === current) return "npm";
    current = parent;
  }
}

function parseBaseUrl(baseUrl: string): {
  normalized: string;
  host: string;
  port: number;
  isLoopback: boolean;
  isHttp: boolean;
} {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApplicationRuntimeStartError(
      `Application preview base URL is invalid: ${baseUrl}`,
    );
  }
  if (url.username || url.password) {
    throw new ApplicationRuntimeStartError(
      "Application preview base URL cannot contain credentials.",
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isHttp = url.protocol === "http:";
  const isLoopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ApplicationRuntimeStartError(
      `Application preview base URL has an invalid port: ${baseUrl}`,
    );
  }
  return {
    normalized: url.toString(),
    host: hostname === "localhost" ? "127.0.0.1" : hostname,
    port,
    isLoopback,
    isHttp,
  };
}

async function isReady(
  baseUrl: string,
  fetchImplementation: typeof fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetchImplementation(baseUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function packageManagerExecutable(manager: ApplicationPackageManager): string {
  return process.platform === "win32" ? `${manager}.cmd` : manager;
}

function materializeCommand(
  resolution: ApplicationRuntimeResolution,
  packageManager: ApplicationPackageManager,
): readonly [string, ...string[]] {
  if (resolution.command.type === "process") {
    return [resolution.command.executable, ...(resolution.command.args ?? [])];
  }
  return [
    packageManagerExecutable(packageManager),
    "run",
    resolution.command.script,
    ...(resolution.command.args?.length
      ? [
          ...(packageManager === "npm" ? ["--"] : []),
          ...resolution.command.args,
        ]
      : []),
  ];
}

function normalizeExplicitCommand(
  command: readonly [string, ...string[]],
): readonly [string, ...string[]] {
  const [executable, ...args] = command;
  if (
    !executable.trim() ||
    command.some((token) => typeof token !== "string")
  ) {
    throw new ApplicationRuntimeStartError(
      "Application preview command must contain non-empty string tokens.",
    );
  }
  const normalized =
    process.platform === "win32" &&
    (executable === "pnpm" ||
      executable === "npm" ||
      executable === "yarn" ||
      executable === "bun")
      ? `${executable}.cmd`
      : executable;
  return [normalized, ...args];
}

interface PreparedSpawnCommand {
  executable: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

function resolveWindowsShim(executable: string): string {
  if (path.isAbsolute(executable) || /[\\/]/.test(executable))
    return executable;
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const normalized = directory.replace(/^"|"$/g, "");
    if (!normalized) continue;
    const candidate = path.join(normalized, executable);
    if (existsSync(candidate)) return candidate;
  }
  return executable;
}

function prepareSpawnCommand(
  command: readonly [string, ...string[]],
): PreparedSpawnCommand {
  const [executable, ...args] = command;
  if (
    process.platform !== "win32" ||
    (!executable.toLowerCase().endsWith(".cmd") &&
      !executable.toLowerCase().endsWith(".bat"))
  ) {
    return { executable, args, windowsVerbatimArguments: false };
  }
  const tokens = [resolveWindowsShim(executable), ...args];
  const unsafe = tokens.find((token) => /[\r\n&|<>^%!]/.test(token));
  if (unsafe !== undefined) {
    throw new ApplicationRuntimeStartError(
      "Windows package-manager command tokens cannot contain shell metacharacters.",
    );
  }
  const commandLine = tokens
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" ");
  return {
    executable: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref?.();
  });
}

function addLog(
  logs: ApplicationRuntimeLog[],
  stream: ApplicationRuntimeLog["stream"],
  text: string,
  onLog: StartApplicationRuntimeOptions["onLog"],
): void {
  const normalized = text.replace(/\r$/, "").trimEnd();
  if (!normalized) return;
  const entry = {
    stream,
    text: normalized.slice(0, MAX_LOG_LINE_LENGTH),
  } satisfies ApplicationRuntimeLog;
  logs.push(entry);
  if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
  onLog?.(entry);
}

function captureStream(
  stream: NodeJS.ReadableStream | null,
  kind: ApplicationRuntimeLog["stream"],
  logs: ApplicationRuntimeLog[],
  onLog: StartApplicationRuntimeOptions["onLog"],
): void {
  if (!stream) return;
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) addLog(logs, kind, line, onLog);
  });
  stream.on("end", () => addLog(logs, kind, pending, onLog));
}

async function terminateProcessTree(
  child: ChildProcess,
  exit: Promise<ApplicationRuntimeExit>,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    await Promise.race([exit.then(() => undefined), delay(2_000)]);
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const stopped = await Promise.race([
    exit.then(() => true),
    delay(2_000).then(() => false),
  ]);
  if (stopped) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await Promise.race([exit.then(() => undefined), delay(2_000)]);
}

export async function resolveApplicationRuntimeAdapter(
  context: ApplicationRuntimeContext,
  adapters: readonly ApplicationRuntimeAdapter[],
): Promise<ResolvedApplicationRuntimeAdapter | undefined> {
  const ids = new Set<string>();
  const matches = await Promise.all(
    adapters.map(async (adapter, index) => {
      assertAdapter(adapter);
      if (ids.has(adapter.id)) {
        throw new ApplicationRuntimeContractError(
          `Application runtime adapter id "${adapter.id}" is registered more than once.`,
        );
      }
      ids.add(adapter.id);
      const resolution = await adapter.resolve(context);
      assertResolution(adapter, resolution);
      return resolution ? { adapter, resolution, index } : undefined;
    }),
  );
  const selected = matches
    .filter((match) => match !== undefined)
    .sort(
      (left, right) =>
        right.resolution.confidence - left.resolution.confidence ||
        left.index - right.index,
    )[0];
  return selected
    ? { adapterId: selected.adapter.id, resolution: selected.resolution }
    : undefined;
}

export async function startApplicationRuntime(
  options: StartApplicationRuntimeOptions,
): Promise<TopoApplicationRuntime> {
  const mode = options.mode ?? "auto";
  if (mode !== "auto" && mode !== "external" && mode !== "managed") {
    throw new ApplicationRuntimeStartError(
      `Unsupported application runtime mode: ${String(mode)}`,
    );
  }
  const rootDir = await realpath(path.resolve(options.rootDir)).catch(() => {
    throw new ApplicationRuntimeStartError(
      `Application root does not exist: ${path.resolve(options.rootDir)}`,
    );
  });
  const parsed = parseBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? fetch;
  const alreadyReady = await isReady(parsed.normalized, fetchImplementation);

  if (alreadyReady) {
    if (mode === "managed") {
      throw new ApplicationRuntimeStartError(
        `Application preview origin is already in use: ${parsed.normalized}. Managed mode will not take ownership of an existing process.`,
      );
    }
    return {
      baseUrl: parsed.normalized,
      ownership: "reused",
      adapterId: "external",
      getRecentLogs: () => [],
      close: () => Promise.resolve(),
    };
  }

  if (mode === "external") {
    throw new ApplicationRuntimeStartError(
      `Application preview server is not reachable at ${parsed.normalized}. Start it separately or use preview.server.mode "auto".`,
    );
  }
  if (!parsed.isHttp || !parsed.isLoopback) {
    throw new ApplicationRuntimeStartError(
      `Topo only starts application preview processes for loopback HTTP origins. ${parsed.normalized} must be started externally.`,
    );
  }

  const manifest = await readManifest(path.join(rootDir, "package.json"));
  const packageManager = await detectPackageManager(rootDir, manifest ?? {});
  const scripts = manifest?.scripts ?? {};
  const dependencies = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
  const context: ApplicationRuntimeContext = {
    rootDir,
    baseUrl: parsed.normalized,
    host: parsed.host,
    port: parsed.port,
    packageManager,
    packageName: manifest?.name,
    scripts,
    dependencies,
  };
  const externalAdapters = await loadApplicationRuntimeAdapterModules(
    path.resolve(options.adapterRootDir ?? rootDir),
    options.adapterModules ?? [],
  );
  const selected = options.command
    ? {
        adapterId: "configured",
        command: normalizeExplicitCommand(options.command),
      }
    : await resolveApplicationRuntimeAdapter(context, [
        ...(options.adapters ?? []),
        ...externalAdapters,
        ...builtInApplicationRuntimeAdapters,
      ]).then((resolved) => {
        if (!resolved) {
          throw new ApplicationRuntimeStartError(
            `No application runtime adapter can start ${context.rootDir}. Add a dev package script, configure preview.server.command, or install an application runtime adapter.`,
          );
        }
        return {
          adapterId: resolved.adapterId,
          command: materializeCommand(resolved.resolution, packageManager),
        };
      });

  const cwd = path.resolve(rootDir, options.cwd ?? ".");
  const cwdReal = await realpath(cwd).catch(() => {
    throw new ApplicationRuntimeStartError(
      `Application preview working directory does not exist: ${cwd}`,
    );
  });
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  if (
    !Number.isInteger(readyTimeoutMs) ||
    readyTimeoutMs < 1_000 ||
    readyTimeoutMs > 300_000
  ) {
    throw new ApplicationRuntimeStartError(
      "Application preview ready timeout must be an integer from 1000 through 300000 milliseconds.",
    );
  }

  const preparedCommand = prepareSpawnCommand(selected.command);
  const { executable, args } = preparedCommand;
  const logs: ApplicationRuntimeLog[] = [];
  let expectedExit = false;
  let closePromise: Promise<void> | undefined;
  let resolveExit!: (exit: ApplicationRuntimeExit) => void;
  const exit = new Promise<ApplicationRuntimeExit>((resolve) => {
    resolveExit = resolve;
  });
  let observedExit: ApplicationRuntimeExit | undefined;
  const spawnImplementation = options.spawn ?? spawn;
  let child: ChildProcess;
  try {
    child = spawnImplementation(executable, args, {
      cwd: cwdReal,
      env: {
        ...process.env,
        HOST: parsed.host,
        PORT: String(parsed.port),
        TOPO_MANAGED_PREVIEW: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: preparedCommand.windowsVerbatimArguments,
      detached: process.platform !== "win32",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApplicationRuntimeStartError(
      `Unable to start application preview command ${executable}: ${detail}`,
    );
  }
  captureStream(child.stdout, "stdout", logs, options.onLog);
  captureStream(child.stderr, "stderr", logs, options.onLog);
  child.once("error", (error) => {
    addLog(logs, "stderr", error.message, options.onLog);
    if (!observedExit) {
      observedExit = { code: null, signal: null, expected: expectedExit };
      resolveExit(observedExit);
    }
  });
  child.once("exit", (code, signal) => {
    if (observedExit) return;
    observedExit = { code, signal, expected: expectedExit };
    resolveExit(observedExit);
  });

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (observedExit) {
      throw new ApplicationRuntimeStartError(
        `Application preview process exited before ${parsed.normalized} became ready (code ${String(observedExit.code)}, signal ${String(observedExit.signal)}).`,
        logs,
      );
    }
    if (await isReady(parsed.normalized, fetchImplementation)) {
      const runtime: TopoApplicationRuntime = {
        baseUrl: parsed.normalized,
        ownership: "managed",
        adapterId: selected.adapterId,
        pid: child.pid,
        exit,
        getRecentLogs: () => [...logs],
        close(): Promise<void> {
          if (closePromise) return closePromise;
          expectedExit = true;
          closePromise = terminateProcessTree(child, exit);
          return closePromise;
        },
      };
      return runtime;
    }
    await delay(POLL_INTERVAL_MS);
  }

  expectedExit = true;
  await terminateProcessTree(child, exit);
  throw new ApplicationRuntimeStartError(
    `Application preview process did not make ${parsed.normalized} ready within ${readyTimeoutMs}ms.`,
    logs,
  );
}
