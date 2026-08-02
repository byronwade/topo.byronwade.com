import { describe, expect, it } from "vitest";

import {
  createPreviewBridgeScript,
  inspectPreviewAnchor,
  parsePreviewAnchorResponse,
  parsePreviewEventsResponse,
  parseRuntimeBridgeEvent,
  subscribePreviewEvents,
} from "./index.js";

describe("runtime bridge source", () => {
  it("creates a self-contained bounded preview bridge", () => {
    const script = createPreviewBridgeScript();

    expect(script).toContain("__TOPO__");
    expect(script).toContain("topo.anchor.inspect");
    expect(script).toContain("topo.events.subscribe");
    expect(script).toContain('navigation("load")');
    expect(script).toContain("elementFromPoint");
    expect(script).toContain("maximumEvents = 200");
    expect(script).not.toContain("topo_session");
    expect(script).not.toContain("process.env");
  });
});

describe("preview event parsing", () => {
  it("accepts bounded runtime evidence and removes secret-shaped payloads", () => {
    expect(
      parseRuntimeBridgeEvent({
        type: "topo.navigation",
        timestamp: "2026-08-02T15:00:00.000Z",
        payload: {
          kind: " pushState ",
          path: "/jobs/1042",
          token: "not-readable",
          headers: "not-readable",
        },
      }),
    ).toEqual({
      type: "topo.navigation",
      timestamp: "2026-08-02T15:00:00.000Z",
      payload: { kind: "pushState", path: "/jobs/1042" },
    });
    expect(
      parseRuntimeBridgeEvent({
        type: "topo.unknown",
        timestamp: "2026-08-02T15:00:00.000Z",
        payload: {},
      }),
    ).toBeUndefined();
  });

  it("caps snapshots and drops malformed entries", () => {
    const events: unknown[] = Array.from({ length: 205 }, (_, index) => ({
      type: "topo.navigation",
      timestamp: new Date(Date.UTC(2026, 7, 2, 15, 0, index)).toISOString(),
      payload: { kind: "load", path: `/route-${index}` },
    }));
    events[204] = {
      type: "topo.unknown",
      timestamp: "invalid",
      payload: {},
    };
    const parsed = parsePreviewEventsResponse({
      type: "topo.events.snapshot",
      version: 1,
      requestId: "events-1",
      events,
    });
    expect(parsed?.type).toBe("topo.events.snapshot");
    expect(
      parsed?.type === "topo.events.snapshot" && parsed.events,
    ).toHaveLength(199);
  });
});

describe("preview anchor response parsing", () => {
  it("accepts bounded semantic evidence and ignores extra values", () => {
    expect(
      parsePreviewAnchorResponse({
        type: "topo.anchor.inspected",
        version: 1,
        requestId: "request-1",
        result: {
          role: " button ",
          accessibleName: "Watch   the tour",
          testLocator: '[data-testid="hero-tour"]',
          domFingerprint: "a91c0123f8e4d902",
          headers: { authorization: "secret" },
        },
      }),
    ).toEqual({
      type: "topo.anchor.inspected",
      version: 1,
      requestId: "request-1",
      result: {
        role: "button",
        accessibleName: "Watch the tour",
        testLocator: '[data-testid="hero-tour"]',
        domFingerprint: "a91c0123f8e4d902",
      },
    });
  });

  it("rejects an empty or incompatible response", () => {
    expect(
      parsePreviewAnchorResponse({
        type: "topo.anchor.inspected",
        version: 2,
        requestId: "request-1",
        result: { role: "button" },
      }),
    ).toBeUndefined();
    expect(
      parsePreviewAnchorResponse({
        type: "topo.anchor.inspected",
        version: 1,
        requestId: "request-1",
        result: {},
      }),
    ).toBeUndefined();
  });
});

describe("inspectPreviewAnchor", () => {
  it("correlates one exact-origin frame response", async () => {
    let listener: EventListener | undefined;
    const hostWindow = {
      addEventListener: (
        _type: string,
        next: EventListenerOrEventListenerObject,
      ) => {
        listener = next as EventListener;
      },
      removeEventListener: () => {
        listener = undefined;
      },
    } as Pick<Window, "addEventListener" | "removeEventListener">;
    const targetWindow = {
      postMessage: (message: unknown, targetOrigin: string) => {
        const request = message as { requestId: string };
        queueMicrotask(() =>
          listener?.({
            data: {
              type: "topo.anchor.inspected",
              version: 1,
              requestId: request.requestId,
              result: {
                role: "button",
                accessibleName: "Watch the tour",
                domFingerprint: "a91c0123f8e4d902",
              },
            },
            origin: targetOrigin,
            source: targetWindow,
          } as unknown as Event),
        );
      },
    } as Pick<Window, "postMessage">;

    await expect(
      inspectPreviewAnchor({
        hostWindow,
        targetWindow,
        targetOrigin: "http://127.0.0.2:4180",
        point: { x: 0.6, y: 0.45 },
      }),
    ).resolves.toEqual({
      role: "button",
      accessibleName: "Watch the tour",
      domFingerprint: "a91c0123f8e4d902",
    });
  });

  it("does not send inspection requests to a remote or invalid target", async () => {
    let posted = false;
    const hostWindow = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
    const targetWindow = {
      postMessage: () => {
        posted = true;
      },
    } as unknown as Pick<Window, "postMessage">;

    await expect(
      inspectPreviewAnchor({
        hostWindow,
        targetWindow,
        targetOrigin: "https://example.com",
        point: { x: 0.6, y: 0.45 },
      }),
    ).resolves.toBeUndefined();
    expect(posted).toBe(false);
  });
});

describe("subscribePreviewEvents", () => {
  it("accepts only correlated events from one exact loopback frame", () => {
    let listener: EventListener | undefined;
    const posted: unknown[] = [];
    const hostWindow = {
      addEventListener: (
        _type: string,
        next: EventListenerOrEventListenerObject,
      ) => {
        listener = next as EventListener;
      },
      removeEventListener: () => {
        listener = undefined;
      },
    } as Pick<Window, "addEventListener" | "removeEventListener">;
    const targetWindow = {
      postMessage: (message: unknown) => posted.push(message),
    } as Pick<Window, "postMessage">;
    const received: string[] = [];
    const subscription = subscribePreviewEvents({
      hostWindow,
      targetWindow,
      targetOrigin: "http://127.0.0.4:4180",
      onEvents: (events) =>
        received.push(...events.map((event) => String(event.payload.path))),
    });
    const requestId = subscription?.requestId;
    expect(posted[0]).toMatchObject({
      type: "topo.events.subscribe",
      requestId,
    });
    listener?.({
      data: {
        type: "topo.event",
        version: 1,
        requestId,
        event: {
          type: "topo.navigation",
          timestamp: "2026-08-02T15:00:00.000Z",
          payload: { kind: "load", path: "/jobs" },
        },
      },
      origin: "http://127.0.0.4:4180",
      source: targetWindow,
    } as unknown as Event);
    listener?.({
      data: {
        type: "topo.event",
        version: 1,
        requestId,
        event: {
          type: "topo.navigation",
          timestamp: "2026-08-02T15:00:01.000Z",
          payload: { kind: "pushState", path: "/settings" },
        },
      },
      origin: "http://127.0.0.9:4180",
      source: targetWindow,
    } as unknown as Event);
    expect(received).toEqual(["/jobs"]);
    subscription?.refresh();
    subscription?.close();
    expect(posted.map((message) => (message as { type: string }).type)).toEqual(
      [
        "topo.events.subscribe",
        "topo.events.subscribe",
        "topo.events.unsubscribe",
      ],
    );
    expect(listener).toBeUndefined();
  });

  it("does not subscribe to a remote frame", () => {
    let posted = false;
    expect(
      subscribePreviewEvents({
        hostWindow: {
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        } as unknown as Pick<
          Window,
          "addEventListener" | "removeEventListener"
        >,
        targetWindow: {
          postMessage: () => {
            posted = true;
          },
        } as unknown as Pick<Window, "postMessage">,
        targetOrigin: "https://example.com",
        onEvents: () => undefined,
      }),
    ).toBeUndefined();
    expect(posted).toBe(false);
  });
});
