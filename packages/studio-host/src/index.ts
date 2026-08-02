import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import path from "node:path";
import { gzipSync } from "node:zlib";

export const TOPO_DAEMON_URL_PLACEHOLDER = "__TOPO_DAEMON_URL__";
export const STUDIO_BUILD_REPORT_VERSION = 3 as const;

const STUDIO_BUILD_BUDGETS = {
  initialJsBytes: 300_000,
  initialJsGzipBytes: 95_000,
} as const;

const REQUIRED_DESTINATION_SOURCES = [
  "src/components/AtlasWorkspace.tsx",
  "src/components/EditorWorkspace.tsx",
  "src/components/NotesWorkspace.tsx",
  "src/components/DoctorWorkspace.tsx",
  "src/components/SettingsWorkspace.tsx",
] as const;

const REVIEW_EXPORT_SOURCE_SUFFIX = "/packages/exporter/dist/index.js";
const STUDIO_VALIDATION_SOURCE = "src/studio-validation.ts";

interface ViteManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

type ViteManifest = Readonly<Record<string, ViteManifestChunk>>;

export interface StudioBuildAsset {
  source: string;
  file: string;
  bytes: number;
  gzipBytes: number;
}

export interface StudioBuildCheck {
  id:
    | "initial-js-bytes"
    | "initial-js-gzip-bytes"
    | "lazy-destinations"
    | "lazy-pixi-runtime"
    | "lazy-review-export"
    | "lazy-studio-validation";
  status: "pass" | "fail";
  detail: string;
  evidence: Record<string, boolean | number | string | string[]>;
}

export interface StudioBuildReport {
  schemaVersion: typeof STUDIO_BUILD_REPORT_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  budgets: typeof STUDIO_BUILD_BUDGETS;
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  initial: {
    assets: StudioBuildAsset[];
    bytes: number;
    gzipBytes: number;
  };
  destinations: StudioBuildAsset[];
  pixi: {
    deferred: boolean;
    assets: StudioBuildAsset[];
  };
  reviewExport: {
    deferred: boolean;
    assets: StudioBuildAsset[];
  };
  validation: {
    deferred: boolean;
    assets: StudioBuildAsset[];
  };
  checks: StudioBuildCheck[];
}

export interface StartStudioHostOptions {
  assetsDir: string;
  daemonUrl: string;
  /** Exact loopback preview origins that may be embedded by Studio. */
  frameOrigins?: readonly string[];
  host?: string;
  port?: number;
  fallbackToRandomPort?: boolean;
}

export interface TopoStudioHost {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function isManifestChunk(value: unknown): value is ViteManifestChunk {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.file === "string" &&
    (record.src === undefined || typeof record.src === "string") &&
    (record.isEntry === undefined || typeof record.isEntry === "boolean") &&
    (record.isDynamicEntry === undefined ||
      typeof record.isDynamicEntry === "boolean") &&
    (record.imports === undefined ||
      (Array.isArray(record.imports) &&
        record.imports.every((item) => typeof item === "string"))) &&
    (record.dynamicImports === undefined ||
      (Array.isArray(record.dynamicImports) &&
        record.dynamicImports.every((item) => typeof item === "string")))
  );
}

function parseStudioManifest(
  value: unknown,
): Record<string, ViteManifestChunk> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Topo Studio build manifest must be an object");
  }
  const manifest: Record<string, ViteManifestChunk> = {};
  for (const [source, candidate] of Object.entries(value)) {
    if (!isManifestChunk(candidate)) {
      throw new Error(`Topo Studio manifest entry is invalid: ${source}`);
    }
    manifest[source] = candidate;
  }
  return manifest;
}

async function readStudioManifest(
  assetsRoot: string,
): Promise<Record<string, ViteManifestChunk>> {
  const manifestPath = path.join(assetsRoot, "manifest.json");
  try {
    return parseStudioManifest(
      JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
    );
  } catch (error) {
    throw new Error(
      `Topo Studio build manifest is unreadable at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readOptionalStudioManifest(
  assetsRoot: string,
): Promise<Record<string, ViteManifestChunk> | undefined> {
  try {
    return await readStudioManifest(assetsRoot);
  } catch (error) {
    if (
      error instanceof Error &&
      /ENOENT|cannot find the file|no such file/iu.test(error.message)
    ) {
      return undefined;
    }
    throw error;
  }
}

async function readBuildAsset(
  assetsRoot: string,
  source: string,
  chunk: ViteManifestChunk,
): Promise<StudioBuildAsset> {
  const candidate = path.resolve(assetsRoot, chunk.file);
  if (!isPathInside(assetsRoot, candidate)) {
    throw new Error(`Studio manifest asset escapes its root: ${chunk.file}`);
  }
  const resolvedCandidate = await realpath(candidate);
  if (!isPathInside(assetsRoot, resolvedCandidate)) {
    throw new Error(
      `Studio manifest asset resolves outside its root: ${chunk.file}`,
    );
  }
  const bytes = await readFile(resolvedCandidate);
  return {
    source,
    file: chunk.file.replaceAll("\\", "/"),
    bytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength,
  };
}

function collectStaticSources(
  manifest: Readonly<Record<string, ViteManifestChunk>>,
  source: string,
  collected = new Set<string>(),
): Set<string> {
  if (collected.has(source)) return collected;
  const chunk = manifest[source];
  if (!chunk) throw new Error(`Studio manifest import is missing: ${source}`);
  collected.add(source);
  for (const imported of chunk.imports ?? []) {
    collectStaticSources(manifest, imported, collected);
  }
  return collected;
}

function collectReachableSources(
  manifest: Readonly<Record<string, ViteManifestChunk>>,
  source: string,
  collected = new Set<string>(),
): Set<string> {
  if (collected.has(source)) return collected;
  const chunk = manifest[source];
  if (!chunk) throw new Error(`Studio manifest import is missing: ${source}`);
  collected.add(source);
  for (const imported of [
    ...(chunk.imports ?? []),
    ...(chunk.dynamicImports ?? []),
  ]) {
    collectReachableSources(manifest, imported, collected);
  }
  return collected;
}

/**
 * Inspect one production Studio artifact through its Vite manifest. The report
 * is JSON-safe evidence and owns the shell-size and lazy-loading policy used by
 * both source builds and the packaged CLI build.
 */
export async function inspectStudioBuild(
  assetsDir: string,
): Promise<StudioBuildReport> {
  const assetsRoot = await realpath(path.resolve(assetsDir));
  const manifest = await readStudioManifest(assetsRoot);
  const entrySource = Object.keys(manifest).find(
    (source) => manifest[source]?.isEntry === true,
  );
  if (!entrySource) throw new Error("Topo Studio manifest has no entry module");

  const initialSources = collectStaticSources(manifest, entrySource);
  const reachableSources = collectReachableSources(manifest, entrySource);
  const initialAssets = await Promise.all(
    [...initialSources].map((source) =>
      readBuildAsset(assetsRoot, source, manifest[source]!),
    ),
  );
  const initialBytes = initialAssets.reduce(
    (total, asset) => total + asset.bytes,
    0,
  );
  const initialGzipBytes = initialAssets.reduce(
    (total, asset) => total + asset.gzipBytes,
    0,
  );

  const destinationAssets = await Promise.all(
    REQUIRED_DESTINATION_SOURCES.filter((source) => manifest[source]).map(
      (source) => readBuildAsset(assetsRoot, source, manifest[source]!),
    ),
  );
  const pixiSources = Object.keys(manifest).filter(
    (source) => source.startsWith("src/Pixi") || source.includes("/pixi.js/"),
  );
  const pixiAssets = await Promise.all(
    pixiSources.map((source) =>
      readBuildAsset(assetsRoot, source, manifest[source]!),
    ),
  );
  const reviewExportSources = Object.keys(manifest).filter((source) =>
    source.replaceAll("\\", "/").endsWith(REVIEW_EXPORT_SOURCE_SUFFIX),
  );
  const reviewExportAssets = await Promise.all(
    reviewExportSources.map((source) =>
      readBuildAsset(assetsRoot, source, manifest[source]!),
    ),
  );
  const validationSources = manifest[STUDIO_VALIDATION_SOURCE]
    ? [STUDIO_VALIDATION_SOURCE]
    : [];
  const validationAssets = await Promise.all(
    validationSources.map((source) =>
      readBuildAsset(assetsRoot, source, manifest[source]!),
    ),
  );
  const missingDestinations = REQUIRED_DESTINATION_SOURCES.filter(
    (source) =>
      !manifest[source]?.isDynamicEntry || !reachableSources.has(source),
  );
  const eagerPixiSources = pixiSources.filter((source) =>
    initialSources.has(source),
  );
  const eagerReviewExportSources = reviewExportSources.filter((source) =>
    initialSources.has(source),
  );
  const unavailableReviewExportSources = reviewExportSources.filter(
    (source) =>
      !manifest[source]?.isDynamicEntry || !reachableSources.has(source),
  );
  const reviewExportDeferred =
    reviewExportSources.length > 0 &&
    eagerReviewExportSources.length === 0 &&
    unavailableReviewExportSources.length === 0;
  const eagerValidationSources = validationSources.filter((source) =>
    initialSources.has(source),
  );
  const unavailableValidationSources = validationSources.filter(
    (source) =>
      !manifest[source]?.isDynamicEntry || !reachableSources.has(source),
  );
  const validationDeferred =
    validationSources.length === 1 &&
    eagerValidationSources.length === 0 &&
    unavailableValidationSources.length === 0;

  const checks: StudioBuildCheck[] = [
    {
      id: "initial-js-bytes",
      status:
        initialBytes <= STUDIO_BUILD_BUDGETS.initialJsBytes ? "pass" : "fail",
      detail: `${initialBytes} initial JavaScript bytes against a ${STUDIO_BUILD_BUDGETS.initialJsBytes}-byte budget.`,
      evidence: {
        actualBytes: initialBytes,
        budgetBytes: STUDIO_BUILD_BUDGETS.initialJsBytes,
        files: initialAssets.map((asset) => asset.file),
      },
    },
    {
      id: "initial-js-gzip-bytes",
      status:
        initialGzipBytes <= STUDIO_BUILD_BUDGETS.initialJsGzipBytes
          ? "pass"
          : "fail",
      detail: `${initialGzipBytes} gzip bytes against a ${STUDIO_BUILD_BUDGETS.initialJsGzipBytes}-byte budget.`,
      evidence: {
        actualBytes: initialGzipBytes,
        budgetBytes: STUDIO_BUILD_BUDGETS.initialJsGzipBytes,
      },
    },
    {
      id: "lazy-destinations",
      status: missingDestinations.length === 0 ? "pass" : "fail",
      detail:
        missingDestinations.length === 0
          ? "All built-in destination workspaces are dynamic entries."
          : `${missingDestinations.length} destination workspace(s) are not lazy.`,
      evidence: {
        expected: [...REQUIRED_DESTINATION_SOURCES],
        missing: [...missingDestinations],
      },
    },
    {
      id: "lazy-pixi-runtime",
      status: eagerPixiSources.length === 0 ? "pass" : "fail",
      detail:
        eagerPixiSources.length === 0
          ? "Pixi and GPU canvas modules are absent from the static entry graph."
          : `${eagerPixiSources.length} Pixi module(s) are statically reachable from the entry.`,
      evidence: {
        deferred: eagerPixiSources.length === 0,
        eagerSources: eagerPixiSources,
        discoveredSources: pixiSources.length,
      },
    },
    {
      id: "lazy-review-export",
      status: reviewExportDeferred ? "pass" : "fail",
      detail: reviewExportDeferred
        ? "Review export rendering is reachable only through an on-demand chunk."
        : reviewExportSources.length === 0
          ? "The review export renderer is missing as an independently loadable chunk."
          : "The review export renderer is eager or unreachable from the Studio entry.",
      evidence: {
        deferred: reviewExportDeferred,
        eagerSources: eagerReviewExportSources,
        unavailableSources: unavailableReviewExportSources,
        discoveredSources: reviewExportSources.length,
      },
    },
    {
      id: "lazy-studio-validation",
      status: validationDeferred ? "pass" : "fail",
      detail: validationDeferred
        ? "Schema and protocol validation are reachable only through an on-demand chunk."
        : validationSources.length === 0
          ? "The Studio validation boundary is missing as an independently loadable chunk."
          : "The Studio validation boundary is eager or unreachable from the Studio entry.",
      evidence: {
        deferred: validationDeferred,
        eagerSources: eagerValidationSources,
        unavailableSources: unavailableValidationSources,
        discoveredSources: validationSources.length,
      },
    },
  ];
  const failed = checks.filter((check) => check.status === "fail").length;
  return {
    schemaVersion: STUDIO_BUILD_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    status: failed === 0 ? "pass" : "fail",
    budgets: STUDIO_BUILD_BUDGETS,
    summary: {
      passed: checks.length - failed,
      failed,
      total: checks.length,
    },
    initial: {
      assets: initialAssets,
      bytes: initialBytes,
      gzipBytes: initialGzipBytes,
    },
    destinations: destinationAssets,
    pixi: {
      deferred: eagerPixiSources.length === 0,
      assets: pixiAssets,
    },
    reviewExport: {
      deferred: reviewExportDeferred,
      assets: reviewExportAssets,
    },
    validation: {
      deferred: validationDeferred,
      assets: validationAssets,
    },
    checks,
  };
}

function routeDestinationSource(pathname: string): string | undefined {
  if (pathname.startsWith("/atlas/")) {
    return "src/components/AtlasWorkspace.tsx";
  }
  if (pathname.startsWith("/editor/")) {
    return "src/components/EditorWorkspace.tsx";
  }
  if (pathname === "/notes" || pathname.startsWith("/notes/")) {
    return "src/components/NotesWorkspace.tsx";
  }
  if (pathname === "/doctor" || pathname.startsWith("/doctor/")) {
    return "src/components/DoctorWorkspace.tsx";
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return "src/components/SettingsWorkspace.tsx";
  }
  return undefined;
}

function routePixiSource(pathname: string): string | undefined {
  if (pathname.startsWith("/atlas/flows")) {
    return "src/PixiTopologyCanvas.tsx";
  }
  if (pathname.startsWith("/atlas/components")) {
    return "src/PixiTopologyCanvas.tsx";
  }
  if (pathname.startsWith("/atlas/routes")) {
    return "src/PixiAtlasCanvas.tsx";
  }
  if (pathname.startsWith("/editor/canvas")) {
    return "src/PixiEditorCanvas.tsx";
  }
  return undefined;
}

function isWebGlRuntimeSource(source: string): boolean {
  const normalized = source.replaceAll("\\", "/");
  return (
    normalized.endsWith("/environment-browser/browserAll.mjs") ||
    normalized.endsWith("/environment-webworker/webworkerAll.mjs") ||
    normalized.endsWith("/rendering/renderers/gl/WebGLRenderer.mjs")
  );
}

/**
 * Return the exact route-specific module graph that should begin loading with
 * the HTML document. Dynamic destinations remain absent from unrelated routes.
 */
export function studioRoutePreloadFiles(
  manifest: ViteManifest,
  pathname: string,
): string[] {
  const sources = new Set<string>();
  const destinationSource = routeDestinationSource(pathname);
  if (destinationSource && manifest[destinationSource]) {
    collectStaticSources(manifest, destinationSource, sources);
  }
  const pixiSource = routePixiSource(pathname);
  if (pixiSource && manifest[pixiSource]) {
    collectStaticSources(manifest, pixiSource, sources);
    for (const source of Object.keys(manifest).filter(isWebGlRuntimeSource)) {
      collectStaticSources(manifest, source, sources);
    }
  }
  return [...sources]
    .filter((source) => manifest[source] && !manifest[source]!.isEntry)
    .map((source) => manifest[source]!.file.replaceAll("\\", "/"))
    .filter((file, index, files) => files.indexOf(file) === index)
    .sort();
}

function injectModulePreloads(
  indexBody: string,
  files: readonly string[],
): string {
  if (files.length === 0) return indexBody;
  const links = files
    .map(
      (file) =>
        `<link rel="modulepreload" crossorigin href="/${escapeHtmlAttribute(file)}">`,
    )
    .join("");
  return indexBody.includes("</head>")
    ? indexBody.replace("</head>", `${links}</head>`)
    : `${links}${indexBody}`;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

function formatHost(host: string): string {
  const normalized = host.replace(/^\[|\]$/g, "");
  return isIP(normalized) === 6 ? `[${normalized}]` : normalized;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function contentSecurityPolicy(
  daemonOrigin: string,
  frameOrigins: readonly string[],
): string {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${daemonOrigin}`,
    `connect-src 'self' data: ${daemonOrigin} http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`,
    `frame-src http://127.0.0.1:* http://localhost:* ${frameOrigins.join(" ")}`.trim(),
    "worker-src 'self' blob:",
  ].join("; ");
}

function writeText(
  response: ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function listen(
  server: Server,
  host: string,
  port: number,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Topo Studio host did not receive a TCP address.");
  }
  return address.port;
}

async function readableStudioDirectory(
  candidate: string,
): Promise<string | undefined> {
  try {
    const root = await realpath(path.resolve(candidate));
    const indexPath = await realpath(path.join(root, "index.html"));
    if (!isPathInside(root, indexPath) || !(await stat(indexPath)).isFile()) {
      return undefined;
    }
    return root;
  } catch {
    return undefined;
  }
}

export async function findStudioAssets(
  candidates: readonly (string | undefined)[],
): Promise<string> {
  const attempted: string[] = [];
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    const absolute = path.resolve(candidate);
    if (attempted.includes(absolute)) continue;
    attempted.push(absolute);
    const resolved = await readableStudioDirectory(absolute);
    if (resolved) return resolved;
  }
  const detail =
    attempted.length > 0 ? ` Checked: ${attempted.join(", ")}` : "";
  throw new Error(
    `Topo Studio assets were not found. Run the Studio production build or pass --studio-dir.${detail}`,
  );
}

export async function startStudioHost(
  options: StartStudioHostOptions,
): Promise<TopoStudioHost> {
  const host = options.host ?? "127.0.0.1";
  if (!isLoopbackHost(host)) {
    throw new Error(`Topo Studio must bind to loopback; received ${host}.`);
  }
  const requestedPort = options.port ?? 4173;
  if (
    !Number.isInteger(requestedPort) ||
    requestedPort < 0 ||
    requestedPort > 65_535
  ) {
    throw new Error(`Invalid Topo Studio port: ${requestedPort}.`);
  }
  const daemon = new URL(options.daemonUrl);
  if (daemon.protocol !== "http:" && daemon.protocol !== "https:") {
    throw new Error("Topo Studio daemonUrl must use HTTP or HTTPS.");
  }
  const frameOrigins = [
    ...new Set(
      (options.frameOrigins ?? []).map((value) => {
        const origin = new URL(value);
        if (
          (origin.protocol !== "http:" && origin.protocol !== "https:") ||
          !isLoopbackHost(origin.hostname)
        ) {
          throw new Error(
            `Topo Studio frame origins must use loopback HTTP: ${origin.origin}`,
          );
        }
        return origin.origin;
      }),
    ),
  ];
  const assetsRoot = await findStudioAssets([options.assetsDir]);
  const manifest = await readOptionalStudioManifest(assetsRoot);
  const indexPath = await realpath(path.join(assetsRoot, "index.html"));
  const indexTemplate = await readFile(indexPath, "utf8");
  if (!indexTemplate.includes(TOPO_DAEMON_URL_PLACEHOLDER)) {
    throw new Error(
      `Topo Studio index is missing ${TOPO_DAEMON_URL_PLACEHOLDER}; rebuild the Studio assets.`,
    );
  }
  const indexBody = indexTemplate.replaceAll(
    TOPO_DAEMON_URL_PLACEHOLDER,
    escapeHtmlAttribute(daemon.origin),
  );

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD");
        writeText(response, 405, "Method not allowed");
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(
          new URL(request.url ?? "/", "http://topo.local").pathname,
        );
      } catch {
        writeText(response, 400, "Malformed request path");
        return;
      }
      if (pathname.includes("\0")) {
        writeText(response, 400, "Malformed request path");
        return;
      }

      const relativePath = pathname.replace(/^\/+/, "");
      const indexRequest = relativePath === "" || relativePath === "index.html";
      const candidate = path.resolve(assetsRoot, relativePath);
      if (!isPathInside(assetsRoot, candidate)) {
        writeText(response, 404, "Not found");
        return;
      }

      let filePath: string | undefined;
      if (relativePath && !indexRequest) {
        try {
          const resolved = await realpath(candidate);
          if (
            isPathInside(assetsRoot, resolved) &&
            (await stat(resolved)).isFile()
          ) {
            filePath = resolved;
          }
        } catch {
          filePath = undefined;
        }
      }

      if (!filePath && !indexRequest && path.extname(relativePath)) {
        writeText(response, 404, "Not found");
        return;
      }

      if (!filePath) {
        const body = Buffer.from(
          injectModulePreloads(
            indexBody,
            manifest ? studioRoutePreloadFiles(manifest, pathname) : [],
          ),
        );
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-length": body.byteLength,
          "content-security-policy": contentSecurityPolicy(
            daemon.origin,
            frameOrigins,
          ),
          "content-type": MIME_TYPES[".html"],
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }

      const fileStats = await stat(filePath);
      const extension = path.extname(filePath).toLowerCase();
      response.writeHead(200, {
        "cache-control": relativePath.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "content-length": fileStats.size,
        "content-type": MIME_TYPES[extension] ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(filePath)
        .on("error", () => {
          if (!response.headersSent)
            writeText(response, 500, "Unable to read asset");
          else response.destroy();
        })
        .pipe(response);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      writeText(response, 500, "Unable to serve Topo Studio");
    });
  });

  let actualPort: number;
  try {
    actualPort = await listen(server, host, requestedPort);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined;
    if (
      code !== "EADDRINUSE" ||
      requestedPort === 0 ||
      !options.fallbackToRandomPort
    ) {
      throw error;
    }
    actualPort = await listen(server, host, 0);
  }

  let closed = false;
  return {
    host,
    port: actualPort,
    url: `http://${formatHost(host)}:${actualPort}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
