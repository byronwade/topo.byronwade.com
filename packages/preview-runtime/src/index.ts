import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import react from "@vitejs/plugin-react";
import {
  createServer,
  searchForWorkspaceRoot,
  type Plugin,
  type ViteDevServer,
} from "vite";

export interface TopoPreviewRuntimeOptions {
  rootDir: string;
  host?: string;
  port?: number;
  token?: string;
}

export interface TopoPreviewRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

interface PreviewRequest {
  source: string;
  exportName: string;
  absoluteSource: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mdx"]);
const EXPORT_NAME_PATTERN = /^(?:default|[$A-Z_a-z][$\w]*)$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Topo preview runtime may only bind to a loopback host; received "${host}".`,
    );
  }
}

function capabilityToken(candidate?: string): string {
  const token = candidate ?? randomBytes(32).toString("hex");
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(
      "Topo preview runtime capability tokens must contain at least 32 URL-safe characters.",
    );
  }
  return token;
}

async function parsePreviewRequest(
  requestUrl: URL,
  absoluteRoot: string,
): Promise<PreviewRequest> {
  const source = requestUrl.searchParams.get("source") ?? "";
  const exportName = requestUrl.searchParams.get("export") ?? "";

  if (
    !source ||
    source.includes("\\") ||
    source.startsWith("/") ||
    source.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(
      `Preview source must be a workspace-relative POSIX path; received "${source}".`,
    );
  }
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(source).toLowerCase())) {
    throw new Error(
      `Preview source "${source}" must use one of: ${[...SOURCE_EXTENSIONS].join(", ")}.`,
    );
  }
  if (!EXPORT_NAME_PATTERN.test(exportName)) {
    throw new Error(
      `Preview export must be "default" or a JavaScript identifier; received "${exportName}".`,
    );
  }

  const absoluteSource = path.resolve(absoluteRoot, ...source.split("/"));
  const relative = path.relative(absoluteRoot, absoluteSource);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Preview source "${source}" resolves outside the project root.`,
    );
  }
  const sourceStat = await stat(absoluteSource).catch(() => undefined);
  if (!sourceStat?.isFile()) {
    throw new Error(
      `Preview source "${source}" does not exist or is not a file.`,
    );
  }

  return { source, exportName, absoluteSource };
}

function applySecurityHeaders(
  response: import("node:http").ServerResponse,
): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
}

function previewDocument(
  capabilityPath: string,
  request: PreviewRequest,
): string {
  const entry = new URL("http://topo.invalid");
  entry.pathname = `${capabilityPath}__entry.js`;
  entry.searchParams.set("source", request.source);
  entry.searchParams.set("export", request.exportName);
  return `<!doctype html>
<html lang="en" data-topo-preview-status="loading">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${request.exportName} · Topo preview</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      html, body, #topo-preview-root { min-height: 100%; margin: 0; }
      body { background: Canvas; color: CanvasText; }
    </style>
  </head>
  <body>
    <div id="topo-preview-root" aria-live="polite"></div>
    <script type="module" src="${entry.pathname}${entry.search}"></script>
  </body>
</html>`;
}

function fsModuleUrl(absoluteSource: string): string {
  const normalized = absoluteSource.replace(/\\/g, "/");
  return `/@fs/${normalized}`;
}

function previewEntryModule(request: PreviewRequest): string {
  const moduleUrl = fsModuleUrl(request.absoluteSource);
  return `import React from "react";
import ReactDOMClient from "react-dom/client";
import ReactDOM from "react-dom";
import * as PreviewModule from ${JSON.stringify(moduleUrl)};

const { createRoot } = ReactDOMClient;
const { flushSync } = ReactDOM;
const source = ${JSON.stringify(request.source)};
const exportName = ${JSON.stringify(request.exportName)};
const rootElement = document.querySelector("#topo-preview-root");

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function showError(error) {
  document.documentElement.dataset.topoPreviewStatus = "error";
  rootElement.replaceChildren();
  const panel = document.createElement("main");
  panel.setAttribute("data-topo-preview-error", "true");
  panel.style.cssText = "max-width:760px;margin:48px auto;padding:24px;border:1px solid #ef4444;background:#450a0a;color:#fecaca;border-radius:8px;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap";
  panel.textContent = [
    "Topo component preview failed",
    "Source: " + source,
    "Export: " + exportName,
    "Error: " + errorMessage(error),
  ].join("\\n");
  rootElement.append(panel);
  console.error("[topo-preview]", error);
}

class TopoPreviewBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    showError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function ReadySignal() {
  React.useEffect(() => {
    if (document.documentElement.dataset.topoPreviewStatus !== "error") {
      document.documentElement.dataset.topoPreviewStatus = "ready";
    }
  }, []);
  return null;
}

try {
  const candidate = PreviewModule[exportName];
  if (candidate === undefined) {
    throw new Error('Export "' + exportName + '" was not found in "' + source + '".');
  }
  const renderable = React.isValidElement(candidate)
    ? candidate
    : typeof candidate === "function" || (candidate && typeof candidate === "object" && candidate.$$typeof)
      ? React.createElement(candidate)
      : undefined;
  if (!renderable) {
    throw new Error('Export "' + exportName + '" is not a renderable React component or element.');
  }

  const root = createRoot(rootElement, { onUncaughtError: showError });
  flushSync(() => {
    root.render(
      React.createElement(
        TopoPreviewBoundary,
        null,
        React.createElement(React.Fragment, null, renderable, React.createElement(ReadySignal)),
      ),
    );
  });
} catch (error) {
  showError(error);
}
`;
}

function sendBadRequest(
  response: import("node:http").ServerResponse,
  error: unknown,
): void {
  applySecurityHeaders(response);
  response.statusCode = 400;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(
    error instanceof Error ? error.message : "Invalid preview request",
  );
}

function topoPreviewPlugin(
  absoluteRoot: string,
  capabilityPath: string,
): Plugin {
  const previewPath = `${capabilityPath}preview`;
  const entryPath = `${capabilityPath}__entry.js`;
  const virtualEntryPrefix = "\0topo-preview-entry?";

  return {
    name: "topo-preview-runtime",
    enforce: "pre",
    resolveId(id) {
      const queryIndex = id.indexOf("?");
      const pathname = queryIndex === -1 ? id : id.slice(0, queryIndex);
      if (!pathname.endsWith("/__entry.js")) return undefined;
      const query = queryIndex === -1 ? "" : id.slice(queryIndex + 1);
      return `${virtualEntryPrefix}${query}`;
    },
    async load(id) {
      if (!id.startsWith(virtualEntryPrefix)) return undefined;
      const requestUrl = new URL(
        `http://127.0.0.1/preview?${id.slice(virtualEntryPrefix.length)}`,
      );
      const previewRequest = await parsePreviewRequest(
        requestUrl,
        absoluteRoot,
      );
      return previewEntryModule(previewRequest);
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        if (!request.url) return next();
        const requestUrl = new URL(request.url, "http://127.0.0.1");
        if (!requestUrl.pathname.startsWith(capabilityPath)) {
          applySecurityHeaders(response);
          response.statusCode = 404;
          response.setHeader("content-type", "text/plain; charset=utf-8");
          response.end("Not found");
          return;
        }
        if (requestUrl.pathname === capabilityPath) {
          applySecurityHeaders(response);
          response.statusCode = 200;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(
            JSON.stringify({
              service: "topo-preview-runtime",
              version: 1,
              previewPath: `${capabilityPath}preview`,
            }),
          );
          return;
        }
        if (requestUrl.pathname === entryPath) {
          next();
          return;
        }
        if (requestUrl.pathname !== previewPath) {
          next();
          return;
        }

        void parsePreviewRequest(requestUrl, absoluteRoot)
          .then((previewRequest) => {
            applySecurityHeaders(response);
            response.statusCode = 200;
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.end(previewDocument(capabilityPath, previewRequest));
          })
          .catch((error: unknown) => sendBadRequest(response, error));
      });
    },
  };
}

function addressHost(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

export async function startTopoPreviewRuntime(
  options: TopoPreviewRuntimeOptions,
): Promise<TopoPreviewRuntime> {
  const absoluteRoot = path.resolve(options.rootDir);
  const host = options.host ?? "127.0.0.1";
  assertLoopbackHost(host);
  const token = capabilityToken(options.token);
  const capabilityPath = `/__topo/${token}/`;

  const server = await createServer({
    root: absoluteRoot,
    base: capabilityPath,
    appType: "custom",
    configFile: false,
    clearScreen: false,
    logLevel: "error",
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: [
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom",
        "react-dom/client",
      ],
    },
    plugins: [react(), topoPreviewPlugin(absoluteRoot, capabilityPath)],
    server: {
      host,
      port: options.port ?? 0,
      strictPort: options.port !== undefined && options.port !== 0,
      hmr: false,
      cors: false,
      fs: {
        strict: true,
        allow: [absoluteRoot, searchForWorkspaceRoot(absoluteRoot)],
      },
    },
  });

  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }

  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    await server.close();
    throw new Error("Topo preview runtime did not expose a TCP address.");
  }

  let closed = false;
  const baseUrl = `http://${addressHost(address.address)}:${address.port}${capabilityPath}`;
  return {
    baseUrl,
    async close() {
      if (closed) return;
      closed = true;
      await server.close();
    },
  };
}
