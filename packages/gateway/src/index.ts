import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  createServer,
  request as requestHttp,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as requestHttps } from "node:https";
import { isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { URL } from "node:url";

import WebSocket, { WebSocketServer, type RawData } from "ws";

import { createPreviewBridgeScript } from "@topo/runtime-bridge";

const SESSION_COOKIE = "topo_session";
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const DEFAULT_MAX_BODY_BYTES = 5_000_000;
const DEFAULT_MAX_HTML_BYTES = 10_000_000;
const PREVIEW_BRIDGE_SOURCE = createPreviewBridgeScript().replaceAll(
  "</script",
  "<\\/script",
);
const PREVIEW_BRIDGE_HASH = createHash("sha256")
  .update(PREVIEW_BRIDGE_SOURCE)
  .digest("base64");
const RESERVED_PROFILE_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "transfer-encoding",
  "upgrade",
  "x-topo-session",
]);

export interface GatewayProfile {
  name: string;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
  headers?: Record<string, string>;
  localStorage?: Record<string, string>;
}

export interface PreviewGatewaySession {
  profileName: string;
  /** Stable origin used after the signed bootstrap has established a session. */
  baseUrl: string;
  /** Opaque, expiring capability URL used for the first navigation only. */
  launchUrl: string;
  expiresAt: string;
}

export interface PreviewGatewayOptions {
  targetBaseUrl: string;
  profiles: readonly GatewayProfile[];
  host?: string;
  /** First profile port. Additional profiles use consecutive ports; zero uses ephemeral ports. */
  port?: number;
  secret?: string;
  sessionTtlMs?: number;
  maxBodyBytes?: number;
}

export interface PreviewGateway {
  listen(): Promise<readonly PreviewGatewaySession[]>;
  close(): Promise<void>;
}

interface ProfileRuntime {
  profile: GatewayProfile;
  listenHost: string;
  id: string;
  token: string;
  expiresAtMs: number;
  desiredPort: number;
  server: Server;
  sockets: Set<Socket>;
  webSockets: Set<WebSocket>;
  session?: PreviewGatewaySession;
  listening: boolean;
}

class BodyTooLargeError extends Error {}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

function formatHost(host: string): string {
  const normalized = host.replace(/^\[|\]$/g, "");
  return isIP(normalized) === 6 ? `[${normalized}]` : normalized;
}

function validateProfile(profile: GatewayProfile): GatewayProfile {
  const name = profile.name.trim();
  if (!name) throw new Error("Preview profile names cannot be empty");
  for (const [headerName, value] of Object.entries(profile.headers ?? {})) {
    const normalized = headerName.toLowerCase();
    if (RESERVED_PROFILE_HEADERS.has(normalized)) {
      throw new Error(
        `Preview profile ${name} cannot override reserved header ${headerName}`,
      );
    }
    if (!headerName || /[\r\n]/.test(headerName) || /[\r\n]/.test(value)) {
      throw new Error(`Preview profile ${name} contains an invalid header`);
    }
  }
  for (const cookie of profile.cookies ?? []) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookie.name) ||
      cookie.name === SESSION_COOKIE ||
      /[;\r\n]/.test(cookie.value)
    ) {
      throw new Error(`Preview profile ${name} contains an invalid cookie`);
    }
  }
  for (const [key, value] of Object.entries(profile.localStorage ?? {})) {
    if (/\u0000/.test(key) || /\u0000/.test(value)) {
      throw new Error(
        `Preview profile ${name} contains invalid local storage data`,
      );
    }
  }
  return {
    name,
    headers: { ...(profile.headers ?? {}) },
    cookies: (profile.cookies ?? []).map((cookie) => ({ ...cookie })),
    localStorage: { ...(profile.localStorage ?? {}) },
  };
}

function sign(secret: string, id: string): string {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

function createToken(secret: string, id: string): string {
  return `${id}.${sign(secret, id)}`;
}

function tokenIsValid(secret: string, runtime: ProfileRuntime, token?: string) {
  if (!token || Date.now() >= runtime.expiresAtMs) return false;
  const [id, signature, extra] = token.split(".");
  if (!id || !signature || extra || id !== runtime.id) return false;
  const expected = sign(secret, id);
  return (
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

function requestSession(request: IncomingMessage): {
  token?: string;
  source?: "header" | "cookie" | "query";
} {
  const header = request.headers["x-topo-session"];
  if (typeof header === "string") return { token: header, source: "header" };
  const cookie = request.headers.cookie
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  if (cookie) {
    return {
      token: cookie.slice(SESSION_COOKIE.length + 1),
      source: "cookie",
    };
  }
  const query = new URL(
    request.url ?? "/",
    "http://topo.invalid",
  ).searchParams.get(SESSION_COOKIE);
  return query ? { token: query, source: "query" } : {};
}

function cleanRequestPath(requestUrl: string | undefined): string {
  const url = new URL(requestUrl ?? "/", "http://topo.invalid");
  url.searchParams.delete(SESSION_COOKIE);
  return `${url.pathname}${url.search}`;
}

function sessionCookie(token: string, expiresAtMs: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1_000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=${maxAge}`;
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function sendSessionBootstrap(
  response: ServerResponse,
  runtime: ProfileRuntime,
  cleanPath: string,
): void {
  const storage = runtime.profile.localStorage ?? {};
  const cookie = sessionCookie(runtime.token, runtime.expiresAtMs);
  if (Object.keys(storage).length === 0) {
    response.writeHead(303, {
      location: cleanPath,
      "set-cookie": cookie,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    response.end();
    return;
  }
  const nonce = randomBytes(18).toString("base64url");
  const script = `const values=${safeScriptJson(storage)};for(const [key,value] of Object.entries(values)){localStorage.setItem(key,value)}location.replace(${safeScriptJson(cleanPath)});`;
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'`,
    "set-cookie": cookie,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Topo preview session</title></head><body><script nonce="${nonce}">${script}</script></body></html>`,
  );
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.length;
    if (total > maxBytes) {
      throw new BodyTooLargeError("Preview request body is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function hopByHopHeaders(headers: IncomingHttpHeaders): Set<string> {
  const values = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  const connection = headers.connection;
  if (typeof connection === "string") {
    for (const name of connection.split(","))
      values.add(name.trim().toLowerCase());
  }
  return values;
}

function forwardedCookies(
  request: IncomingMessage,
  profile: GatewayProfile,
): string | undefined {
  const browserCookies = (request.headers.cookie ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith(`${SESSION_COOKIE}=`));
  const profileCookies = (profile.cookies ?? []).map(
    (cookie) => `${cookie.name}=${cookie.value}`,
  );
  const cookies = [...browserCookies, ...profileCookies];
  return cookies.length > 0 ? cookies.join("; ") : undefined;
}

function upstreamHeaders(
  request: IncomingMessage,
  profile: GatewayProfile,
  target: URL,
  gatewayOrigin: string,
): Record<string, string> {
  const blocked = hopByHopHeaders(request.headers);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const normalized = name.toLowerCase();
    if (
      value === undefined ||
      blocked.has(normalized) ||
      RESERVED_PROFILE_HEADERS.has(normalized) ||
      normalized.startsWith("sec-websocket-")
    ) {
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  const cookies = forwardedCookies(request, profile);
  if (cookies) headers.cookie = cookies;
  if (headers.origin === gatewayOrigin) headers.origin = target.origin;
  if (headers.referer?.startsWith(gatewayOrigin)) {
    headers.referer = `${target.origin}${headers.referer.slice(gatewayOrigin.length)}`;
  }
  headers["x-forwarded-host"] = new URL(gatewayOrigin).host;
  headers["x-forwarded-proto"] = new URL(gatewayOrigin).protocol.slice(0, -1);
  for (const [name, value] of Object.entries(profile.headers ?? {})) {
    headers[name] = value;
  }
  if (
    request.method === "GET" &&
    String(request.headers.accept ?? "")
      .toLowerCase()
      .includes("text/html")
  ) {
    headers["accept-encoding"] = "identity";
  }
  return headers;
}

function adaptContentSecurityPolicy(
  value: string,
  bridgeHash?: string,
): string | undefined {
  const directives = value
    .split(";")
    .map((directive) => directive.trim())
    .filter(
      (directive) =>
        directive && !directive.toLowerCase().startsWith("frame-ancestors"),
    );
  if (bridgeHash) {
    const hashSource = `'sha256-${bridgeHash}'`;
    const names = directives.map(
      (directive) => directive.split(/\s+/, 1)[0]?.toLowerCase() ?? "",
    );
    const scriptIndex = names.indexOf("script-src-elem");
    const fallbackIndex = names.indexOf("script-src");
    const selectedIndex = scriptIndex >= 0 ? scriptIndex : fallbackIndex;
    if (selectedIndex >= 0) {
      const sourceList = directives[selectedIndex]!;
      if (
        !sourceList.includes("'unsafe-inline'") &&
        !sourceList.includes(hashSource)
      ) {
        directives[selectedIndex] = `${sourceList} ${hashSource}`;
      }
    } else {
      const defaultIndex = names.indexOf("default-src");
      if (defaultIndex >= 0) {
        const defaultSources = directives[defaultIndex]!.split(/\s+/)
          .slice(1)
          .join(" ");
        directives.push(
          `script-src ${defaultSources ? `${defaultSources} ` : ""}${hashSource}`,
        );
      }
    }
  }
  return directives.length > 0 ? directives.join("; ") : undefined;
}

function rewriteSetCookie(value: string): string | undefined {
  if (value.toLowerCase().startsWith(`${SESSION_COOKIE}=`)) return undefined;
  const parts = value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const normalized = part.toLowerCase();
      return (
        !normalized.startsWith("domain=") &&
        !normalized.startsWith("samesite=") &&
        normalized !== "secure" &&
        normalized !== "partitioned"
      );
    });
  return [...parts, "Secure", "SameSite=None", "Partitioned"].join("; ");
}

function responseHeaders(
  headers: IncomingHttpHeaders,
  target: URL,
  gatewayOrigin: string,
  options: { rewrittenBody?: boolean; bridgeHash?: string } = {},
): Record<string, string | string[]> {
  const blocked = hopByHopHeaders(headers);
  const forwarded: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      value === undefined ||
      blocked.has(normalized) ||
      normalized === "x-frame-options" ||
      (options.rewrittenBody &&
        [
          "content-encoding",
          "content-length",
          "content-md5",
          "etag",
          "last-modified",
        ].includes(normalized))
    ) {
      continue;
    }
    if (
      normalized === "content-security-policy" ||
      normalized === "content-security-policy-report-only"
    ) {
      const adapted = (Array.isArray(value) ? value : [value])
        .map((policy) => adaptContentSecurityPolicy(policy, options.bridgeHash))
        .filter((policy): policy is string => Boolean(policy));
      if (adapted.length > 0) {
        forwarded[name] = Array.isArray(value) ? adapted : adapted[0]!;
      }
      continue;
    }
    if (normalized === "set-cookie") {
      const values = (Array.isArray(value) ? value : [value])
        .map(rewriteSetCookie)
        .filter((cookie): cookie is string => Boolean(cookie));
      if (values.length > 0) forwarded[name] = values;
      continue;
    }
    if (normalized === "location") {
      const location = Array.isArray(value) ? value[0] : value;
      if (location) {
        const resolved = new URL(location, target);
        forwarded[name] =
          resolved.origin === target.origin
            ? `${gatewayOrigin}${resolved.pathname}${resolved.search}${resolved.hash}`
            : resolved.toString();
      }
      continue;
    }
    if (
      normalized === "access-control-allow-origin" &&
      value === target.origin
    ) {
      forwarded[name] = gatewayOrigin;
      continue;
    }
    forwarded[name] = Array.isArray(value) ? value : String(value);
  }
  return forwarded;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function shouldInjectPreviewBridge(
  request: IncomingMessage,
  upstreamResponse: IncomingMessage,
): boolean {
  const contentType = headerValue(upstreamResponse.headers["content-type"]);
  const normalizedContentType = contentType?.toLowerCase();
  const charset = normalizedContentType
    ?.split(";")
    .slice(1)
    .map((part) => part.trim())
    .find((part) => part.startsWith("charset="))
    ?.slice("charset=".length)
    .replace(/^['"]|['"]$/g, "");
  const contentEncoding = headerValue(
    upstreamResponse.headers["content-encoding"],
  );
  return (
    request.method === "GET" &&
    (upstreamResponse.statusCode ?? 500) >= 200 &&
    (upstreamResponse.statusCode ?? 500) < 300 &&
    normalizedContentType?.startsWith("text/html") === true &&
    (!charset || charset === "utf-8" || charset === "utf8") &&
    (!contentEncoding || contentEncoding.toLowerCase() === "identity")
  );
}

async function readUpstreamHtml(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.byteLength;
    if (total > DEFAULT_MAX_HTML_BYTES) {
      throw new Error(
        "Preview HTML response is too large to instrument safely",
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function injectPreviewBridge(html: string): string {
  if (html.includes("data-topo-preview-bridge")) return html;
  const script = `<script data-topo-preview-bridge>${PREVIEW_BRIDGE_SOURCE}</script>`;
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `${script}</head>`);
  }
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${script}</body>`);
  }
  return `${script}${html}`;
}

function targetRequestUrl(requestUrl: string | undefined, target: URL): URL {
  const incoming = new URL(requestUrl ?? "/", "http://topo.invalid");
  incoming.searchParams.delete(SESSION_COOKIE);
  return new URL(`${incoming.pathname}${incoming.search}`, target.origin);
}

function sendJsonError(
  response: ServerResponse,
  status: number,
  message: string,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ error: message }));
}

async function proxyHttp(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ProfileRuntime,
  target: URL,
  gatewayOrigin: string,
  maxBodyBytes: number,
): Promise<void> {
  try {
    const body = await readBody(request, maxBodyBytes);
    const targetUrl = targetRequestUrl(request.url, target);
    const transport =
      targetUrl.protocol === "https:" ? requestHttps : requestHttp;
    await new Promise<void>((resolve, reject) => {
      const upstream = transport(
        targetUrl,
        {
          method: request.method,
          headers: upstreamHeaders(
            request,
            runtime.profile,
            target,
            gatewayOrigin,
          ),
        },
        (upstreamResponse) => {
          if (shouldInjectPreviewBridge(request, upstreamResponse)) {
            void readUpstreamHtml(upstreamResponse)
              .then((upstreamBody) => {
                const injected = Buffer.from(
                  injectPreviewBridge(upstreamBody.toString("utf8")),
                  "utf8",
                );
                response.writeHead(upstreamResponse.statusCode ?? 200, {
                  ...responseHeaders(
                    upstreamResponse.headers,
                    target,
                    gatewayOrigin,
                    {
                      rewrittenBody: true,
                      bridgeHash: PREVIEW_BRIDGE_HASH,
                    },
                  ),
                  "content-length": injected.byteLength,
                });
                response.end(injected);
                resolve();
              })
              .catch(reject);
            return;
          }
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            responseHeaders(upstreamResponse.headers, target, gatewayOrigin),
          );
          upstreamResponse.pipe(response);
          upstreamResponse.once("end", resolve);
          upstreamResponse.once("error", reject);
        },
      );
      upstream.once("error", reject);
      if (body) upstream.write(body);
      upstream.end();
    });
  } catch (error) {
    sendJsonError(
      response,
      error instanceof BodyTooLargeError ? 413 : 502,
      error instanceof Error ? error.message : "Preview upstream unavailable",
    );
  }
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  const body = JSON.stringify({ error: message });
  socket.end(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Bad Gateway"}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

function bridgeWebSockets(
  downstream: WebSocket,
  upstream: WebSocket,
  runtime: ProfileRuntime,
): void {
  runtime.webSockets.add(downstream);
  runtime.webSockets.add(upstream);
  const forward = (targetSocket: WebSocket, data: RawData, binary: boolean) => {
    if (targetSocket.readyState === WebSocket.OPEN) {
      targetSocket.send(data, { binary });
    }
  };
  downstream.on("message", (data, binary) => forward(upstream, data, binary));
  upstream.on("message", (data, binary) => forward(downstream, data, binary));
  downstream.once("close", () => {
    runtime.webSockets.delete(downstream);
    if (upstream.readyState < WebSocket.CLOSING) upstream.close();
  });
  upstream.once("close", () => {
    runtime.webSockets.delete(upstream);
    if (downstream.readyState < WebSocket.CLOSING) downstream.close();
  });
  downstream.once("error", () => upstream.terminate());
  upstream.once("error", () => downstream.terminate());
}

function proxyWebSocket(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  runtime: ProfileRuntime,
  target: URL,
  gatewayOrigin: string,
): void {
  const targetUrl = targetRequestUrl(request.url, target);
  targetUrl.protocol = targetUrl.protocol === "https:" ? "wss:" : "ws:";
  const protocols = (request.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const headers = upstreamHeaders(
    request,
    runtime.profile,
    target,
    gatewayOrigin,
  );
  const upstream = protocols.length
    ? new WebSocket(targetUrl, protocols, { headers })
    : new WebSocket(targetUrl, { headers });
  let opened = false;
  const fail = (message: string) => {
    if (!opened) rejectUpgrade(socket, 502, message);
  };
  upstream.once("unexpected-response", (_request, response) => {
    fail(`Preview WebSocket upstream returned ${response.statusCode}`);
  });
  upstream.once("error", (error) => fail(error.message));
  upstream.once("open", () => {
    opened = true;
    const webSocketServer = new WebSocketServer({
      noServer: true,
      handleProtocols: (offered) => {
        if (upstream.protocol && offered.has(upstream.protocol)) {
          return upstream.protocol;
        }
        return offered.values().next().value || false;
      },
    });
    webSocketServer.handleUpgrade(request, socket, head, (downstream) => {
      bridgeWebSockets(downstream, upstream, runtime);
    });
  });
}

async function listenRuntime(runtime: ProfileRuntime): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      runtime.server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      runtime.server.off("error", onError);
      runtime.listening = true;
      resolve();
    };
    runtime.server.once("error", onError);
    runtime.server.once("listening", onListening);
    runtime.server.listen(runtime.desiredPort, runtime.listenHost);
  });
}

function profileLoopbackHost(
  configuredHost: string,
  profileIndex: number,
  profileCount: number,
): string {
  if (profileCount === 1) return configuredHost;
  const normalized = configuredHost.toLowerCase().replace(/^\[|\]$/g, "");
  const base =
    isIP(normalized) === 4
      ? normalized
          .split(".")
          .map(Number)
          .reduce((value, octet) => value * 256 + octet, 0) >>> 0
      : 0x7f000001;
  const candidate = base + profileIndex;
  if (candidate > 0x7ffffffe || candidate < 0x7f000001) {
    throw new Error(
      `Preview gateway cannot allocate ${profileCount} isolated loopback hosts from ${configuredHost}`,
    );
  }
  return [24, 16, 8, 0].map((shift) => (candidate >>> shift) & 0xff).join(".");
}

async function closeRuntime(runtime: ProfileRuntime): Promise<void> {
  for (const webSocket of runtime.webSockets) webSocket.terminate();
  runtime.webSockets.clear();
  for (const socket of runtime.sockets) socket.destroy();
  runtime.sockets.clear();
  if (!runtime.listening) return;
  runtime.listening = false;
  await new Promise<void>((resolve, reject) => {
    runtime.server.close((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Create one profile-isolated local preview gateway. The external interface is
 * deliberately two operations: listen returns sanitized session descriptors;
 * close releases every HTTP and WebSocket resource.
 */
export function createPreviewGateway(
  options: PreviewGatewayOptions,
): PreviewGateway {
  const host = options.host ?? "127.0.0.1";
  if (!isLoopbackHost(host)) {
    throw new Error(`Preview gateway must bind to loopback, received ${host}`);
  }
  const target = new URL(options.targetBaseUrl);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    !isLoopbackHost(target.hostname)
  ) {
    throw new Error(
      `Preview gateway target must be loopback HTTP, received ${target.origin}`,
    );
  }
  const profiles = options.profiles.map(validateProfile);
  if (profiles.length === 0) {
    throw new Error("Preview gateway requires at least one profile");
  }
  const names = new Set<string>();
  for (const profile of profiles) {
    if (names.has(profile.name)) {
      throw new Error(`Duplicate preview profile: ${profile.name}`);
    }
    names.add(profile.name);
  }
  const basePort = options.port ?? 4180;
  if (!Number.isInteger(basePort) || basePort < 0 || basePort > 65_535) {
    throw new Error(`Invalid preview gateway port: ${basePort}`);
  }
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) {
    throw new Error("Preview gateway session TTL must be positive");
  }
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new Error("Preview gateway body limit must be a positive integer");
  }
  const secret = options.secret ?? randomBytes(32).toString("base64url");
  const expiresAtMs = Date.now() + sessionTtlMs;
  const runtimes: ProfileRuntime[] = [];

  for (const [index, profile] of profiles.entries()) {
    const id = randomBytes(24).toString("base64url");
    const runtime = {} as ProfileRuntime;
    runtime.profile = profile;
    runtime.listenHost = profileLoopbackHost(host, index, profiles.length);
    runtime.id = id;
    runtime.token = createToken(secret, id);
    runtime.expiresAtMs = expiresAtMs;
    runtime.desiredPort = basePort === 0 ? 0 : basePort + index;
    runtime.sockets = new Set();
    runtime.webSockets = new Set();
    runtime.listening = false;
    runtime.server = createServer((request, response) => {
      const session = requestSession(request);
      if (!tokenIsValid(secret, runtime, session.token)) {
        sendJsonError(
          response,
          401,
          "A valid signed Topo preview session is required",
        );
        return;
      }
      const cleanPath = cleanRequestPath(request.url);
      if (session.source === "query") {
        if (request.method !== "GET") {
          sendJsonError(response, 400, "Session bootstrap requires GET");
          return;
        }
        sendSessionBootstrap(response, runtime, cleanPath);
        return;
      }
      const origin = runtime.session?.baseUrl.slice(0, -1);
      if (!origin) {
        sendJsonError(response, 503, "Preview gateway is not ready");
        return;
      }
      void proxyHttp(request, response, runtime, target, origin, maxBodyBytes);
    });
    runtime.server.on("connection", (socket) => {
      runtime.sockets.add(socket);
      socket.once("close", () => runtime.sockets.delete(socket));
    });
    runtime.server.on("upgrade", (request, socket, head) => {
      const session = requestSession(request);
      if (!tokenIsValid(secret, runtime, session.token)) {
        rejectUpgrade(
          socket,
          401,
          "A valid signed Topo preview session is required",
        );
        return;
      }
      const origin = runtime.session?.baseUrl.slice(0, -1);
      if (!origin) {
        rejectUpgrade(socket, 502, "Preview gateway is not ready");
        return;
      }
      proxyWebSocket(request, socket, head, runtime, target, origin);
    });
    runtimes.push(runtime);
  }

  let listenPromise: Promise<readonly PreviewGatewaySession[]> | undefined;
  let closePromise: Promise<void> | undefined;
  return {
    listen() {
      if (closePromise) {
        return Promise.reject(new Error("Preview gateway is closed"));
      }
      if (listenPromise) return listenPromise;
      listenPromise = (async () => {
        try {
          for (const runtime of runtimes) {
            await listenRuntime(runtime);
            const address = runtime.server.address();
            if (!address || typeof address === "string") {
              throw new Error("Preview gateway did not expose a TCP address");
            }
            const baseUrl = `http://${formatHost(runtime.listenHost)}:${address.port}/`;
            const launch = new URL(baseUrl);
            launch.searchParams.set(SESSION_COOKIE, runtime.token);
            runtime.session = Object.freeze({
              profileName: runtime.profile.name,
              baseUrl,
              launchUrl: launch.toString(),
              expiresAt: new Date(runtime.expiresAtMs).toISOString(),
            });
          }
          return Object.freeze(runtimes.map((runtime) => runtime.session!));
        } catch (error) {
          await Promise.allSettled(runtimes.map(closeRuntime));
          throw error;
        }
      })();
      return listenPromise;
    },
    close() {
      if (closePromise) return closePromise;
      closePromise = Promise.allSettled(runtimes.map(closeRuntime)).then(
        (results) => {
          const failure = results.find(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          );
          if (failure) throw failure.reason;
        },
      );
      return closePromise;
    },
  };
}
