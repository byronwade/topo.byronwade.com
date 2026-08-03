import { Application, Container, Sprite, Texture } from "pixi.js";

import {
  diffCanvasVisibility,
  selectVisibleCanvasItems,
} from "@topo/canvas-engine";
import { selectLiveFrames } from "@topo/live-frame-host";
import {
  createPixiCanvasHost,
  createSnapshotTextureCache,
} from "@topo/renderer-pixi";

import {
  BROWSER_BENCHMARK_REPORT_VERSION,
  type BrowserBenchmarkProfile,
  type RawBrowserBenchmarkReport,
  type RawBrowserBenchmarkResult,
} from "./browser-contract.js";

type BrowserProfileName = "smoke" | "standard" | "stress";

const PROFILES = {
  smoke: {
    id: "smoke",
    spriteCount: 250,
    textureCount: 64,
    cameraFrames: 60,
    liveFrameCount: 4,
  },
  standard: {
    id: "standard",
    spriteCount: 2_000,
    textureCount: 256,
    cameraFrames: 120,
    liveFrameCount: 4,
  },
  stress: {
    id: "stress",
    spriteCount: 10_000,
    textureCount: 1_024,
    cameraFrames: 240,
    liveFrameCount: 4,
  },
} as const satisfies Record<BrowserProfileName, BrowserBenchmarkProfile>;

const BUDGETS = {
  smoke: {
    initialize: 1_500,
    textures: 100,
    cachePressure: 200,
    sprites: 100,
    frame: 25,
    liveFrames: 1_000,
  },
  standard: {
    initialize: 1_500,
    textures: 180,
    cachePressure: 800,
    sprites: 180,
    frame: 25,
    liveFrames: 1_000,
  },
  stress: {
    initialize: 2_000,
    textures: 500,
    cachePressure: 4_000,
    sprites: 650,
    frame: 25,
    liveFrames: 1_200,
  },
} as const;

interface PreciseMemoryPerformance extends Performance {
  memory?: { usedJSHeapSize: number };
}

declare global {
  interface Window {
    __TOPO_BROWSER_BENCHMARK_READY__?: boolean;
    __TOPO_BROWSER_BENCHMARK__?: {
      run(profile: BrowserProfileName): Promise<RawBrowserBenchmarkReport>;
    };
  }
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function heapUsed(): number | undefined {
  return (performance as PreciseMemoryPerformance).memory?.usedJSHeapSize;
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function createScreenTexture(index: number): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  const hue = (index * 47) % 360;
  context.fillStyle = `hsl(${hue} 36% 12%)`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = `hsl(${hue} 62% 62%)`;
  context.fillRect(8, 8, 42, 6);
  context.fillStyle = "#232833";
  context.fillRect(8, 22, 78, 5);
  context.fillRect(8, 34, 62, 5);
  context.fillRect(8, 48, 32, 8);
  return Texture.from(canvas);
}

function destroySprites(container: Container): void {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true });
  }
}

async function measureTextureUploads(
  app: Application,
  layer: Container,
  profile: BrowserBenchmarkProfile,
): Promise<{ samples: number[]; textures: Texture[] }> {
  const cache = createSnapshotTextureCache({
    maxEntries: Number.POSITIVE_INFINITY,
    maxBytes: Number.POSITIVE_INFINITY,
  });
  const textures: Texture[] = [];
  const sampleCount = Math.min(profile.textureCount, 20);
  const batchSize = Math.ceil(profile.textureCount / sampleCount);
  const samples: number[] = [];

  for (let batch = 0; batch < sampleCount; batch += 1) {
    const startedAt = performance.now();
    const start = batch * batchSize;
    const end = Math.min(profile.textureCount, start + batchSize);
    for (let index = start; index < end; index += 1) {
      const texture = createScreenTexture(index);
      textures.push(texture);
      cache.set(`snapshot-${index}`, texture);
      const sprite = new Sprite(texture);
      sprite.position.set((index % 16) * 98, Math.floor(index / 16) * 66);
      layer.addChild(sprite);
    }
    app.render();
    await nextFrame();
    samples.push(performance.now() - startedAt);
    destroySprites(layer);
  }

  return { samples, textures };
}

function measureTextureCachePressure(profile: BrowserBenchmarkProfile): {
  samples: number[];
  workload: Record<string, number | string>;
} {
  const maxEntries = 48;
  const maxBytes = 2 * 1024 * 1024;
  const retainedLimit = 8;
  const cache = createSnapshotTextureCache({ maxEntries, maxBytes });
  const sampleCount = 20;
  const batchSize = Math.ceil(profile.spriteCount / sampleCount);
  const samples: number[] = [];
  let retainedIds: string[] = [];

  for (let batch = 0; batch < sampleCount; batch += 1) {
    const startedAt = performance.now();
    const start = batch * batchSize;
    const end = Math.min(profile.spriteCount, start + batchSize);
    for (let index = start; index < end; index += 1) {
      const id = `pressure-${index}`;
      retainedIds = [...retainedIds, id].slice(-retainedLimit);
      cache.retain(retainedIds);
      cache.set(id, createScreenTexture(index));
    }
    samples.push(performance.now() - startedAt);
  }

  for (const id of retainedIds) {
    if (!cache.get(id)) throw new Error(`Retained texture was evicted: ${id}`);
  }
  const stats = cache.stats();
  if (
    stats.entries > maxEntries ||
    stats.bytes > maxBytes ||
    stats.retained !== retainedIds.length ||
    stats.evictions === 0 ||
    stats.overBudget
  ) {
    throw new Error(
      `Snapshot cache pressure invariant failed: ${JSON.stringify(stats)}`,
    );
  }
  cache.clear();

  return {
    samples,
    workload: {
      candidates: profile.spriteCount,
      activeRetained: retainedIds.length,
      maxEntries,
      maxBytes,
      finalEntries: stats.entries,
      finalBytes: stats.bytes,
      evictions: stats.evictions,
      overBudget: String(stats.overBudget),
    },
  };
}

async function measureSpriteRendering(
  app: Application,
  layer: Container,
  profile: BrowserBenchmarkProfile,
  textures: readonly Texture[],
): Promise<number[]> {
  const samples: number[] = [];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < profile.spriteCount; index += 1) {
      const texture = textures[index % textures.length];
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.width = 76;
      sprite.height = 52;
      sprite.position.set((index % 80) * 80, Math.floor(index / 80) * 56);
      sprite.tint = 0xffffff - ((index + iteration) % 8) * 0x080808;
      layer.addChild(sprite);
    }
    app.render();
    await nextFrame();
    samples.push(performance.now() - startedAt);
    destroySprites(layer);
  }
  return samples;
}

async function measureCameraFrames(
  app: Application,
  world: Container,
  count: number,
  scene: {
    items: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      sprite: Sprite;
    }>;
    width: number;
    height: number;
  },
): Promise<{
  samples: number[];
  visibleCounts: number[];
  workSamples: number[];
  visibilityMutations: number;
}> {
  const samples: number[] = [];
  const visibleCounts: number[] = [];
  const workSamples: number[] = [];
  let visibilityMutations = 0;
  const spritesById = new Map(
    scene.items.map((item) => [item.id, item.sprite]),
  );
  let previousVisible = new Set<string>();
  let previous = await nextFrame();
  for (let index = 0; index < count; index += 1) {
    const timestamp = await nextFrame();
    samples.push(timestamp - previous);
    previous = timestamp;
    const workStartedAt = performance.now();
    const progress = count <= 1 ? 0 : index / (count - 1);
    const zoom = 0.28 + ((index % 90) / 90) * 0.72;
    const focusX = 720 + Math.max(0, scene.width - 1_440) * progress;
    const focusY = 450 + Math.max(0, scene.height - 900) * progress;
    const camera = {
      x: 720 - focusX * zoom,
      y: 450 - focusY * zoom,
      zoom,
    };
    const delta = diffCanvasVisibility(
      previousVisible,
      selectVisibleCanvasItems(
        scene.items,
        camera,
        { width: 1_440, height: 900 },
        { overscan: 120 },
      ),
    );
    for (const id of delta.exited) {
      const sprite = spritesById.get(id);
      if (sprite) sprite.visible = false;
    }
    for (const id of delta.entered) {
      const sprite = spritesById.get(id);
      if (sprite) sprite.visible = true;
    }
    visibilityMutations += delta.entered.length + delta.exited.length;
    previousVisible = delta.visible;
    visibleCounts.push(previousVisible.size);
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.zoom);
    app.render();
    workSamples.push(performance.now() - workStartedAt);
  }
  return { samples, visibleCounts, workSamples, visibilityMutations };
}

async function measureLiveFramePromotion(
  profile: BrowserBenchmarkProfile,
): Promise<number[]> {
  const candidates = Array.from(
    { length: profile.liveFrameCount },
    (_, index) => ({
      id: `live-${index}`,
      title: `Live route ${index}`,
      routePath: `/browser/frame.html?id=${index}`,
      position: { x: index * 820, y: 0 },
      width: 780,
      height: 688,
      selected: index === 0,
      live: true,
    }),
  );
  const frames = selectLiveFrames(location.origin, candidates, {
    maxFrames: profile.liveFrameCount,
  });
  const samples: number[] = [];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const startedAt = performance.now();
    const elements = frames.map((frame) => {
      const iframe = document.createElement("iframe");
      iframe.hidden = true;
      iframe.sandbox.value = frame.sandbox;
      iframe.src = frame.src;
      iframe.title = frame.title;
      document.body.appendChild(iframe);
      return iframe;
    });
    await Promise.all(
      elements.map(
        (iframe) =>
          new Promise<void>((resolve, reject) => {
            iframe.addEventListener("load", () => resolve(), { once: true });
            iframe.addEventListener(
              "error",
              () => reject(new Error(`Live frame failed: ${iframe.src}`)),
              { once: true },
            );
          }),
      ),
    );
    samples.push(performance.now() - startedAt);
    for (const iframe of elements) iframe.remove();
    await nextFrame();
  }
  return samples;
}

async function runBrowserBenchmark(
  profileName: BrowserProfileName,
): Promise<RawBrowserBenchmarkReport> {
  const profile = PROFILES[profileName];
  const budgets = BUDGETS[profileName];
  const host = document.querySelector<HTMLElement>("#benchmark-host");
  const status = document.querySelector<HTMLElement>("#benchmark-status");
  if (!host || !status) throw new Error("Benchmark host is unavailable");
  status.textContent = `Running ${profile.id} browser profile`;
  const memoryBefore = heapUsed();
  const initializeStartedAt = performance.now();
  const pixiHost = await createPixiCanvasHost(host, {
    background: 0x090a0c,
    resolution: 1,
    renderer: "pixi-benchmark",
  });
  const { app } = pixiHost;
  if (app.ticker.started) {
    pixiHost.destroy();
    throw new Error("Shared Pixi host started an idle render ticker");
  }
  const initializeSample = performance.now() - initializeStartedAt;
  const world = new Container();
  const layer = new Container();
  world.addChild(layer);
  app.stage.addChild(world);
  const renderer = app.renderer as typeof app.renderer & {
    gl?: WebGLRenderingContext | WebGL2RenderingContext;
  };
  const gl = renderer.gl;
  if (!gl) throw new Error("Pixi did not initialize a WebGL context");
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info") as {
    UNMASKED_RENDERER_WEBGL: number;
  } | null;
  const adapter = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    : "Unavailable";
  const softwareRenderer = /swiftshader/i.test(adapter);
  const frameCadenceBudget = softwareRenderer ? 50 : budgets.frame;
  const textureUploadBudget = softwareRenderer
    ? budgets.textures * 1.5
    : budgets.textures;
  const textureMeasurement = await measureTextureUploads(app, layer, profile);
  const cachePressureMeasurement = measureTextureCachePressure(profile);
  const spriteSamples = await measureSpriteRendering(
    app,
    layer,
    profile,
    textureMeasurement.textures,
  );
  const cameraColumns = Math.max(
    1,
    Math.ceil(Math.sqrt(profile.spriteCount * 1.6)),
  );
  const cameraItems: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    sprite: Sprite;
  }> = [];
  for (let index = 0; index < profile.spriteCount; index += 1) {
    const texture =
      textureMeasurement.textures[index % textureMeasurement.textures.length];
    if (!texture) continue;
    const sprite = new Sprite(texture);
    const x = (index % cameraColumns) * 840;
    const y = Math.floor(index / cameraColumns) * 748;
    sprite.width = 780;
    sprite.height = 688;
    sprite.position.set(x, y);
    sprite.visible = false;
    world.addChild(sprite);
    cameraItems.push({
      id: `camera-screen-${index}`,
      x,
      y,
      width: 780,
      height: 688,
      sprite,
    });
  }
  const cameraRows = Math.ceil(profile.spriteCount / cameraColumns);
  const cameraMeasurement = await measureCameraFrames(
    app,
    world,
    profile.cameraFrames,
    {
      items: cameraItems,
      width: cameraColumns * 840,
      height: cameraRows * 748,
    },
  );
  const liveFrameSamples = await measureLiveFramePromotion(profile);
  const memoryWorking = heapUsed();
  const rendererReport = {
    name: app.renderer.constructor.name,
    resolution: 1,
    webglVersion: String(gl.getParameter(gl.VERSION)),
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    adapter,
  };
  const results: RawBrowserBenchmarkResult[] = [
    {
      id: "pixi-initialize",
      title: "Pixi renderer initialization",
      description: "Initialize the actual PixiJS WebGL renderer and canvas.",
      samplesMs: [initializeSample],
      budgetMs: budgets.initialize,
      enforced: true,
      workload: {
        width: 1_440,
        height: 900,
        resolution: 1,
        latencyClass: "cold",
        renderMode: "on-demand",
      },
    },
    {
      id: "snapshot-texture-upload",
      title: "Snapshot texture upload",
      description:
        "Create, cache, upload, render, and detach deterministic screen textures in five batches.",
      samplesMs: textureMeasurement.samples,
      budgetMs: textureUploadBudget,
      enforced: true,
      workload: {
        textures: profile.textureCount,
        batches: textureMeasurement.samples.length,
        nativeGpuBudgetMs: budgets.textures,
        softwareRenderer: String(softwareRenderer),
        latencyClass: "hot",
      },
    },
    {
      id: "snapshot-cache-pressure",
      title: "Snapshot cache pressure",
      description:
        "Traverse route-scale texture candidates while retaining only the selected and nearest window inside hard entry and byte budgets.",
      samplesMs: cachePressureMeasurement.samples,
      budgetMs: budgets.cachePressure,
      enforced: true,
      workload: {
        ...cachePressureMeasurement.workload,
        latencyClass: "hot",
      },
    },
    {
      id: "atlas-sprite-render",
      title: "Atlas sprite render",
      description:
        "Create and render a complete batch of cached screen sprites through PixiJS.",
      samplesMs: spriteSamples,
      budgetMs: budgets.sprites,
      enforced: true,
      workload: {
        sprites: profile.spriteCount,
        textures: profile.textureCount,
        latencyClass: "hot",
      },
    },
    {
      id: "camera-frame-work",
      title: "Camera frame work",
      description:
        "Cull visible items, mutate scene visibility, move the world, and submit one Pixi render for a camera frame.",
      samplesMs: cameraMeasurement.workSamples,
      budgetMs: 8,
      enforced: true,
      workload: {
        frames: profile.cameraFrames,
        sceneSprites: cameraItems.length,
        minVisibleSprites: Math.min(...cameraMeasurement.visibleCounts),
        maxVisibleSprites: Math.max(...cameraMeasurement.visibleCounts),
        visibilityMutations: cameraMeasurement.visibilityMutations,
        latencyClass: "hot",
      },
    },
    {
      id: "camera-frame-pacing",
      title: "Display frame cadence",
      description:
        "Observe requestAnimationFrame cadence separately from Topo's controllable camera work.",
      samplesMs: cameraMeasurement.samples,
      budgetMs: frameCadenceBudget,
      // requestAnimationFrame cadence is owned by the browser scheduler. A
      // SwiftShader runner cannot provide native-GPU pacing proof, so retain
      // the measurement as an informational result while keeping the
      // product-controlled camera-frame-work gate enforced.
      enforced: !softwareRenderer,
      workload: {
        frames: profile.cameraFrames,
        sceneSprites: cameraItems.length,
        nativeGpuBudgetMs: budgets.frame,
        measuredP95Ms: Number(p95(cameraMeasurement.samples).toFixed(3)),
        softwareRenderer: String(softwareRenderer),
        latencyClass: "external",
      },
    },
    {
      id: "live-frame-promotion",
      title: "Live iframe promotion",
      description:
        "Select, mount, load, and remove the configured bounded application iframe pool.",
      samplesMs: liveFrameSamples,
      budgetMs: budgets.liveFrames,
      enforced: true,
      workload: {
        liveFrames: profile.liveFrameCount,
        samples: liveFrameSamples.length,
        latencyClass: "external",
      },
    },
  ];
  status.textContent = `${profile.id} browser profile complete`;
  destroySprites(world);
  for (const texture of textureMeasurement.textures) texture.destroy(false);
  pixiHost.destroy();

  return {
    version: BROWSER_BENCHMARK_REPORT_VERSION,
    profile,
    renderer: rendererReport,
    ...(memoryBefore !== undefined && memoryWorking !== undefined
      ? {
          memory: {
            beforeBytes: memoryBefore,
            workingBytes: memoryWorking,
            collection: "unavailable" as const,
          },
        }
      : {}),
    results,
  };
}

window.__TOPO_BROWSER_BENCHMARK__ = { run: runBrowserBenchmark };
window.__TOPO_BROWSER_BENCHMARK_READY__ = true;
