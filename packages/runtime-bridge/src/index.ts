export const TOPO_PREVIEW_BRIDGE_VERSION = 1 as const;

export type RuntimeBridgeEventType =
  "topo.navigation" | "topo.network" | "topo.dom" | "topo.error";

export interface RuntimeBridgeEvent {
  type: RuntimeBridgeEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface PreviewAnchorPoint {
  x: number;
  y: number;
}

export interface PreviewAnchorInspection {
  role?: string;
  accessibleName?: string;
  testLocator?: string;
  domFingerprint?: string;
}

export interface PreviewAnchorInspectRequest {
  type: "topo.anchor.inspect";
  version: typeof TOPO_PREVIEW_BRIDGE_VERSION;
  requestId: string;
  point: PreviewAnchorPoint;
}

export interface PreviewAnchorInspectResponse {
  type: "topo.anchor.inspected";
  version: typeof TOPO_PREVIEW_BRIDGE_VERSION;
  requestId: string;
  result: PreviewAnchorInspection;
}

export interface PreviewEventsSubscribeRequest {
  type: "topo.events.subscribe";
  version: typeof TOPO_PREVIEW_BRIDGE_VERSION;
  requestId: string;
}

export interface PreviewEventsUnsubscribeRequest {
  type: "topo.events.unsubscribe";
  version: typeof TOPO_PREVIEW_BRIDGE_VERSION;
  requestId: string;
}

export interface PreviewEventsSnapshotResponse {
  type: "topo.events.snapshot";
  version: typeof TOPO_PREVIEW_BRIDGE_VERSION;
  requestId: string;
  events: RuntimeBridgeEvent[];
}

export interface PreviewEventResponse {
  type: "topo.event";
  version: typeof TOPO_PREVIEW_BRIDGE_VERSION;
  requestId: string;
  event: RuntimeBridgeEvent;
}

export type PreviewEventsResponse =
  PreviewEventsSnapshotResponse | PreviewEventResponse;

export interface SubscribePreviewEventsOptions {
  hostWindow: Pick<Window, "addEventListener" | "removeEventListener">;
  targetWindow: Pick<Window, "postMessage">;
  targetOrigin: string;
  onEvents: (events: readonly RuntimeBridgeEvent[]) => void;
}

export interface PreviewEventSubscription {
  readonly requestId: string;
  refresh(): void;
  close(): void;
}

export interface InspectPreviewAnchorOptions {
  hostWindow: Pick<Window, "addEventListener" | "removeEventListener">;
  targetWindow: Pick<Window, "postMessage">;
  targetOrigin: string;
  point: PreviewAnchorPoint;
  timeoutMs?: number;
}

let requestSequence = 0;

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      url.protocol === "http:" &&
      (hostname === "localhost" ||
        hostname === "::1" ||
        /^127(?:\.\d{1,3}){3}$/.test(hostname))
    );
  } catch {
    return false;
  }
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum) return undefined;
  return normalized;
}

const runtimeBridgeEventTypes = new Set<RuntimeBridgeEventType>([
  "topo.navigation",
  "topo.network",
  "topo.dom",
  "topo.error",
]);

const secretPayloadKey =
  /authorization|cookie|credential|header|localstorage|password|secret|session|token/i;

export function parseRuntimeBridgeEvent(
  value: unknown,
): RuntimeBridgeEvent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const type = boundedString(input.type, 80) as
    RuntimeBridgeEventType | undefined;
  const timestamp = boundedString(input.timestamp, 80);
  if (
    !type ||
    !runtimeBridgeEventTypes.has(type) ||
    !timestamp ||
    Number.isNaN(Date.parse(timestamp)) ||
    !input.payload ||
    typeof input.payload !== "object" ||
    Array.isArray(input.payload)
  ) {
    return undefined;
  }
  const payload: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input.payload).slice(0, 20)) {
    if (secretPayloadKey.test(key)) continue;
    if (typeof entry === "boolean" || typeof entry === "number") {
      payload[key] = entry;
      continue;
    }
    const text = boundedString(entry, 240);
    if (text) payload[key] = text;
  }
  return { type, timestamp, payload };
}

export function parsePreviewEventsResponse(
  value: unknown,
): PreviewEventsResponse | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  if (input.version !== TOPO_PREVIEW_BRIDGE_VERSION) return undefined;
  const requestId = boundedString(input.requestId, 160);
  if (!requestId) return undefined;
  if (input.type === "topo.event") {
    const event = parseRuntimeBridgeEvent(input.event);
    return event
      ? {
          type: "topo.event",
          version: TOPO_PREVIEW_BRIDGE_VERSION,
          requestId,
          event,
        }
      : undefined;
  }
  if (input.type !== "topo.events.snapshot" || !Array.isArray(input.events)) {
    return undefined;
  }
  const events = input.events
    .slice(-200)
    .map(parseRuntimeBridgeEvent)
    .filter((event): event is RuntimeBridgeEvent => Boolean(event));
  return {
    type: "topo.events.snapshot",
    version: TOPO_PREVIEW_BRIDGE_VERSION,
    requestId,
    events,
  };
}

/**
 * Subscribe to the bounded sanitized event queue of one exact signed loopback
 * preview frame. The returned interface survives frame reloads through
 * `refresh()` and never exposes credentials or arbitrary application payloads.
 */
export function subscribePreviewEvents(
  options: SubscribePreviewEventsOptions,
): PreviewEventSubscription | undefined {
  if (!isLoopbackOrigin(options.targetOrigin)) return undefined;
  const requestId = `topo-events-${Date.now()}-${++requestSequence}`;
  let closed = false;
  const post = (type: "topo.events.subscribe" | "topo.events.unsubscribe") =>
    options.targetWindow.postMessage(
      { type, version: TOPO_PREVIEW_BRIDGE_VERSION, requestId },
      options.targetOrigin,
    );
  const onMessage = (event: Event) => {
    if (closed) return;
    const message = event as MessageEvent<unknown>;
    if (
      message.source !== options.targetWindow ||
      message.origin !== options.targetOrigin
    ) {
      return;
    }
    const response = parsePreviewEventsResponse(message.data);
    if (!response || response.requestId !== requestId) return;
    options.onEvents(
      response.type === "topo.event" ? [response.event] : response.events,
    );
  };
  options.hostWindow.addEventListener("message", onMessage);
  post("topo.events.subscribe");
  return {
    requestId,
    refresh() {
      if (!closed) post("topo.events.subscribe");
    },
    close() {
      if (closed) return;
      post("topo.events.unsubscribe");
      closed = true;
      options.hostWindow.removeEventListener("message", onMessage);
    },
  };
}

export function parsePreviewAnchorInspection(
  value: unknown,
): PreviewAnchorInspection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const role = boundedString(input.role, 100);
  const accessibleName = boundedString(input.accessibleName, 300);
  const testLocator = boundedString(input.testLocator, 300);
  const domFingerprint = boundedString(input.domFingerprint, 100);
  if (!role && !accessibleName && !testLocator && !domFingerprint) {
    return undefined;
  }
  return {
    ...(role ? { role } : {}),
    ...(accessibleName ? { accessibleName } : {}),
    ...(testLocator ? { testLocator } : {}),
    ...(domFingerprint ? { domFingerprint } : {}),
  };
}

export function parsePreviewAnchorResponse(
  value: unknown,
): PreviewAnchorInspectResponse | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  if (
    input.type !== "topo.anchor.inspected" ||
    input.version !== TOPO_PREVIEW_BRIDGE_VERSION
  ) {
    return undefined;
  }
  const requestId = boundedString(input.requestId, 160);
  const result = parsePreviewAnchorInspection(input.result);
  return requestId && result
    ? {
        type: "topo.anchor.inspected",
        version: TOPO_PREVIEW_BRIDGE_VERSION,
        requestId,
        result,
      }
    : undefined;
}

/**
 * Ask one signed loopback preview frame for semantic evidence at normalized
 * coordinates. Missing or older bridges time out to `undefined`, allowing the
 * caller to retain truthful coordinate-only placement.
 */
export function inspectPreviewAnchor(
  options: InspectPreviewAnchorOptions,
): Promise<PreviewAnchorInspection | undefined> {
  if (
    !isLoopbackOrigin(options.targetOrigin) ||
    !Number.isFinite(options.point.x) ||
    !Number.isFinite(options.point.y) ||
    options.point.x < 0 ||
    options.point.x > 1 ||
    options.point.y < 0 ||
    options.point.y > 1
  ) {
    return Promise.resolve(undefined);
  }

  const requestId = `topo-anchor-${Date.now()}-${++requestSequence}`;
  const request: PreviewAnchorInspectRequest = {
    type: "topo.anchor.inspect",
    version: TOPO_PREVIEW_BRIDGE_VERSION,
    requestId,
    point: options.point,
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PreviewAnchorInspection | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.hostWindow.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: Event) => {
      const message = event as MessageEvent<unknown>;
      if (
        message.source !== options.targetWindow ||
        message.origin !== options.targetOrigin
      ) {
        return;
      }
      const response = parsePreviewAnchorResponse(message.data);
      if (response?.requestId === requestId) finish(response.result);
    };
    const timeout = setTimeout(
      () => finish(undefined),
      Math.max(25, Math.min(options.timeoutMs ?? 450, 2_000)),
    );
    options.hostWindow.addEventListener("message", onMessage);
    options.targetWindow.postMessage(request, options.targetOrigin);
  });
}

function previewBridgeBootstrap(): void {
  const bridgeWindow = window as typeof window & {
    __TOPO__?: {
      version?: number;
      events?: RuntimeBridgeEvent[];
      emit?: (event: {
        type?: unknown;
        payload?: unknown;
      }) => RuntimeBridgeEvent | undefined;
    };
  };
  const maximumEvents = 200;
  const secretKey =
    /authorization|cookie|credential|header|localstorage|password|secret|session|token/i;
  const compactText = (value: unknown, maximum = 240) =>
    typeof value === "string"
      ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
      : "";
  const safePath = (value: unknown) => {
    try {
      return new URL(String(value), window.location.href).pathname.slice(
        0,
        500,
      );
    } catch {
      return "/";
    }
  };
  const safePayload = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 20)) {
      if (secretKey.test(key)) continue;
      if (typeof entry === "boolean" || typeof entry === "number") {
        result[key] = entry;
      } else if (typeof entry === "string") {
        result[key] = compactText(entry);
      }
    }
    return result;
  };
  const existing = bridgeWindow.__TOPO__;
  const events = Array.isArray(existing?.events)
    ? existing.events.slice(-maximumEvents)
    : [];
  const bridge = existing ?? {};
  let eventSubscriber:
    | {
        origin: string;
        requestId: string;
      }
    | undefined;
  bridge.version = 1;
  bridge.events = events;
  bridge.emit = (input) => {
    const type = compactText(input?.type, 80);
    if (!type.startsWith("topo.")) return undefined;
    const event: RuntimeBridgeEvent = {
      type: type as RuntimeBridgeEventType,
      timestamp: new Date().toISOString(),
      payload: safePayload(input?.payload),
    };
    events.push(event);
    if (events.length > maximumEvents) {
      events.splice(0, events.length - maximumEvents);
    }
    if (eventSubscriber) {
      window.parent.postMessage(
        {
          type: "topo.event",
          version: 1,
          requestId: eventSubscriber.requestId,
          event,
        },
        eventSubscriber.origin,
      );
    }
    return event;
  };
  bridgeWindow.__TOPO__ = bridge;

  const emit = (
    type: RuntimeBridgeEventType,
    payload: Record<string, unknown>,
  ) => bridge.emit?.({ type, payload });
  const navigation = (kind: string) =>
    emit("topo.navigation", { kind, path: window.location.pathname });
  const originalPushState = window.history.pushState.bind(window.history);
  window.history.pushState = (data, unused, url) => {
    originalPushState(data, unused, url);
    navigation("pushState");
  };
  const originalReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (data, unused, url) => {
    originalReplaceState(data, unused, url);
    navigation("replaceState");
  };
  window.addEventListener("popstate", () => navigation("popstate"));
  window.addEventListener("hashchange", () => navigation("hashchange"));
  navigation("load");

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (...args: Parameters<typeof window.fetch>) => {
      const input = args[0];
      const method = compactText(
        args[1]?.method ?? (input instanceof Request ? input.method : "GET"),
        16,
      ).toUpperCase();
      const path = safePath(input instanceof Request ? input.url : input);
      try {
        const response = await originalFetch(...args);
        emit("topo.network", { method, path, status: response.status });
        return response;
      } catch (error) {
        emit("topo.network", { method, path, status: "error" });
        throw error;
      }
    }) as typeof window.fetch;
  }

  const xhrDetails = new WeakMap<
    XMLHttpRequest,
    { method: string; path: string }
  >();
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    xhrDetails.set(this, {
      method: compactText(method, 16).toUpperCase(),
      path: safePath(url),
    });
    return originalOpen.call(this, method, url, async, username, password);
  } as typeof XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest["send"]>
  ) {
    this.addEventListener(
      "loadend",
      () => {
        const detail = xhrDetails.get(this);
        if (detail) {
          emit("topo.network", { ...detail, status: this.status || "error" });
        }
      },
      { once: true },
    );
    return originalSend.apply(this, args);
  };

  window.addEventListener("error", (event) => {
    emit("topo.error", {
      kind: compactText(event.error?.name, 80) || "Error",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    emit("topo.error", {
      kind:
        compactText(
          event.reason instanceof Error
            ? event.reason.name
            : typeof event.reason,
          80,
        ) || "UnhandledRejection",
    });
  });

  let mutationCount = 0;
  let mutationTimer: number | undefined;
  const startObserver = () => {
    if (!document.documentElement) return;
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
      if (mutationTimer !== undefined) return;
      mutationTimer = window.setTimeout(() => {
        emit("topo.dom", { mutations: mutationCount });
        mutationCount = 0;
        mutationTimer = undefined;
      }, 0);
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, {
      once: true,
    });
  } else {
    startObserver();
  }

  const implicitRole = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return "img";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["button", "submit", "reset"].includes(type)) return "button";
      return "textbox";
    }
    return "";
  };
  const accessibleName = (element: Element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
      : "";
    const controlLabel =
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
        ? element.labels?.[0]?.textContent
        : "";
    return compactText(
      element.getAttribute("aria-label") ||
        labelledText ||
        controlLabel ||
        element.getAttribute("alt") ||
        element.getAttribute("title") ||
        element.textContent,
      300,
    );
  };
  const locator = (element: Element) => {
    for (const attribute of ["data-testid", "data-test-id", "data-cy"]) {
      const value = compactText(element.getAttribute(attribute), 180);
      if (value) return `[${attribute}=${JSON.stringify(value)}]`;
    }
    const id = compactText(element.id, 180);
    return id ? `#${id}` : "";
  };
  const fingerprint = (element: Element) => {
    const parts: string[] = [];
    let current: Element | null = element;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const currentTag = current.tagName;
      const parentElement: Element | null = current.parentElement;
      const siblings: Element[] = parentElement
        ? Array.from(parentElement.children).filter(
            (candidate: Element) => candidate.tagName === currentTag,
          )
        : [];
      parts.push(
        `${current.tagName.toLowerCase()}:${current.getAttribute("role") || implicitRole(current)}:${Math.max(0, siblings.indexOf(current))}`,
      );
      current = parentElement;
    }
    const source = parts.join(">");
    const hash = (value: string) => {
      let result = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return (result >>> 0).toString(16).padStart(8, "0");
    };
    return `${hash(source)}${hash(source.split("").reverse().join(""))}`;
  };
  const loopbackParent = (origin: string) => {
    try {
      const url = new URL(origin);
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      return (
        url.protocol === "http:" &&
        (host === "localhost" ||
          host === "::1" ||
          /^127(?:\.\d{1,3}){3}$/.test(host))
      );
    } catch {
      return false;
    }
  };
  window.addEventListener("message", (event) => {
    if (
      event.source !== window.parent ||
      !loopbackParent(event.origin) ||
      !event.data ||
      typeof event.data !== "object"
    ) {
      return;
    }
    const input = event.data as Record<string, unknown>;
    if (
      input.type === "topo.events.subscribe" &&
      input.version === 1 &&
      typeof input.requestId === "string" &&
      input.requestId.length <= 160
    ) {
      eventSubscriber = {
        origin: event.origin,
        requestId: input.requestId,
      };
      (event.source as WindowProxy).postMessage(
        {
          type: "topo.events.snapshot",
          version: 1,
          requestId: input.requestId,
          events: events.slice(-maximumEvents),
        } satisfies PreviewEventsSnapshotResponse,
        { targetOrigin: event.origin },
      );
      return;
    }
    if (
      input.type === "topo.events.unsubscribe" &&
      input.version === 1 &&
      typeof input.requestId === "string" &&
      eventSubscriber?.requestId === input.requestId
    ) {
      eventSubscriber = undefined;
      return;
    }
    if (
      input.type !== "topo.anchor.inspect" ||
      input.version !== 1 ||
      typeof input.requestId !== "string" ||
      input.requestId.length > 160 ||
      !input.point ||
      typeof input.point !== "object" ||
      Array.isArray(input.point)
    ) {
      return;
    }
    const point = input.point as Record<string, unknown>;
    if (
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    )
      return;
    const hit = document.elementFromPoint(
      point.x * window.innerWidth,
      point.y * window.innerHeight,
    );
    if (!hit) return;
    const semantic =
      hit.closest(
        "[data-testid], [data-test-id], [data-cy], [aria-label], button, a[href], input, select, textarea, [role], h1, h2, h3, h4, h5, h6, img, label",
      ) ?? hit;
    const result: PreviewAnchorInspection = {
      ...(semantic.getAttribute("role") || implicitRole(semantic)
        ? { role: semantic.getAttribute("role") || implicitRole(semantic) }
        : {}),
      ...(accessibleName(semantic)
        ? { accessibleName: accessibleName(semantic) }
        : {}),
      ...(locator(semantic) ? { testLocator: locator(semantic) } : {}),
      domFingerprint: fingerprint(semantic),
    };
    (event.source as WindowProxy).postMessage(
      {
        type: "topo.anchor.inspected",
        version: 1,
        requestId: input.requestId,
        result,
      } satisfies PreviewAnchorInspectResponse,
      { targetOrigin: event.origin },
    );
  });
}

/**
 * Self-contained browser source injected only by the signed loopback gateway.
 * It contains no project configuration, capabilities, profile values, or
 * environment data.
 */
export function createPreviewBridgeScript(): string {
  return `(${previewBridgeBootstrap.toString()})();`;
}

export function createRuntimeEvent(
  type: RuntimeBridgeEventType,
  payload: Record<string, unknown>,
): RuntimeBridgeEvent {
  return { type, payload, timestamp: new Date().toISOString() };
}
