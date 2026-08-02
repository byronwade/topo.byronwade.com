import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pixiState = vi.hoisted(() => ({
  applications: [] as Array<{
    canvas: {
      remove: ReturnType<typeof vi.fn>;
      setAttribute: ReturnType<typeof vi.fn>;
    };
    destroy: ReturnType<typeof vi.fn>;
    init: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
  }>,
  initError: undefined as Error | undefined,
}));

vi.mock("pixi.js", () => ({
  Application: class Application {
    canvas = {
      remove: vi.fn(),
      setAttribute: vi.fn(),
    };
    destroy = vi.fn();
    render = vi.fn();
    init = vi.fn(async () => {
      if (pixiState.initError) throw pixiState.initError;
    });

    constructor() {
      pixiState.applications.push(this);
    }
  },
  Graphics: class Graphics {},
  Texture: class Texture {},
}));

import { createPixiCanvasHost } from "./index.js";

describe("createPixiCanvasHost", () => {
  let resizeCallback: ResizeObserverCallback | undefined;
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let observe: ReturnType<typeof vi.fn>;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pixiState.applications.length = 0;
    pixiState.initError = undefined;
    nextFrameId = 1;
    frames = new Map();
    observe = vi.fn();
    disconnect = vi.fn();
    vi.stubGlobal("window", { devicePixelRatio: 3 });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId;
        nextFrameId += 1;
        frames.set(id, callback);
        return id;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => frames.delete(id)),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }

        observe = observe;
        disconnect = disconnect;
        unobserve = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces resize redraws and owns idempotent Pixi teardown", async () => {
    const host = { appendChild: vi.fn() } as unknown as HTMLElement;
    const mounted = await createPixiCanvasHost(host, {
      background: 0x0a0a0a,
      renderer: "pixi-test",
    });
    const app = pixiState.applications[0]!;

    expect(app.init).toHaveBeenCalledWith(
      expect.objectContaining({
        antialias: true,
        autoDensity: true,
        autoStart: false,
        background: 0x0a0a0a,
        preference: "webgl",
        resolution: 2,
        resizeTo: host,
      }),
    );
    expect(app.canvas.setAttribute).toHaveBeenCalledWith(
      "data-topo-renderer",
      "pixi-test",
    );
    expect(host.appendChild).toHaveBeenCalledWith(app.canvas);
    mounted.render();
    expect(app.render).toHaveBeenCalledOnce();

    const redraw = vi.fn();
    mounted.observeResize(redraw);
    resizeCallback?.([], {} as ResizeObserver);
    resizeCallback?.([], {} as ResizeObserver);
    expect(frames).toHaveLength(1);
    const scheduled = frames.entries().next().value;
    expect(scheduled).toBeDefined();
    frames.delete(scheduled![0]);
    scheduled![1](0);
    expect(redraw).toHaveBeenCalledOnce();

    resizeCallback?.([], {} as ResizeObserver);
    expect(frames).toHaveLength(1);
    mounted.destroy();
    mounted.destroy();
    mounted.render();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(app.canvas.remove).toHaveBeenCalledOnce();
    expect(app.destroy).toHaveBeenCalledOnce();
    expect(app.destroy).toHaveBeenCalledWith(true);
    expect(app.render).toHaveBeenCalledOnce();
  });

  it("destroys a partially initialized application without masking its error", async () => {
    const host = { appendChild: vi.fn() } as unknown as HTMLElement;
    pixiState.initError = new Error("renderer unavailable");

    await expect(
      createPixiCanvasHost(host, {
        background: 0,
        renderer: "pixi-test",
      }),
    ).rejects.toThrow("renderer unavailable");

    expect(pixiState.applications[0]!.destroy).toHaveBeenCalledWith(true);
    expect(host.appendChild).not.toHaveBeenCalled();
  });
});
