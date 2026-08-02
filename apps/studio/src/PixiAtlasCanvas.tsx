import { useEffect, useRef } from "react";

// Loaded with the GPU destination so strict-CSP synchronization polyfills do
// not make Pixi part of the shell or DOM-only destinations.
import "pixi.js/unsafe-eval";
import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";

import {
  diffCanvasVisibility,
  isDynamicRoutePath,
  selectVisibleCanvasItems,
  type CanvasCamera,
  type CanvasViewportSize,
} from "@topo/canvas-engine";
import type { AtlasScene } from "@topo/layout";
import {
  createPixiCanvasHost,
  drawViewportDotGrid,
  prioritizeVisibleTextureCandidates,
  type PixiCanvasHost,
} from "@topo/renderer-pixi";

import {
  loadStudioSnapshotTexture,
  reportStudioTextureCache,
  STUDIO_ACTIVE_SNAPSHOT_TEXTURE_LIMIT,
  studioSnapshotTextureCache,
} from "./snapshot-texture-cache";
import {
  selectRouteMapTextureCandidates,
  studioSnapshotTextureKey,
} from "./route-map-textures";
import {
  selectRouteMapHeaderLayout,
  selectRouteMapLabelVisibility,
} from "./route-map-presentation";
import type { StudioSnapshot } from "./studio-model";

interface PixiAtlasCanvasProps {
  camera: CanvasCamera;
  mode: AtlasCanvasMode;
  onResize: (size: CanvasViewportSize) => void;
  onSelectScreen?: (screenId: string) => void;
  onSnapshotStateChange?: (
    snapshotId: string | undefined,
    state: SnapshotRenderState,
  ) => void;
  scene: AtlasScene;
  selectedScreenId?: string;
  snapshots: StudioSnapshot[];
}

export type AtlasCanvasMode = "map" | "screen";
export type SnapshotRenderState = "unavailable" | "loading" | "ready" | "error";

const CANVAS_COLOR = 0x0a0a0a;
const ARTBOARD_COLOR = 0x090a0d;
const ARTBOARD_BORDER = 0x23252e;
const SELECTED_BORDER = 0x2e8bff;
const SECTION_BORDER = 0x202328;
const SECTION_SURFACE = 0x0c0d10;
const GROUP_BORDER = 0x24262a;
const GROUP_SURFACE = 0x101114;
const CONNECTION_COLOR = 0x2e6ca8;
const TEXT_PRIMARY = 0xf0f2f5;
const TEXT_MUTED = 0x8a8f98;
const TEXT_FAINT = 0x5f6570;
const MAX_CONCURRENT_TEXTURE_LOADS = 4;
const ACTIVE_ROUTE_TEXTURE_LIMIT = 24;

function clearContainer(container: Container): void {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true });
  }
}

function compactLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function compactPath(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `…${value.slice(-(maxLength - 1))}`;
}

/** GPU route atlas beneath the bounded live-frame DOM promotion pool. */
export function PixiAtlasCanvas({
  camera,
  mode,
  onResize,
  onSelectScreen,
  onSnapshotStateChange,
  scene,
  selectedScreenId,
  snapshots,
}: PixiAtlasCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  const modeRef = useRef(mode);
  const sceneRef = useRef(scene);
  const selectedScreenIdRef = useRef(selectedScreenId);
  const snapshotsRef = useRef(snapshots);
  const onResizeRef = useRef(onResize);
  const onSelectScreenRef = useRef(onSelectScreen);
  const onSnapshotStateChangeRef = useRef(onSnapshotStateChange);
  const redrawRef = useRef<(() => void) | null>(null);
  const renderSceneRef = useRef<
    ((nextScene: AtlasScene, nextSnapshots: StudioSnapshot[]) => void) | null
  >(null);

  cameraRef.current = camera;
  modeRef.current = mode;
  sceneRef.current = scene;
  selectedScreenIdRef.current = selectedScreenId;
  snapshotsRef.current = snapshots;
  onResizeRef.current = onResize;
  onSelectScreenRef.current = onSelectScreen;
  onSnapshotStateChangeRef.current = onSnapshotStateChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let pixiHost: PixiCanvasHost | undefined;

    void (async () => {
      const mounted = await createPixiCanvasHost(host, {
        background: CANVAS_COLOR,
        renderer: "pixi-atlas",
      });
      if (disposed) {
        mounted.destroy();
        return;
      }
      pixiHost = mounted;
      const { app } = mounted;

      const grid = new Graphics();
      const world = new Container();
      const sectionLayer = new Container();
      const groupLayer = new Container();
      const hierarchyLayer = new Container();
      const connectionLayer = new Container();
      const routeLayer = new Container();
      const screenLayer = new Container();
      world.addChild(
        sectionLayer,
        groupLayer,
        hierarchyLayer,
        connectionLayer,
        routeLayer,
        screenLayer,
      );
      app.stage.addChild(grid, world);

      const sectionContainers = new Map<string, Container>();
      const groupContainers = new Map<string, Container>();
      const routeContainers = new Map<string, Container>();
      const screenContainers = new Map<string, Container>();
      const hierarchyContainers = new Map<string, Container>();
      const connectionContainers = new Map<string, Container>();
      let visibleSectionIds = new Set<string>();
      let visibleGroupIds = new Set<string>();
      let visibleRouteIds = new Set<string>();
      let visibleScreenIds = new Set<string>();
      let visibleHierarchyIds = new Set<string>();
      let visibleConnectionIds = new Set<string>();
      const sectionLabels: Array<{
        title: Text;
        meta: Text;
        path: Text;
        metaFits: boolean;
      }> = [];
      const groupLabels: Array<{
        title: Text;
        path: Text;
        meta: Text;
        layoutMode: Text;
        metaFits: boolean;
        layoutModeFits: boolean;
      }> = [];
      const routeLabels: Array<{
        title: Text;
        path: Text;
        meta: Text;
      }> = [];
      const screenLabels: Array<{
        title: Text;
        meta: Text;
        surface: Graphics;
        dot: Graphics;
      }> = [];
      const textureTargets = new Map<
        string,
        {
          layer: Container;
          width: number;
          height: number;
          radius: number;
          alpha: number;
        }
      >();
      const targetTextureKeys = new Map<string, string>();
      const activeTextureTargets = new Map<
        string,
        {
          key: string;
          imageUrl: string;
          snapshot: StudioSnapshot;
          screenId: string;
        }
      >();
      const attachedTextureKeys = new Map<string, string>();
      let activeTextureKeys = new Set<string>();
      const failedTextureKeys = new Set<string>();
      const pendingTextureLoads = new Map<string, Promise<Texture>>();

      const reportSelectedState = (
        snapshot: StudioSnapshot | undefined,
        state: SnapshotRenderState,
      ) => {
        host.dataset.snapshotId = snapshot?.id ?? "none";
        host.dataset.snapshotState = state;
        onSnapshotStateChangeRef.current?.(snapshot?.id, state);
      };

      const attachTexture = (
        targetId: string,
        key: string,
        texture: Texture,
      ) => {
        if (targetTextureKeys.get(targetId) !== key) return;
        const target = textureTargets.get(targetId);
        if (!target) return;

        clearContainer(target.layer);
        const sprite = new Sprite(texture);
        sprite.width = target.width;
        sprite.height = target.height;
        sprite.alpha = target.alpha;
        const mask = new Graphics()
          .roundRect(0, 0, target.width, target.height, target.radius)
          .fill({ color: 0xffffff });
        sprite.mask = mask;
        target.layer.addChild(sprite, mask);
        attachedTextureKeys.set(targetId, key);
        reportStudioTextureCache(host, attachedTextureKeys.size);
      };

      const hydrateVisibleTextures = () => {
        if (pendingTextureLoads.size >= MAX_CONCURRENT_TEXTURE_LOADS) return;
        const candidates = [...activeTextureTargets.entries()].filter(
          ([, candidate]) =>
            activeTextureKeys.has(candidate.key) &&
            !studioSnapshotTextureCache.has(candidate.key) &&
            !pendingTextureLoads.has(candidate.key) &&
            !failedTextureKeys.has(candidate.key),
        );

        while (
          candidates.length > 0 &&
          pendingTextureLoads.size < MAX_CONCURRENT_TEXTURE_LOADS
        ) {
          const [targetId, candidate] = candidates.shift()!;
          const request = loadStudioSnapshotTexture(
            candidate.key,
            candidate.imageUrl,
          );
          const key = candidate.key;
          pendingTextureLoads.set(key, request);
          void request
            .then((texture) => {
              if (
                !disposed &&
                activeTextureKeys.has(key) &&
                studioSnapshotTextureCache.has(key)
              ) {
                attachTexture(targetId, key, texture);
              }
              if (
                !disposed &&
                modeRef.current === "screen" &&
                candidate.screenId === selectedScreenIdRef.current &&
                studioSnapshotTextureCache.has(key)
              ) {
                reportSelectedState(candidate.snapshot, "ready");
              }
            })
            .catch((error: unknown) => {
              failedTextureKeys.add(key);
              if (
                modeRef.current === "screen" &&
                candidate.screenId === selectedScreenIdRef.current
              ) {
                reportSelectedState(candidate.snapshot, "error");
                host.dataset.rendererError =
                  error instanceof Error
                    ? error.message
                    : "Snapshot texture failed to load";
              }
            })
            .finally(() => {
              pendingTextureLoads.delete(key);
              if (!disposed) requestAnimationFrame(() => redrawRef.current?.());
            });
        }
      };

      const redraw = () => {
        const viewportWidth = host.clientWidth;
        const viewportHeight = host.clientHeight;
        drawViewportDotGrid(
          grid,
          viewportWidth,
          viewportHeight,
          cameraRef.current,
          {
            majorAlpha: 0.62,
            majorColor: 0x343434,
            minorAlpha: 0.5,
            minorColor: 0x282828,
          },
        );
        world.position.set(cameraRef.current.x, cameraRef.current.y);
        world.scale.set(cameraRef.current.zoom);

        const mapMode = modeRef.current === "map";
        sectionLayer.visible = mapMode;
        groupLayer.visible = mapMode;
        hierarchyLayer.visible = mapMode;
        connectionLayer.visible = mapMode;
        routeLayer.visible = mapMode;
        screenLayer.visible = !mapMode;
        const viewport = { width: viewportWidth, height: viewportHeight };
        const nextSections = mapMode
          ? selectVisibleCanvasItems(
              sceneRef.current.routeMap.sections.map((section) => ({
                id: section.id,
                x: section.position.x,
                y: section.position.y,
                width: section.width,
                height: section.height,
              })),
              cameraRef.current,
              viewport,
              { overscan: 160 },
            )
          : [];
        const nextGroups = mapMode
          ? selectVisibleCanvasItems(
              sceneRef.current.routeMap.groups.map((group) => ({
                id: group.id,
                x: group.position.x,
                y: group.position.y,
                width: group.width,
                height: group.height,
              })),
              cameraRef.current,
              viewport,
              { overscan: 120 },
            )
          : [];
        const nextRoutes = mapMode
          ? selectVisibleCanvasItems(
              sceneRef.current.routeMap.routes.map((route) => ({
                id: route.id,
                x: route.position.x,
                y: route.position.y,
                width: route.width,
                height: route.height,
              })),
              cameraRef.current,
              viewport,
              { overscan: 120 },
            )
          : [];
        const nextHierarchyConnections = mapMode
          ? selectVisibleCanvasItems(
              sceneRef.current.routeMap.hierarchyConnections.map(
                (connection) => ({
                  id: connection.id,
                  x: Math.min(
                    connection.sourcePoint.x,
                    connection.targetPoint.x,
                  ),
                  y: Math.min(
                    connection.sourcePoint.y,
                    connection.targetPoint.y,
                  ),
                  width: Math.max(
                    1,
                    Math.abs(
                      connection.targetPoint.x - connection.sourcePoint.x,
                    ),
                  ),
                  height: Math.max(
                    1,
                    Math.abs(
                      connection.targetPoint.y - connection.sourcePoint.y,
                    ),
                  ),
                }),
              ),
              cameraRef.current,
              viewport,
              { overscan: 120 },
            )
          : [];
        const nextScreens = mapMode
          ? []
          : selectVisibleCanvasItems(
              sceneRef.current.layout.screens.map((screen) => ({
                id: screen.id,
                x: screen.position.x,
                y: screen.position.y,
                width: screen.width,
                height: screen.height,
                alwaysVisible: screen.id === selectedScreenIdRef.current,
              })),
              cameraRef.current,
              viewport,
              { overscan: 120 },
            ).filter((screen) => screen.id === selectedScreenIdRef.current);
        const nextConnections = mapMode
          ? selectVisibleCanvasItems(
              sceneRef.current.connections.map((connection) => {
                const distance = Math.max(
                  120,
                  Math.abs(
                    connection.targetPoint.x - connection.sourcePoint.x,
                  ) * 0.42,
                );
                const left =
                  Math.min(connection.sourcePoint.x, connection.targetPoint.x) -
                  distance;
                const top = Math.min(
                  connection.sourcePoint.y,
                  connection.targetPoint.y,
                );
                return {
                  id: connection.id,
                  x: left,
                  y: top,
                  width:
                    Math.abs(
                      connection.targetPoint.x - connection.sourcePoint.x,
                    ) +
                    distance * 2,
                  height: Math.max(
                    1,
                    Math.abs(
                      connection.targetPoint.y - connection.sourcePoint.y,
                    ),
                  ),
                };
              }),
              cameraRef.current,
              viewport,
              { overscan: 80 },
            )
          : [];
        const labelVisibility = selectRouteMapLabelVisibility(
          cameraRef.current.zoom,
        );
        for (const label of sectionLabels) {
          label.title.scale.set(
            Math.min(1.35, 12 / (48 * cameraRef.current.zoom)),
          );
          label.path.visible = labelVisibility.sectionProvenance;
          label.path.scale.set(
            Math.min(2.1, 8 / (19 * cameraRef.current.zoom)),
          );
          label.meta.visible = labelVisibility.sectionMeta && label.metaFits;
          label.meta.scale.set(
            Math.min(1.9, 8 / (18 * cameraRef.current.zoom)),
          );
        }
        for (const label of groupLabels) {
          label.title.scale.set(
            Math.min(1.25, 10 / (52 * cameraRef.current.zoom)),
          );
          label.path.scale.set(
            Math.min(2.2, 8 / (24 * cameraRef.current.zoom)),
          );
          label.path.visible = labelVisibility.groupPath;
          label.meta.visible = labelVisibility.groupMeta && label.metaFits;
          label.meta.scale.set(
            Math.min(2.2, 8 / (20 * cameraRef.current.zoom)),
          );
          label.layoutMode.visible =
            labelVisibility.groupPath && label.layoutModeFits;
        }
        for (const label of routeLabels) {
          label.title.scale.set(
            Math.min(1.8, 10 / (34 * cameraRef.current.zoom)),
          );
          label.path.visible = labelVisibility.routePath;
          label.path.scale.set(
            Math.min(2.1, 7 / (20 * cameraRef.current.zoom)),
          );
          label.meta.visible = labelVisibility.routeMeta;
        }
        for (const label of screenLabels) {
          label.surface.visible = false;
          label.dot.visible = false;
          label.title.visible = false;
          label.meta.visible = false;
        }
        const sectionDelta = diffCanvasVisibility(
          visibleSectionIds,
          nextSections,
        );
        for (const sectionId of sectionDelta.exited) {
          const container = sectionContainers.get(sectionId);
          if (container) container.visible = false;
        }
        for (const sectionId of sectionDelta.entered) {
          const container = sectionContainers.get(sectionId);
          if (container) container.visible = true;
        }
        visibleSectionIds = sectionDelta.visible;

        const groupDelta = diffCanvasVisibility(visibleGroupIds, nextGroups);
        for (const groupId of groupDelta.exited) {
          const container = groupContainers.get(groupId);
          if (container) container.visible = false;
        }
        for (const groupId of groupDelta.entered) {
          const container = groupContainers.get(groupId);
          if (container) container.visible = true;
        }
        visibleGroupIds = groupDelta.visible;

        const routeDelta = diffCanvasVisibility(visibleRouteIds, nextRoutes);
        for (const routeId of routeDelta.exited) {
          const container = routeContainers.get(routeId);
          if (container) container.visible = false;
        }
        for (const routeId of routeDelta.entered) {
          const container = routeContainers.get(routeId);
          if (container) container.visible = true;
        }
        visibleRouteIds = routeDelta.visible;

        const hierarchyDelta = diffCanvasVisibility(
          visibleHierarchyIds,
          nextHierarchyConnections,
        );
        for (const connectionId of hierarchyDelta.exited) {
          const container = hierarchyContainers.get(connectionId);
          if (container) container.visible = false;
        }
        for (const connectionId of hierarchyDelta.entered) {
          const container = hierarchyContainers.get(connectionId);
          if (container) container.visible = true;
        }
        visibleHierarchyIds = hierarchyDelta.visible;

        const connectionDelta = diffCanvasVisibility(
          visibleConnectionIds,
          nextConnections,
        );
        for (const connectionId of connectionDelta.exited) {
          const container = connectionContainers.get(connectionId);
          if (container) container.visible = false;
        }
        for (const connectionId of connectionDelta.entered) {
          const container = connectionContainers.get(connectionId);
          if (container) container.visible = true;
        }
        visibleConnectionIds = connectionDelta.visible;

        const screenDelta = diffCanvasVisibility(visibleScreenIds, nextScreens);
        for (const screenId of screenDelta.exited) {
          const container = screenContainers.get(screenId);
          if (container) container.visible = false;
        }
        for (const screenId of screenDelta.entered) {
          const container = screenContainers.get(screenId);
          if (container) container.visible = true;
        }
        visibleScreenIds = screenDelta.visible;

        const snapshotByScreen = new Map(
          snapshotsRef.current
            .filter(
              (snapshot): snapshot is StudioSnapshot & { imageUrl: string } =>
                snapshot.status === "captured" && Boolean(snapshot.imageUrl),
            )
            .map((snapshot) => [snapshot.screenId, snapshot]),
        );
        const snapshotById = new Map(
          snapshotsRef.current.map((snapshot) => [snapshot.id, snapshot]),
        );
        const nextScreenIds = new Set(nextScreens.map((screen) => screen.id));
        const activeCandidates = mapMode
          ? selectRouteMapTextureCandidates({
              camera: cameraRef.current,
              limit: ACTIVE_ROUTE_TEXTURE_LIMIT,
              scene: sceneRef.current,
              snapshots: snapshotsRef.current,
              viewport,
            }).flatMap((candidate) => {
              const snapshot = snapshotById.get(candidate.snapshotId);
              if (!snapshot) return [];
              return [
                {
                  targetId: `map:${candidate.routeId}`,
                  key: candidate.textureKey,
                  imageUrl: candidate.imageUrl,
                  screenId: candidate.screenId,
                  snapshot,
                },
              ];
            })
          : prioritizeVisibleTextureCandidates(
              sceneRef.current.layout.screens.flatMap((screen) => {
                const snapshot = snapshotByScreen.get(screen.id);
                if (!snapshot?.imageUrl || !nextScreenIds.has(screen.id)) {
                  return [];
                }
                return [
                  {
                    id: screen.id,
                    x: screen.position.x,
                    y: screen.position.y,
                    width: screen.width,
                    height: screen.height,
                    selected: screen.id === selectedScreenIdRef.current,
                    alwaysVisible: screen.id === selectedScreenIdRef.current,
                    key: studioSnapshotTextureKey(snapshot),
                    imageUrl: snapshot.imageUrl,
                    snapshot,
                  },
                ];
              }),
              cameraRef.current,
              viewport,
              STUDIO_ACTIVE_SNAPSHOT_TEXTURE_LIMIT,
            ).map((candidate) => ({
              targetId: `screen:${candidate.id}`,
              key: candidate.key,
              imageUrl: candidate.imageUrl,
              screenId: candidate.id,
              snapshot: candidate.snapshot,
            }));
        activeTextureTargets.clear();
        for (const candidate of activeCandidates) {
          activeTextureTargets.set(candidate.targetId, candidate);
          targetTextureKeys.set(candidate.targetId, candidate.key);
        }
        activeTextureKeys = new Set(
          activeCandidates.map((candidate) => candidate.key),
        );
        studioSnapshotTextureCache.retain(activeTextureKeys);
        for (const [targetId, key] of attachedTextureKeys) {
          if (
            activeTextureKeys.has(key) &&
            activeTextureTargets.get(targetId)?.key === key
          ) {
            continue;
          }
          const target = textureTargets.get(targetId);
          if (target) clearContainer(target.layer);
          attachedTextureKeys.delete(targetId);
        }
        for (const candidate of activeCandidates) {
          if (attachedTextureKeys.get(candidate.targetId) === candidate.key) {
            continue;
          }
          const cached = studioSnapshotTextureCache.get(candidate.key);
          if (cached) {
            attachTexture(candidate.targetId, candidate.key, cached);
          }
        }

        const visibleScreenCount = visibleScreenIds.size;
        host.dataset.detailMode = mapMode ? "map" : "screen";
        host.dataset.visibleSectionCount = String(visibleSectionIds.size);
        host.dataset.visibleRouteCount = String(visibleRouteIds.size);
        host.dataset.culledRouteCount = String(
          Math.max(0, routeContainers.size - visibleRouteIds.size),
        );
        host.dataset.visibleScreenCount = String(visibleScreenCount);
        host.dataset.culledScreenCount = String(
          Math.max(0, screenContainers.size - visibleScreenCount),
        );
        host.dataset.visibleGroupCount = String(visibleGroupIds.size);
        host.dataset.visibleHierarchyConnectionCount = String(
          visibleHierarchyIds.size,
        );
        host.dataset.visibleConnectionCount = String(visibleConnectionIds.size);
        reportStudioTextureCache(host, attachedTextureKeys.size);
        onResizeRef.current({ width: viewportWidth, height: viewportHeight });
        mounted.render();
        hydrateVisibleTextures();
      };
      redrawRef.current = redraw;

      const renderScene = (
        nextScene: AtlasScene,
        nextSnapshots: StudioSnapshot[],
      ) => {
        clearContainer(sectionLayer);
        clearContainer(groupLayer);
        clearContainer(hierarchyLayer);
        clearContainer(connectionLayer);
        clearContainer(routeLayer);
        clearContainer(screenLayer);
        sectionContainers.clear();
        groupContainers.clear();
        routeContainers.clear();
        screenContainers.clear();
        hierarchyContainers.clear();
        connectionContainers.clear();
        visibleSectionIds = new Set();
        visibleGroupIds = new Set();
        visibleRouteIds = new Set();
        visibleScreenIds = new Set();
        visibleHierarchyIds = new Set();
        visibleConnectionIds = new Set();
        sectionLabels.length = 0;
        groupLabels.length = 0;
        routeLabels.length = 0;
        screenLabels.length = 0;
        textureTargets.clear();
        targetTextureKeys.clear();
        activeTextureTargets.clear();
        attachedTextureKeys.clear();

        for (const section of nextScene.routeMap.sections) {
          const container = new Container();
          container.visible = false;
          container.position.set(section.position.x, section.position.y);
          const selectedSection = section.screenIds.includes(
            selectedScreenIdRef.current ?? "",
          );
          const frame = new Graphics()
            .roundRect(0, 0, section.width, section.height, 26)
            .fill({ color: SECTION_SURFACE, alpha: 0.72 })
            .stroke({
              color: selectedSection ? 0x223c59 : SECTION_BORDER,
              width: 2,
            });
          const accent = new Graphics().roundRect(22, 24, 7, 48, 4).fill({
            color: selectedSection ? SELECTED_BORDER : 0x343941,
            alpha: selectedSection ? 1 : 0.9,
          });
          const title = new Text({
            text: compactLabel(section.label, 20),
            style: {
              fill: TEXT_PRIMARY,
              fontFamily: "Inter",
              fontSize: 48,
              fontWeight: "600",
              letterSpacing: -0.7,
            },
          });
          const path = new Text({
            text:
              section.source === "configured"
                ? "PROJECT-DEFINED REGION"
                : section.source === "mixed"
                  ? "MIXED-POLICY REGION"
                  : "AUTO-ORGANIZED REGION",
            style: {
              fill: selectedSection ? 0x8fc3ff : TEXT_FAINT,
              fontFamily: "JetBrains Mono",
              fontSize: 19,
              fontWeight: "500",
            },
          });
          const meta = new Text({
            text: `${section.routeCount} routes · ${section.groupIds.length} areas · ${section.screenCount} screens`,
            style: {
              fill: TEXT_MUTED,
              fontFamily: "JetBrains Mono",
              fontSize: 18,
              fontWeight: "500",
              letterSpacing: 0.3,
            },
          });
          meta.anchor.set(1, 0);
          const headerLayout = selectRouteMapHeaderLayout({
            kind: "section",
            width: section.width,
            titleWidth: title.width,
            metaWidth: meta.width,
            secondaryLeadingWidth: path.width,
          });
          title.position.set(headerLayout.title.x, headerLayout.title.y);
          path.position.set(
            headerLayout.secondaryLeading.x,
            headerLayout.secondaryLeading.y,
          );
          meta.position.set(headerLayout.meta.x, headerLayout.meta.y);
          meta.visible = headerLayout.meta.visible;
          sectionLabels.push({
            title,
            path,
            meta,
            metaFits: headerLayout.meta.visible,
          });
          container.addChild(frame, accent, title, path, meta);
          sectionLayer.addChild(container);
          sectionContainers.set(section.id, container);
        }

        for (const group of nextScene.routeMap.groups) {
          const container = new Container();
          container.visible = false;
          container.position.set(group.position.x, group.position.y);
          const selectedGroup = group.screenIds.includes(
            selectedScreenIdRef.current ?? "",
          );
          const frame = new Graphics()
            .roundRect(0, 0, group.width, group.height, 18)
            .fill({ color: 0x0f0f0f, alpha: 0.98 })
            .stroke({
              color: selectedGroup ? 0x334e6d : GROUP_BORDER,
              width: 2,
            });
          const header = new Graphics()
            .roundRect(1, 1, group.width - 2, 106, 17)
            .fill({ color: GROUP_SURFACE })
            .rect(1, 54, group.width - 2, 53)
            .fill({ color: GROUP_SURFACE })
            .moveTo(0, 107)
            .lineTo(group.width, 107)
            .stroke({
              color: selectedGroup ? 0x284b72 : GROUP_BORDER,
              width: 2,
            });
          const title = new Text({
            text: compactLabel(group.label, 12),
            style: {
              fill: TEXT_PRIMARY,
              fontFamily: "Inter",
              fontSize: 52,
              fontWeight: "600",
              letterSpacing: -0.8,
            },
          });
          const path = new Text({
            text: group.routePrefixes.join(" · "),
            style: {
              fill: selectedGroup ? SELECTED_BORDER : TEXT_MUTED,
              fontFamily: "JetBrains Mono",
              fontSize: 24,
              fontWeight: "500",
            },
          });
          const stateSummary = group.stateCount
            ? ` · ${group.stateCount} states`
            : "";
          const dynamicSummary = group.dynamicRouteCount
            ? ` · ${group.dynamicRouteCount} dynamic`
            : "";
          const meta = new Text({
            text: `${group.routeCount} routes · ${group.screenCount} screens${stateSummary}${dynamicSummary}`,
            style: {
              fill: TEXT_MUTED,
              fontFamily: "JetBrains Mono",
              fontSize: 20,
              fontWeight: "500",
              letterSpacing: 0.2,
            },
          });
          meta.anchor.set(1, 0);
          const layoutMode = new Text({
            text:
              group.layoutMode === "hierarchy" ? "ROUTE TREE" : "ROUTE GRID",
            style: {
              fill:
                group.layoutMode === "hierarchy" ? SELECTED_BORDER : TEXT_FAINT,
              fontFamily: "JetBrains Mono",
              fontSize: 14,
              fontWeight: "700",
              letterSpacing: 1.4,
            },
          });
          layoutMode.anchor.set(1, 0);
          const headerLayout = selectRouteMapHeaderLayout({
            kind: "group",
            width: group.width,
            titleWidth: title.width,
            metaWidth: meta.width,
            secondaryLeadingWidth: path.width,
            secondaryTrailingWidth: layoutMode.width,
          });
          title.position.set(headerLayout.title.x, headerLayout.title.y);
          path.position.set(
            headerLayout.secondaryLeading.x,
            headerLayout.secondaryLeading.y,
          );
          meta.position.set(headerLayout.meta.x, headerLayout.meta.y);
          meta.visible = headerLayout.meta.visible;
          const secondaryTrailing = headerLayout.secondaryTrailing;
          layoutMode.position.set(
            secondaryTrailing?.x ?? group.width - 28,
            secondaryTrailing?.y ?? 72,
          );
          layoutMode.visible = secondaryTrailing?.visible ?? false;
          groupLabels.push({
            title,
            path,
            meta,
            layoutMode,
            metaFits: headerLayout.meta.visible,
            layoutModeFits: secondaryTrailing?.visible ?? false,
          });
          container.addChild(frame, header, title, path, meta, layoutMode);
          groupLayer.addChild(container);
          groupContainers.set(group.id, container);
        }

        const routeMapRouteById = new Map(
          nextScene.routeMap.routes.map((route) => [route.id, route]),
        );
        for (const connection of nextScene.routeMap.hierarchyConnections) {
          const container = new Container();
          container.visible = false;
          const parent = routeMapRouteById.get(connection.parentRouteId);
          const child = routeMapRouteById.get(connection.childRouteId);
          const selected = Boolean(
            parent?.screenIds.includes(selectedScreenIdRef.current ?? "") ||
            child?.screenIds.includes(selectedScreenIdRef.current ?? ""),
          );
          const distance = Math.max(
            44,
            (connection.targetPoint.x - connection.sourcePoint.x) * 0.48,
          );
          const path = new Graphics()
            .moveTo(connection.sourcePoint.x, connection.sourcePoint.y)
            .bezierCurveTo(
              connection.sourcePoint.x + distance,
              connection.sourcePoint.y,
              connection.targetPoint.x - distance,
              connection.targetPoint.y,
              connection.targetPoint.x,
              connection.targetPoint.y,
            )
            .stroke({
              alpha: selected ? 0.82 : 0.54,
              color: selected ? SELECTED_BORDER : 0x4a4d55,
              width: selected ? 5 : 3,
            });
          const sourceMarker = new Graphics()
            .circle(connection.sourcePoint.x, connection.sourcePoint.y, 5)
            .fill({
              alpha: selected ? 1 : 0.72,
              color: selected ? SELECTED_BORDER : 0x5b5e66,
            });
          const targetMarker = new Graphics()
            .circle(connection.targetPoint.x, connection.targetPoint.y, 5)
            .fill({
              alpha: selected ? 1 : 0.72,
              color: selected ? SELECTED_BORDER : 0x5b5e66,
            });
          container.addChild(path, sourceMarker, targetMarker);
          hierarchyLayer.addChild(container);
          hierarchyContainers.set(connection.id, container);
        }

        for (const route of nextScene.routeMap.routes) {
          const container = new Container();
          container.visible = false;
          container.position.set(route.position.x, route.position.y);
          container.eventMode = "static";
          container.cursor = "pointer";
          container.on("pointertap", () =>
            onSelectScreenRef.current?.(route.primaryScreenId),
          );
          const selected = route.screenIds.includes(
            selectedScreenIdRef.current ?? "",
          );
          const statusColor = route.renderStatusCounts.blocked
            ? 0xe5484d
            : route.renderStatusCounts.live
              ? 0x3dd68c
              : route.renderStatusCounts.captured
                ? SELECTED_BORDER
                : TEXT_FAINT;
          const halo = new Graphics()
            .roundRect(-7, -7, route.width + 14, route.height + 14, 18)
            .stroke({
              alpha: selected ? 0.22 : 0,
              color: SELECTED_BORDER,
              width: 7,
            });
          const card = new Graphics()
            .roundRect(0, 0, route.width, route.height, 13)
            .fill({ color: 0x151515 })
            .stroke({
              color: selected ? SELECTED_BORDER : ARTBOARD_BORDER,
              width: selected ? 3 : 2,
            });
          const preview = new Graphics()
            .roundRect(12, 12, route.width - 24, 116, 9)
            .fill({ color: ARTBOARD_COLOR })
            .roundRect(28, 30, 132, 10, 3)
            .fill({ color: 0x2a2b30 })
            .roundRect(28, 54, route.width - 94, 8, 3)
            .fill({ color: 0x1d1e23 })
            .roundRect(28, 75, route.width - 150, 8, 3)
            .fill({ color: 0x191a1f })
            .roundRect(28, 98, 82, 17, 4)
            .fill({ color: route.dynamic ? 0x102b49 : 0x202126 });
          const imageLayer = new Container();
          imageLayer.position.set(12, 12);
          textureTargets.set(`map:${route.id}`, {
            layer: imageLayer,
            width: route.width - 24,
            height: 116,
            radius: 9,
            alpha: selected ? 0.92 : 0.72,
          });
          const previewShade = new Graphics()
            .roundRect(12, 12, route.width - 24, 116, 9)
            .fill({ color: 0x050608, alpha: selected ? 0.08 : 0.22 });
          const statusDot = new Graphics()
            .circle(route.width - 29, 31, 7)
            .fill({ color: statusColor });
          const stateChip = new Graphics()
            .roundRect(route.width - 88, 91, 60, 24, 7)
            .fill({ color: route.states.length > 1 ? 0x1c3048 : 0x202126 });
          const stateCount = new Text({
            text: `${route.states.length} state${route.states.length === 1 ? "" : "s"}`,
            style: {
              fill: route.states.length > 1 ? 0x9cc8ff : TEXT_MUTED,
              fontFamily: "JetBrains Mono",
              fontSize: 11,
              fontWeight: "600",
            },
          });
          stateCount.anchor.set(0.5);
          stateCount.position.set(route.width - 58, 103);
          const title = new Text({
            text: compactLabel(route.label, 12),
            style: {
              fill: TEXT_PRIMARY,
              fontFamily: "Inter",
              fontSize: 34,
              fontWeight: "600",
              letterSpacing: -0.3,
            },
          });
          title.position.set(20, 142);
          const routePath = new Text({
            text: compactPath(route.routePath, 31),
            style: {
              fill: route.dynamic ? 0x7eb8ff : TEXT_MUTED,
              fontFamily: "JetBrains Mono",
              fontSize: 20,
              fontWeight: "500",
            },
          });
          routePath.position.set(20, 199);
          const meta = new Text({
            text: route.dynamic ? "DYNAMIC" : "ROUTE",
            style: {
              fill: route.dynamic ? SELECTED_BORDER : TEXT_FAINT,
              fontFamily: "JetBrains Mono",
              fontSize: 12,
              fontWeight: "700",
              letterSpacing: 1.2,
            },
          });
          meta.anchor.set(1, 0);
          meta.position.set(route.width - 20, 196);
          routeLabels.push({ title, path: routePath, meta });
          container.addChild(
            halo,
            card,
            preview,
            imageLayer,
            previewShade,
            statusDot,
            stateChip,
            stateCount,
            title,
            routePath,
            meta,
          );
          routeLayer.addChild(container);
          routeContainers.set(route.id, container);
        }

        for (const connection of nextScene.connections) {
          const container = new Container();
          container.visible = false;
          const selectedConnection =
            connection.source === selectedScreenIdRef.current ||
            connection.target === selectedScreenIdRef.current;
          const connectionColor =
            connection.kind === "navigation"
              ? SELECTED_BORDER
              : connection.kind === "hierarchy"
                ? 0x9b7bff
                : CONNECTION_COLOR;
          const distance = Math.max(
            120,
            Math.abs(connection.targetPoint.x - connection.sourcePoint.x) *
              0.42,
          );
          const glow = new Graphics();
          if (selectedConnection) {
            glow
              .moveTo(connection.sourcePoint.x, connection.sourcePoint.y)
              .bezierCurveTo(
                connection.sourcePoint.x + distance,
                connection.sourcePoint.y,
                connection.targetPoint.x - distance,
                connection.targetPoint.y,
                connection.targetPoint.x,
                connection.targetPoint.y,
              )
              .stroke({
                alpha: 0.075,
                color: connectionColor,
                width: connection.kind === "navigation" ? 7 : 5,
              });
          }
          const path = new Graphics();
          path
            .moveTo(connection.sourcePoint.x, connection.sourcePoint.y)
            .bezierCurveTo(
              connection.sourcePoint.x + distance,
              connection.sourcePoint.y,
              connection.targetPoint.x - distance,
              connection.targetPoint.y,
              connection.targetPoint.x,
              connection.targetPoint.y,
            )
            .stroke({
              alpha: selectedConnection
                ? 0.36 + connection.confidence * 0.24
                : 0.035 + connection.confidence * 0.085,
              color: selectedConnection ? connectionColor : CONNECTION_COLOR,
              width: selectedConnection
                ? connection.kind === "navigation"
                  ? 3
                  : 2
                : connection.kind === "navigation"
                  ? 3
                  : 2,
            });
          const targetMarker = new Graphics()
            .circle(
              connection.targetPoint.x,
              connection.targetPoint.y,
              selectedConnection ? 5 : 3,
            )
            .fill({
              alpha: selectedConnection ? 0.86 : 0.18,
              color: selectedConnection ? connectionColor : CONNECTION_COLOR,
            });
          container.addChild(glow, path, targetMarker);
          connectionLayer.addChild(container);
          connectionContainers.set(connection.id, container);
        }

        const snapshotByScreen = new Map(
          nextSnapshots.map((snapshot) => [snapshot.screenId, snapshot]),
        );
        for (const screen of nextScene.layout.screens) {
          const container = new Container();
          container.visible = false;
          container.position.set(screen.position.x, screen.position.y);
          container.eventMode = "static";
          container.cursor = "pointer";
          container.on("pointertap", () =>
            onSelectScreenRef.current?.(screen.id),
          );
          const selected = screen.id === selectedScreenIdRef.current;
          const selectionHalo = new Graphics()
            .roundRect(-10, -10, screen.width + 20, screen.height + 20, 16)
            .stroke({
              alpha: selected ? 0.22 : 0,
              color: SELECTED_BORDER,
              width: 10,
            });
          const background = new Graphics()
            .roundRect(0, 0, screen.width, screen.height, 8)
            .fill({ color: ARTBOARD_COLOR });
          const placeholder = new Graphics()
            .roundRect(28, 28, screen.width - 56, 54, 7)
            .fill({ color: 0x14151a })
            .roundRect(28, 112, screen.width * 0.64, 28, 5)
            .fill({ color: 0x17181e })
            .roundRect(28, 158, screen.width * 0.44, 18, 4)
            .fill({ color: 0x121318 })
            .roundRect(28, screen.height - 186, screen.width - 56, 144, 8)
            .fill({ color: 0x111218 });
          const imageLayer = new Container();
          const routeLabelSurface = new Graphics()
            .roundRect(18, 18, screen.width - 36, 132, 10)
            .fill({ color: 0x090b0f, alpha: 0.9 });
          const statusColor =
            screen.renderStatus === "live"
              ? 0x3dd68c
              : screen.renderStatus === "captured"
                ? SELECTED_BORDER
                : TEXT_FAINT;
          const routeLabelDot = new Graphics()
            .circle(46, 61, 10)
            .fill({ color: statusColor });
          const routeTitle = new Text({
            text: isDynamicRoutePath(screen.routePath)
              ? (screen.routePath.split("/").filter(Boolean).at(-1) ??
                screen.title)
              : screen.title,
            style: {
              fill: TEXT_PRIMARY,
              fontFamily: "Inter",
              fontSize: 70,
              fontWeight: "600",
            },
          });
          routeTitle.position.set(70, 28);
          const routeMeta = new Text({
            text: `${screen.routePath} · ${screen.state}`,
            style: {
              fill: screen.routePath.includes("[")
                ? SELECTED_BORDER
                : TEXT_MUTED,
              fontFamily: "JetBrains Mono",
              fontSize: 38,
              fontWeight: "500",
            },
          });
          routeMeta.position.set(70, 96);
          const border = new Graphics()
            .roundRect(0, 0, screen.width, screen.height, 8)
            .stroke({
              color: selected ? SELECTED_BORDER : ARTBOARD_BORDER,
              width: selected ? 2 : 1.5,
            });
          container.addChild(
            selectionHalo,
            background,
            placeholder,
            imageLayer,
            routeLabelSurface,
            routeLabelDot,
            routeTitle,
            routeMeta,
            border,
          );
          screenLayer.addChild(container);
          screenContainers.set(screen.id, container);
          textureTargets.set(`screen:${screen.id}`, {
            layer: imageLayer,
            width: screen.width,
            height: screen.height,
            radius: 8,
            alpha: 1,
          });
          screenLabels.push({
            title: routeTitle,
            meta: routeMeta,
            surface: routeLabelSurface,
            dot: routeLabelDot,
          });

          const snapshot = snapshotByScreen.get(screen.id);
          if (snapshot?.imageUrl) {
            targetTextureKeys.set(
              `screen:${screen.id}`,
              studioSnapshotTextureKey(snapshot),
            );
          }
        }

        const selectedSnapshot = selectedScreenIdRef.current
          ? snapshotByScreen.get(selectedScreenIdRef.current)
          : undefined;
        if (!selectedSnapshot?.imageUrl) {
          reportSelectedState(selectedSnapshot, "unavailable");
        } else {
          const key = studioSnapshotTextureKey(selectedSnapshot);
          reportSelectedState(
            selectedSnapshot,
            studioSnapshotTextureCache.has(key)
              ? "ready"
              : failedTextureKeys.has(key)
                ? "error"
                : "loading",
          );
        }

        host.dataset.screenCount = String(nextScene.layout.screens.length);
        host.dataset.routeCount = String(nextScene.routeMap.routes.length);
        host.dataset.sectionCount = String(nextScene.routeMap.sections.length);
        host.dataset.groupCount = String(nextScene.routeMap.groups.length);
        host.dataset.connectionCount = String(nextScene.connections.length);
        host.dataset.selectedScreenId = selectedScreenIdRef.current ?? "none";
        reportStudioTextureCache(host, attachedTextureKeys.size);
        redraw();
      };
      renderSceneRef.current = renderScene;

      mounted.observeResize(redraw);
      renderScene(sceneRef.current, snapshotsRef.current);
    })().catch((error: unknown) => {
      if (disposed) return;
      pixiHost?.destroy();
      pixiHost = undefined;
      host.dataset.rendererError =
        error instanceof Error
          ? error.message
          : "Pixi Atlas renderer failed to initialize";
      onSnapshotStateChangeRef.current?.(
        snapshotsRef.current.find(
          (snapshot) => snapshot.screenId === selectedScreenIdRef.current,
        )?.id,
        "error",
      );
      console.error("Topo Pixi Atlas failed to initialize", error);
    });

    return () => {
      disposed = true;
      redrawRef.current = null;
      renderSceneRef.current = null;
      studioSnapshotTextureCache.retain([]);
      pixiHost?.destroy();
      pixiHost = undefined;
    };
  }, []);

  useEffect(() => {
    redrawRef.current?.();
  }, [camera, mode]);

  useEffect(() => {
    renderSceneRef.current?.(scene, snapshots);
  }, [scene, selectedScreenId, snapshots]);

  return (
    <div className="atlas-pixi-host" data-view-mode={mode} ref={hostRef} />
  );
}
