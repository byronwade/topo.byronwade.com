import { Application, Graphics, Texture } from "pixi.js";

import {
  selectVisibleCanvasItems,
  type CanvasCamera,
} from "@topo/canvas-engine";

export interface SnapshotTextureCache {
  get(id: string): Texture | undefined;
  has(id: string): boolean;
  set(
    id: string,
    texture: Texture,
    options?: SnapshotTextureEntryOptions,
  ): void;
  /** Protect the active viewport's textures, then evict stale entries to budget. */
  retain(ids: Iterable<string>): void;
  delete(id: string): void;
  clear(): void;
  stats(): SnapshotTextureCacheStats;
}

export interface SnapshotTextureCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  estimateBytes?: (texture: Texture) => number;
  onReleaseError?: (error: unknown, id: string) => void;
}

export interface SnapshotTextureEntryOptions {
  byteSize?: number;
  /** Override disposal when a texture belongs to an external asset cache. */
  release?: () => void | Promise<void>;
}

export interface SnapshotTextureCacheStats {
  entries: number;
  bytes: number;
  retained: number;
  hits: number;
  misses: number;
  evictions: number;
  releaseErrors: number;
  maxEntries: number;
  maxBytes: number;
  overBudget: boolean;
}

export interface ViewportGridOptions {
  baseSize?: number;
  minScreenSpacing?: number;
  minorColor?: number;
  majorColor?: number;
  minorAlpha?: number;
  majorAlpha?: number;
}

export interface ViewportGridLine {
  axis: "x" | "y";
  major: boolean;
  position: number;
}

export interface ViewportGridDot {
  x: number;
  y: number;
  major: boolean;
}

export interface ViewportDotGridOptions extends ViewportGridOptions {
  minorRadius?: number;
  majorRadius?: number;
}

export interface TextureHydrationCandidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
}

export interface TextureHydrationViewport {
  width: number;
  height: number;
}

export interface PixiCanvasHostOptions {
  background: number;
  /** Stable diagnostic identity written onto the owned canvas element. */
  renderer: string;
  /** Defaults to the current device pixel ratio, capped at two. */
  resolution?: number;
}

export interface PixiCanvasHost {
  readonly app: Application;
  /** Render the current scene once; static canvases never run an idle ticker. */
  render(): void;
  /**
   * Observe the host and coalesce resize redraws to one animation frame.
   * Calling this again replaces the previous redraw callback.
   */
  observeResize(redraw: () => void): void;
  /** Idempotently disconnect observers, cancel pending work, and destroy Pixi. */
  destroy(): void;
}

const DEFAULT_GRID_OPTIONS: Required<ViewportGridOptions> = {
  baseSize: 32,
  minScreenSpacing: 14,
  minorColor: 0x1c1c1c,
  majorColor: 0x262626,
  minorAlpha: 0.78,
  majorAlpha: 0.48,
};

export const DEFAULT_SNAPSHOT_TEXTURE_MAX_ENTRIES = 48;
export const DEFAULT_SNAPSHOT_TEXTURE_MAX_BYTES = 128 * 1024 * 1024;

function safeDestroyPixiApplication(app: Application): void {
  try {
    app.destroy(true);
  } catch {
    // Pixi can reject before every renderer system is initialized. Cleanup is
    // deliberately best-effort so the original initialization error survives.
  }
}

/**
 * Own one Pixi application's browser lifecycle behind a small shared seam.
 *
 * Atlas, topology, and editor canvases still own their scene implementations;
 * this module owns the error-prone mechanics they must all get exactly right:
 * bounded density, canvas metadata, resize-frame coalescing, and idempotent
 * teardown even when React unmounts during asynchronous Pixi initialization.
 */
export async function createPixiCanvasHost(
  host: HTMLElement,
  options: PixiCanvasHostOptions,
): Promise<PixiCanvasHost> {
  const app = new Application();
  try {
    await app.init({
      antialias: true,
      autoDensity: true,
      autoStart: false,
      background: options.background,
      preference: "webgl",
      resolution:
        options.resolution ??
        Math.min(
          typeof window === "undefined" ? 1 : window.devicePixelRatio,
          2,
        ),
      resizeTo: host,
    });
    app.canvas.setAttribute("aria-hidden", "true");
    app.canvas.setAttribute("data-topo-renderer", options.renderer);
    host.appendChild(app.canvas);
  } catch (error: unknown) {
    safeDestroyPixiApplication(app);
    throw error;
  }

  let disposed = false;
  let resizeObserver: ResizeObserver | undefined;
  let resizeFrame: number | undefined;
  let resizeRedraw: (() => void) | undefined;

  const scheduleResizeRedraw = () => {
    if (disposed || resizeFrame !== undefined || !resizeRedraw) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      if (!disposed) resizeRedraw?.();
    });
  };

  return {
    app,
    render() {
      if (!disposed) app.render();
    },
    observeResize(redraw) {
      if (disposed) return;
      resizeRedraw = redraw;
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(scheduleResizeRedraw);
      resizeObserver.observe(host);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      resizeRedraw = undefined;
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = undefined;
      app.canvas.remove();
      safeDestroyPixiApplication(app);
    },
  };
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Select bounded, visible texture work with selection and viewport locality first. */
export function prioritizeVisibleTextureCandidates<
  TCandidate extends TextureHydrationCandidate,
>(
  candidates: readonly TCandidate[],
  camera: CanvasCamera,
  viewport: TextureHydrationViewport,
  limit: number,
): TCandidate[] {
  if (limit <= 0) return [];
  const centerX = (viewport.width / 2 - camera.x) / camera.zoom;
  const centerY = (viewport.height / 2 - camera.y) / camera.zoom;

  return selectVisibleCanvasItems(candidates, camera, viewport, {
    overscan: 220,
  })
    .sort((leftCandidate, rightCandidate) => {
      if (leftCandidate.selected !== rightCandidate.selected) {
        return leftCandidate.selected ? -1 : 1;
      }
      const leftDistance = Math.hypot(
        leftCandidate.x + leftCandidate.width / 2 - centerX,
        leftCandidate.y + leftCandidate.height / 2 - centerY,
      );
      const rightDistance = Math.hypot(
        rightCandidate.x + rightCandidate.width / 2 - centerX,
        rightCandidate.y + rightCandidate.height / 2 - centerY,
      );
      return leftDistance - rightDistance;
    })
    .slice(0, limit);
}

/** Calculate crisp screen-space grid lines for a world-space camera. */
export function calculateViewportGrid(
  width: number,
  height: number,
  camera: CanvasCamera,
  options: ViewportGridOptions = {},
): ViewportGridLine[] {
  const settings = { ...DEFAULT_GRID_OPTIONS, ...options };
  let worldStep = settings.baseSize;
  while (worldStep * camera.zoom < settings.minScreenSpacing) worldStep *= 2;

  const screenStep = worldStep * camera.zoom;
  const majorStep = screenStep * 4;
  const lines: ViewportGridLine[] = [];

  for (
    let x = positiveModulo(camera.x, screenStep);
    x <= width;
    x += screenStep
  ) {
    lines.push({ axis: "x", major: false, position: x });
  }
  for (
    let y = positiveModulo(camera.y, screenStep);
    y <= height;
    y += screenStep
  ) {
    lines.push({ axis: "y", major: false, position: y });
  }
  for (
    let x = positiveModulo(camera.x, majorStep);
    x <= width;
    x += majorStep
  ) {
    lines.push({ axis: "x", major: true, position: x });
  }
  for (
    let y = positiveModulo(camera.y, majorStep);
    y <= height;
    y += majorStep
  ) {
    lines.push({ axis: "y", major: true, position: y });
  }

  return lines;
}

function gridPositionKey(position: number): string {
  return position.toFixed(4);
}

/** Calculate a camera-anchored dot field from the same adaptive grid contract. */
export function calculateViewportDots(
  width: number,
  height: number,
  camera: CanvasCamera,
  options: ViewportGridOptions = {},
): ViewportGridDot[] {
  const lines = calculateViewportGrid(width, height, camera, options);
  const xPositions = lines.filter((line) => line.axis === "x" && !line.major);
  const yPositions = lines.filter((line) => line.axis === "y" && !line.major);
  const majorX = new Set(
    lines
      .filter((line) => line.axis === "x" && line.major)
      .map((line) => gridPositionKey(line.position)),
  );
  const majorY = new Set(
    lines
      .filter((line) => line.axis === "y" && line.major)
      .map((line) => gridPositionKey(line.position)),
  );

  return xPositions.flatMap((xLine) =>
    yPositions.map((yLine) => ({
      x: xLine.position,
      y: yLine.position,
      major:
        majorX.has(gridPositionKey(xLine.position)) &&
        majorY.has(gridPositionKey(yLine.position)),
    })),
  );
}

/** Draw the quiet dotted field used by Topo's rounded canvas workspaces. */
export function drawViewportDotGrid(
  graphics: Graphics,
  width: number,
  height: number,
  camera: CanvasCamera,
  options: ViewportDotGridOptions = {},
): void {
  const settings = { ...DEFAULT_GRID_OPTIONS, ...options };
  const lines = calculateViewportGrid(width, height, camera, settings);
  const xPositions = lines.filter((line) => line.axis === "x" && !line.major);
  const yPositions = lines.filter((line) => line.axis === "y" && !line.major);
  const majorX = new Set(
    lines
      .filter((line) => line.axis === "x" && line.major)
      .map((line) => gridPositionKey(line.position)),
  );
  const majorY = new Set(
    lines
      .filter((line) => line.axis === "y" && line.major)
      .map((line) => gridPositionKey(line.position)),
  );
  graphics.clear();

  // Draw directly from the adaptive axes so camera movement does not allocate
  // one object per visible dot on every animation frame.
  for (const xLine of xPositions) {
    const xKey = gridPositionKey(xLine.position);
    for (const yLine of yPositions) {
      if (majorX.has(xKey) && majorY.has(gridPositionKey(yLine.position))) {
        continue;
      }
      graphics.circle(
        xLine.position,
        yLine.position,
        options.minorRadius ?? 0.75,
      );
    }
  }
  graphics.fill({ color: settings.minorColor, alpha: settings.minorAlpha });

  for (const xLine of xPositions) {
    if (!majorX.has(gridPositionKey(xLine.position))) continue;
    for (const yLine of yPositions) {
      if (!majorY.has(gridPositionKey(yLine.position))) continue;
      graphics.circle(
        xLine.position,
        yLine.position,
        options.majorRadius ?? 1.25,
      );
    }
  }
  graphics.fill({ color: settings.majorColor, alpha: settings.majorAlpha });
}

export function drawViewportGrid(
  graphics: Graphics,
  width: number,
  height: number,
  camera: CanvasCamera,
  options: ViewportGridOptions = {},
): void {
  const settings = { ...DEFAULT_GRID_OPTIONS, ...options };
  const lines = calculateViewportGrid(width, height, camera, settings);
  graphics.clear();

  for (const line of lines.filter((item) => !item.major)) {
    if (line.axis === "x") {
      graphics.moveTo(line.position, 0).lineTo(line.position, height);
    } else {
      graphics.moveTo(0, line.position).lineTo(width, line.position);
    }
  }
  graphics.stroke({
    color: settings.minorColor,
    width: 1,
    alpha: settings.minorAlpha,
  });

  for (const line of lines.filter((item) => item.major)) {
    if (line.axis === "x") {
      graphics.moveTo(line.position, 0).lineTo(line.position, height);
    } else {
      graphics.moveTo(0, line.position).lineTo(width, line.position);
    }
  }
  graphics.stroke({
    color: settings.majorColor,
    width: 1,
    alpha: settings.majorAlpha,
  });
}

export function createSnapshotTextureCache(
  options: SnapshotTextureCacheOptions = {},
): SnapshotTextureCache {
  interface CacheEntry {
    texture: Texture;
    bytes: number;
    release?: () => void | Promise<void>;
  }

  const maxEntries = options.maxEntries ?? DEFAULT_SNAPSHOT_TEXTURE_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_SNAPSHOT_TEXTURE_MAX_BYTES;
  if (Number.isNaN(maxEntries) || maxEntries < 0) {
    throw new Error("Snapshot texture maxEntries must be non-negative");
  }
  if (Number.isNaN(maxBytes) || maxBytes < 0) {
    throw new Error("Snapshot texture maxBytes must be non-negative");
  }

  const estimateBytes =
    options.estimateBytes ??
    ((texture: Texture) =>
      Math.max(1, texture.width) * Math.max(1, texture.height) * 4);
  const entries = new Map<string, CacheEntry>();
  let retainedIds = new Set<string>();
  let bytes = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  let releaseErrors = 0;

  const overBudget = () => entries.size > maxEntries || bytes > maxBytes;
  const reportReleaseError = (error: unknown, id: string) => {
    releaseErrors += 1;
    options.onReleaseError?.(error, id);
  };
  const releaseEntry = (id: string, entry: CacheEntry) => {
    try {
      const result = entry.release
        ? entry.release()
        : entry.texture.destroy(true);
      if (result instanceof Promise) {
        void result.catch((error: unknown) => reportReleaseError(error, id));
      }
    } catch (error: unknown) {
      reportReleaseError(error, id);
    }
  };
  const removeEntry = (id: string, release: boolean) => {
    const entry = entries.get(id);
    if (!entry) return false;
    entries.delete(id);
    bytes -= entry.bytes;
    if (release) releaseEntry(id, entry);
    return true;
  };
  const prune = () => {
    while (overBudget()) {
      let staleId: string | undefined;
      for (const id of entries.keys()) {
        if (!retainedIds.has(id)) {
          staleId = id;
          break;
        }
      }
      if (!staleId) break;
      if (removeEntry(staleId, true)) evictions += 1;
    }
  };

  return {
    get: (id) => {
      const entry = entries.get(id);
      if (!entry) {
        misses += 1;
        return undefined;
      }
      hits += 1;
      entries.delete(id);
      entries.set(id, entry);
      return entry.texture;
    },
    has: (id) => entries.has(id),
    set: (id, texture, entryOptions = {}) => {
      const previous = entries.get(id);
      if (previous?.texture === texture) {
        entries.delete(id);
        entries.set(id, {
          texture,
          bytes: entryOptions.byteSize ?? previous.bytes,
          release: entryOptions.release ?? previous.release,
        });
        bytes += (entryOptions.byteSize ?? previous.bytes) - previous.bytes;
        prune();
        return;
      }
      if (previous) removeEntry(id, true);
      const entryBytes = Math.max(
        0,
        entryOptions.byteSize ?? estimateBytes(texture),
      );
      entries.set(id, {
        texture,
        bytes: entryBytes,
        release: entryOptions.release,
      });
      bytes += entryBytes;
      prune();
    },
    retain: (ids) => {
      retainedIds = new Set(ids);
      prune();
    },
    delete: (id) => {
      retainedIds.delete(id);
      removeEntry(id, true);
    },
    clear: () => {
      for (const [id, entry] of entries) releaseEntry(id, entry);
      entries.clear();
      retainedIds.clear();
      bytes = 0;
    },
    stats: () => ({
      entries: entries.size,
      bytes,
      retained: [...retainedIds].filter((id) => entries.has(id)).length,
      hits,
      misses,
      evictions,
      releaseErrors,
      maxEntries,
      maxBytes,
      overBudget: overBudget(),
    }),
  };
}
