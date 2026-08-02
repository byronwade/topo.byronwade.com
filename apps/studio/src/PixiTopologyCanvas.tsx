import { useEffect, useMemo, useRef } from "react";

import "pixi.js/unsafe-eval";
import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";

import {
  diffCanvasVisibility,
  selectVisibleCanvasItems,
  type CanvasCamera,
  type CanvasViewportSize,
} from "@topo/canvas-engine";
import type { ComponentScene, FlowScene } from "@topo/layout";
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
import type {
  StudioComponentPreviewArtifact,
  StudioSnapshot,
} from "./studio-model";

const CANVAS_COLOR = 0x0a0a0a;
const PANEL_COLOR = 0x111214;
const PANEL_BORDER = 0x303238;
const GROUP_BORDER = 0x25272c;
const MUTED_TEXT = 0x737986;
const PRIMARY_TEXT = 0xf2f4f7;
const BLUE = 0x2e8bff;
const GREEN = 0x35d89a;
const AMBER = 0xffb000;
const RED = 0xff5b67;
const PURPLE = 0xa979ff;
const DETAIL_ZOOM = 0.72;
const MAX_CONCURRENT_TEXTURE_LOADS = 4;

type TopologyNodeKind = "component" | "route" | "flow-step";
type TopologyTone = "default" | "success" | "warning" | "error" | "accent";

interface TopologyNode {
  id: string;
  entityId: string;
  ownerId?: string;
  kind: TopologyNodeKind;
  title: string;
  subtitle: string;
  detail?: string;
  tone: TopologyTone;
  selected: boolean;
  position: { x: number; y: number };
  width: number;
  height: number;
  image?: {
    key: string;
    url: string;
  };
}

interface TopologyGroup {
  id: string;
  title: string;
  detail: string;
  ownerId?: string;
  tone: TopologyTone;
  position: { x: number; y: number };
  width: number;
  height: number;
}

interface TopologyConnection {
  id: string;
  ownerId?: string;
  label?: string;
  tone: TopologyTone;
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
}

interface TopologyModel {
  kind: "components" | "flows";
  nodes: TopologyNode[];
  groups: TopologyGroup[];
  connections: TopologyConnection[];
  focusOwnerIds: Set<string>;
}

interface PixiTopologyCanvasProps {
  camera: CanvasCamera;
  model: TopologyModel;
  onResize: (size: CanvasViewportSize) => void;
  onSelectNode: (node: TopologyNode) => void;
}

function toneColor(tone: TopologyTone): number {
  if (tone === "success") return GREEN;
  if (tone === "warning") return AMBER;
  if (tone === "error") return RED;
  if (tone === "accent") return PURPLE;
  return PANEL_BORDER;
}

function clearContainer(container: Container): void {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true });
  }
}

function drawArrow(
  graphics: Graphics,
  source: { x: number; y: number },
  target: { x: number; y: number },
  color: number,
): void {
  const direction = target.x >= source.x ? 1 : -1;
  graphics
    .moveTo(target.x, target.y)
    .lineTo(target.x - 7 * direction, target.y - 4)
    .lineTo(target.x - 7 * direction, target.y + 4)
    .closePath()
    .fill({ color, alpha: 0.82 });
}

function drawFlowPreview(
  container: Container,
  node: TopologyNode,
  borderColor: number,
  imageLayer: Container,
): void {
  const background = new Graphics()
    .roundRect(0, 0, node.width, node.height, 6)
    .fill({ color: PANEL_COLOR });
  const skeleton = new Graphics()
    .roundRect(9, 9, 7, 7, 2)
    .fill({ color: 0x4e5360 })
    .roundRect(21, 10, 29, 5, 2)
    .fill({ color: 0x343843 })
    .roundRect(10, 30, 53, 5, 2)
    .fill({ color: 0x434854 })
    .roundRect(10, 43, node.width - 20, 5, 2)
    .fill({ color: 0x343843 })
    .roundRect(10, 56, node.width - 34, 5, 2)
    .fill({ color: 0x343843 })
    .roundRect(10, 73, 44, 12, 3)
    .fill({ color: 0x383d48 });
  const route = new Text({
    text: node.subtitle,
    style: {
      fill: node.tone === "error" ? RED : MUTED_TEXT,
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 10,
      fontWeight: node.tone === "error" ? "600" : "400",
    },
  });
  route.position.set(0, node.height + 10);
  const border = new Graphics()
    .roundRect(0, 0, node.width, node.height, 6)
    .stroke({ color: borderColor, width: node.selected ? 2 : 1 });
  container.addChild(background, skeleton, imageLayer, border, route);
}

function drawInfoCard(
  container: Container,
  node: TopologyNode,
  borderColor: number,
  imageLayer: Container,
): void {
  const background = new Graphics()
    .roundRect(0, 0, node.width, node.height, 7)
    .fill({ color: PANEL_COLOR });
  const accent = new Graphics()
    .circle(17, 19, 3.5)
    .fill({ color: toneColor(node.tone) });
  const title = new Text({
    text: node.title,
    style: {
      fill: PRIMARY_TEXT,
      fontFamily: "Inter, sans-serif",
      fontSize: node.kind === "route" ? 11 : 12,
      fontWeight: "600",
    },
  });
  title.position.set(29, 10);
  const subtitle = new Text({
    text: node.subtitle,
    style: {
      fill: node.tone === "error" ? RED : MUTED_TEXT,
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 9,
    },
  });
  subtitle.position.set(
    14,
    node.kind === "route" ? 36 : node.image ? node.height - 16 : 43,
  );
  if (node.image) {
    const previewPlaceholder = new Graphics()
      .roundRect(10, 34, node.width - 20, node.height - 54, 5)
      .fill({ color: 0x0b0d12 });
    const titlePlate = new Graphics()
      .roundRect(8, 7, Math.min(node.width - 16, title.width + 36), 24, 5)
      .fill({ color: 0x0c0e13, alpha: 0.9 });
    const footerPlate = new Graphics()
      .rect(8, node.height - 22, node.width - 16, 18)
      .fill({ color: 0x0c0e13, alpha: 0.82 });
    container.addChild(
      background,
      previewPlaceholder,
      imageLayer,
      titlePlate,
      footerPlate,
      accent,
      title,
      subtitle,
    );
  } else {
    container.addChild(background, accent, title, subtitle);
  }
  if (node.detail && node.kind !== "route" && !node.image) {
    const detail = new Text({
      text: node.detail,
      style: {
        fill: 0x8c929f,
        fontFamily: "Inter, sans-serif",
        fontSize: 9,
      },
    });
    detail.position.set(14, 64);
    container.addChild(detail);
  }
  const border = new Graphics()
    .roundRect(0, 0, node.width, node.height, 7)
    .stroke({ color: borderColor, width: node.selected ? 2 : 1 });
  container.addChild(border);
}

function PixiTopologyCanvas({
  camera,
  model,
  onResize,
  onSelectNode,
}: PixiTopologyCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  const modelRef = useRef(model);
  const onResizeRef = useRef(onResize);
  const onSelectNodeRef = useRef(onSelectNode);
  const redrawRef = useRef<(() => void) | null>(null);
  const renderModelRef = useRef<((next: TopologyModel) => void) | null>(null);

  cameraRef.current = camera;
  modelRef.current = model;
  onResizeRef.current = onResize;
  onSelectNodeRef.current = onSelectNode;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let pixiHost: PixiCanvasHost | undefined;

    void (async () => {
      const mounted = await createPixiCanvasHost(host, {
        background: CANVAS_COLOR,
        renderer: "pixi-topology",
      });
      if (disposed) {
        mounted.destroy();
        return;
      }
      pixiHost = mounted;
      const { app } = mounted;
      const grid = new Graphics();
      const world = new Container();
      const groupLayer = new Container();
      const connectionLayer = new Container();
      const nodeLayer = new Container();
      world.addChild(groupLayer, connectionLayer, nodeLayer);
      app.stage.addChild(grid, world);
      const groupContainers = new Map<string, Container>();
      const nodeContainers = new Map<string, Container>();
      const connectionContainers = new Map<string, Container>();
      const nodeImageLayers = new Map<string, Container>();
      const nodeImageKeys = new Map<string, string>();
      let visibleGroupIds = new Set<string>();
      let visibleNodeIds = new Set<string>();
      let visibleConnectionIds = new Set<string>();
      const attachedTextureKeys = new Map<string, string>();
      let activeTextureKeys = new Set<string>();
      const failedTextureKeys = new Set<string>();
      const pendingTextureLoads = new Map<string, Promise<Texture>>();

      const attachTexture = (nodeId: string, key: string, texture: Texture) => {
        if (nodeImageKeys.get(nodeId) !== key) return;
        const imageLayer = nodeImageLayers.get(nodeId);
        const node = modelRef.current.nodes.find((item) => item.id === nodeId);
        if (!imageLayer || !node) return;
        clearContainer(imageLayer);

        const frame =
          node.kind === "flow-step"
            ? { x: 0, y: 0, width: node.width, height: node.height, radius: 6 }
            : {
                x: 10,
                y: 34,
                width: node.width - 20,
                height: node.height - 54,
                radius: 5,
              };
        const sourceWidth = Math.max(1, texture.width);
        const sourceHeight = Math.max(1, texture.height);
        const scale = Math.max(
          frame.width / sourceWidth,
          frame.height / sourceHeight,
        );
        const sprite = new Sprite(texture);
        sprite.width = sourceWidth * scale;
        sprite.height = sourceHeight * scale;
        sprite.position.set(
          frame.x + (frame.width - sprite.width) / 2,
          frame.y + (frame.height - sprite.height) / 2,
        );
        const mask = new Graphics()
          .roundRect(frame.x, frame.y, frame.width, frame.height, frame.radius)
          .fill({ color: 0xffffff });
        sprite.mask = mask;
        imageLayer.addChild(sprite, mask);
        attachedTextureKeys.set(nodeId, key);
        reportStudioTextureCache(host, attachedTextureKeys.size);
      };

      const hydrateVisibleTextures = () => {
        const availableSlots =
          MAX_CONCURRENT_TEXTURE_LOADS - pendingTextureLoads.size;
        if (availableSlots <= 0) return;
        const currentModel = modelRef.current;
        const candidates = prioritizeVisibleTextureCandidates(
          currentModel.nodes
            .filter((node) => {
              const image = node.image;
              return Boolean(
                image &&
                nodeContainers.get(node.id)?.visible &&
                activeTextureKeys.has(image.key) &&
                !studioSnapshotTextureCache.has(image.key) &&
                !pendingTextureLoads.has(image.key) &&
                !failedTextureKeys.has(image.key),
              );
            })
            .map((node) => ({
              id: node.id,
              x: node.position.x,
              y: node.position.y,
              width: node.width,
              height: node.height,
              selected: node.selected,
              node,
            })),
          cameraRef.current,
          { width: host.clientWidth, height: host.clientHeight },
          availableSlots,
        );

        for (const { node } of candidates) {
          const image = node.image!;
          const request = loadStudioSnapshotTexture(image.key, image.url);
          pendingTextureLoads.set(image.key, request);
          void request
            .then((texture) => {
              if (
                !disposed &&
                activeTextureKeys.has(image.key) &&
                studioSnapshotTextureCache.has(image.key)
              ) {
                attachTexture(node.id, image.key, texture);
              }
            })
            .catch(() => {
              failedTextureKeys.add(image.key);
              host.dataset.textureErrorCount = String(failedTextureKeys.size);
            })
            .finally(() => {
              pendingTextureLoads.delete(image.key);
              if (!disposed) {
                requestAnimationFrame(() => redrawRef.current?.());
              }
            });
        }
      };

      const redraw = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        const current = cameraRef.current;
        const currentModel = modelRef.current;
        drawViewportDotGrid(grid, width, height, current, {
          majorAlpha: 0.62,
          majorColor: 0x343434,
          minorAlpha: 0.5,
          minorColor: 0x282828,
        });
        world.position.set(current.x, current.y);
        world.scale.set(current.zoom);
        const detailMode = current.zoom >= DETAIL_ZOOM;
        const viewport = { width, height };
        const nextGroups = selectVisibleCanvasItems(
          currentModel.groups.map((group) => ({
            id: group.id,
            x: group.position.x,
            y: group.position.y,
            width: group.width,
            height: group.height,
            ownerId: group.ownerId,
          })),
          current,
          viewport,
          { overscan: 120 },
        ).filter(
          (group) =>
            !detailMode ||
            (currentModel.kind === "flows" &&
              Boolean(
                group.ownerId && currentModel.focusOwnerIds.has(group.ownerId),
              )),
        );
        const nextNodes = selectVisibleCanvasItems(
          currentModel.nodes.map((node) => ({
            id: node.id,
            x: node.position.x,
            y: node.position.y,
            width: node.width,
            height: node.height,
            alwaysVisible: node.selected,
            selected: node.selected,
            kind: node.kind,
            ownerId: node.ownerId,
          })),
          current,
          viewport,
          { overscan: 120 },
        ).filter(
          (node) =>
            !detailMode ||
            node.selected ||
            node.kind === "route" ||
            (currentModel.kind === "flows" &&
              Boolean(
                node.ownerId && currentModel.focusOwnerIds.has(node.ownerId),
              )),
        );
        const nextConnections = selectVisibleCanvasItems(
          currentModel.connections.map((connection) => {
            const distance = Math.max(
              24,
              Math.abs(connection.targetPoint.x - connection.sourcePoint.x) *
                0.42,
            );
            return {
              id: connection.id,
              x:
                Math.min(connection.sourcePoint.x, connection.targetPoint.x) -
                distance,
              y: Math.min(connection.sourcePoint.y, connection.targetPoint.y),
              width:
                Math.abs(connection.targetPoint.x - connection.sourcePoint.x) +
                distance * 2,
              height: Math.max(
                1,
                Math.abs(connection.targetPoint.y - connection.sourcePoint.y),
              ),
              ownerId: connection.ownerId,
            };
          }),
          current,
          viewport,
          { overscan: 80 },
        ).filter(
          (connection) =>
            !detailMode ||
            currentModel.kind === "components" ||
            Boolean(
              connection.ownerId &&
              currentModel.focusOwnerIds.has(connection.ownerId),
            ),
        );

        const groupDelta = diffCanvasVisibility(visibleGroupIds, nextGroups);
        for (const id of groupDelta.exited) {
          const container = groupContainers.get(id);
          if (container) container.visible = false;
        }
        for (const id of groupDelta.entered) {
          const container = groupContainers.get(id);
          if (container) container.visible = true;
        }
        visibleGroupIds = groupDelta.visible;

        const nodeDelta = diffCanvasVisibility(visibleNodeIds, nextNodes);
        for (const id of nodeDelta.exited) {
          const container = nodeContainers.get(id);
          if (container) container.visible = false;
        }
        for (const id of nodeDelta.entered) {
          const container = nodeContainers.get(id);
          if (container) container.visible = true;
        }
        visibleNodeIds = nodeDelta.visible;

        const activeCandidates = prioritizeVisibleTextureCandidates(
          currentModel.nodes
            .filter((node) =>
              Boolean(node.image && visibleNodeIds.has(node.id)),
            )
            .map((node) => ({
              id: node.id,
              x: node.position.x,
              y: node.position.y,
              width: node.width,
              height: node.height,
              selected: node.selected,
              alwaysVisible: node.selected,
              key: node.image!.key,
            })),
          current,
          viewport,
          STUDIO_ACTIVE_SNAPSHOT_TEXTURE_LIMIT,
        );
        activeTextureKeys = new Set(
          activeCandidates.map((candidate) => candidate.key),
        );
        studioSnapshotTextureCache.retain(activeTextureKeys);
        for (const [nodeId, key] of attachedTextureKeys) {
          if (activeTextureKeys.has(key)) continue;
          const imageLayer = nodeImageLayers.get(nodeId);
          if (imageLayer) clearContainer(imageLayer);
          attachedTextureKeys.delete(nodeId);
        }
        for (const candidate of activeCandidates) {
          if (attachedTextureKeys.get(candidate.id) === candidate.key) continue;
          const cached = studioSnapshotTextureCache.get(candidate.key);
          if (cached) attachTexture(candidate.id, candidate.key, cached);
        }

        const connectionDelta = diffCanvasVisibility(
          visibleConnectionIds,
          nextConnections,
        );
        for (const id of connectionDelta.exited) {
          const container = connectionContainers.get(id);
          if (container) container.visible = false;
        }
        for (const id of connectionDelta.entered) {
          const container = connectionContainers.get(id);
          if (container) container.visible = true;
        }
        visibleConnectionIds = connectionDelta.visible;

        host.dataset.detailMode = detailMode ? "focus" : "overview";
        host.dataset.nodeCount = String(currentModel.nodes.length);
        host.dataset.visibleNodeCount = String(visibleNodeIds.size);
        host.dataset.culledNodeCount = String(
          Math.max(0, nodeContainers.size - visibleNodeIds.size),
        );
        host.dataset.visibleGroupCount = String(visibleGroupIds.size);
        host.dataset.visibleConnectionCount = String(visibleConnectionIds.size);
        reportStudioTextureCache(host, attachedTextureKeys.size);
        onResizeRef.current({ width, height });
        mounted.render();
        hydrateVisibleTextures();
      };
      redrawRef.current = redraw;

      const renderModel = (next: TopologyModel) => {
        clearContainer(groupLayer);
        clearContainer(connectionLayer);
        clearContainer(nodeLayer);
        groupContainers.clear();
        nodeContainers.clear();
        connectionContainers.clear();
        nodeImageLayers.clear();
        nodeImageKeys.clear();
        attachedTextureKeys.clear();
        visibleGroupIds = new Set();
        visibleNodeIds = new Set();
        visibleConnectionIds = new Set();

        for (const group of next.groups) {
          const container = new Container();
          container.visible = false;
          container.position.set(group.position.x, group.position.y);
          const frame = new Graphics();
          if (next.kind === "components") {
            frame
              .roundRect(0, 0, group.width, group.height, 10)
              .fill({ color: 0x0d0e10, alpha: 0.45 })
              .stroke({ color: GROUP_BORDER, width: 1 });
          }
          const title = new Text({
            text: group.title,
            style: {
              fill: PRIMARY_TEXT,
              fontFamily: "Inter, sans-serif",
              fontSize: 15,
              fontWeight: "600",
            },
          });
          title.position.set(20, 16);
          const detail = new Text({
            text: group.detail,
            style: {
              fill: toneColor(group.tone),
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 9,
              letterSpacing: 0.4,
            },
          });
          detail.position.set(20 + title.width + 12, 21);
          container.addChild(frame, title, detail);
          groupLayer.addChild(container);
          groupContainers.set(group.id, container);
        }

        for (const connection of next.connections) {
          const container = new Container();
          container.visible = false;
          const color =
            connection.tone === "error"
              ? RED
              : connection.tone === "accent"
                ? PURPLE
                : 0x52677f;
          const path = new Graphics();
          const distance = Math.max(
            24,
            Math.abs(connection.targetPoint.x - connection.sourcePoint.x) *
              0.42,
          );
          const direction =
            connection.targetPoint.x >= connection.sourcePoint.x ? 1 : -1;
          path
            .moveTo(connection.sourcePoint.x, connection.sourcePoint.y)
            .bezierCurveTo(
              connection.sourcePoint.x + distance * direction,
              connection.sourcePoint.y,
              connection.targetPoint.x - distance * direction,
              connection.targetPoint.y,
              connection.targetPoint.x,
              connection.targetPoint.y,
            )
            .stroke({
              color,
              alpha: 0.74,
              width: connection.tone === "error" ? 2 : 1.5,
            });
          drawArrow(
            path,
            connection.sourcePoint,
            connection.targetPoint,
            color,
          );
          container.addChild(path);
          if (connection.label) {
            const label = new Text({
              text: connection.label,
              style: {
                fill: connection.tone === "error" ? RED : MUTED_TEXT,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 9,
              },
            });
            label.position.set(
              (connection.sourcePoint.x + connection.targetPoint.x) / 2 -
                label.width / 2,
              (connection.sourcePoint.y + connection.targetPoint.y) / 2 - 15,
            );
            container.addChild(label);
          }
          connectionLayer.addChild(container);
          connectionContainers.set(connection.id, container);
        }

        for (const node of next.nodes) {
          const container = new Container();
          container.visible = false;
          const imageLayer = new Container();
          container.position.set(node.position.x, node.position.y);
          container.eventMode = "static";
          container.cursor = "pointer";
          container.on("pointerdown", (event) => {
            event.stopPropagation();
            if ("stopPropagation" in event.nativeEvent) {
              event.nativeEvent.stopPropagation();
            }
          });
          container.on("pointertap", () => onSelectNodeRef.current(node));
          const borderColor = node.selected
            ? BLUE
            : node.tone === "error"
              ? RED
              : PANEL_BORDER;
          if (node.kind === "flow-step") {
            drawFlowPreview(container, node, borderColor, imageLayer);
          } else {
            drawInfoCard(container, node, borderColor, imageLayer);
          }
          nodeLayer.addChild(container);
          nodeContainers.set(node.id, container);
          nodeImageLayers.set(node.id, imageLayer);
          if (node.image) {
            nodeImageKeys.set(node.id, node.image.key);
          }
        }

        host.dataset.sceneKind = next.kind;
        host.dataset.groupCount = String(next.groups.length);
        host.dataset.connectionCount = String(next.connections.length);
        host.dataset.availableTextureCount = String(
          next.nodes.filter((node) => node.image).length,
        );
        reportStudioTextureCache(host, attachedTextureKeys.size);
        host.dataset.textureErrorCount = String(failedTextureKeys.size);
        redraw();
      };
      renderModelRef.current = renderModel;
      mounted.observeResize(redraw);
      renderModel(modelRef.current);
    })().catch((error: unknown) => {
      if (disposed) return;
      pixiHost?.destroy();
      pixiHost = undefined;
      host.dataset.rendererError =
        error instanceof Error
          ? error.message
          : "Topo topology renderer failed to initialize";
      console.error("Topo Pixi topology canvas failed to initialize", error);
    });

    return () => {
      disposed = true;
      redrawRef.current = null;
      renderModelRef.current = null;
      studioSnapshotTextureCache.retain([]);
      pixiHost?.destroy();
      pixiHost = undefined;
    };
  }, []);

  useEffect(() => redrawRef.current?.(), [camera]);
  useEffect(() => renderModelRef.current?.(model), [model]);

  return <div className="topology-pixi-host" ref={hostRef} />;
}

function componentTone(
  status: ComponentScene["components"][number]["previewStatus"],
): TopologyTone {
  if (status === "renderable") return "success";
  if (status === "missing") return "warning";
  if (status === "blocked") return "error";
  return "default";
}

function componentGroupTone(
  group: ComponentScene["groups"][number],
): TopologyTone {
  if (group.previewStatusCounts.blocked > 0) return "error";
  if (group.previewStatusCounts.missing > 0) return "warning";
  if (group.previewStatusCounts.unknown > 0) return "default";
  return "success";
}

export function PixiComponentCanvas({
  camera,
  onResize,
  onSelectComponent,
  onSelectScreen,
  previewArtifacts,
  scene,
}: {
  camera: CanvasCamera;
  onResize: (size: CanvasViewportSize) => void;
  onSelectComponent: (componentId: string) => void;
  onSelectScreen: (screenId: string) => void;
  previewArtifacts: StudioComponentPreviewArtifact[];
  scene: ComponentScene;
}) {
  const model = useMemo<TopologyModel>(() => {
    const artifactByComponent = new Map<
      string,
      StudioComponentPreviewArtifact
    >();
    for (const artifact of previewArtifacts) {
      if (
        artifact.status === "captured" &&
        artifact.imageUrl &&
        !artifactByComponent.has(artifact.targetId)
      ) {
        artifactByComponent.set(artifact.targetId, artifact);
      }
    }
    return {
      kind: "components",
      focusOwnerIds: new Set(
        scene.selectedComponentId ? [scene.selectedComponentId] : [],
      ),
      groups: scene.groups.map((group) => ({
        id: group.id,
        title: group.label,
        detail: `${group.componentCount} ${group.componentCount === 1 ? "COMPONENT" : "COMPONENTS"} · ${group.previewStatusCounts.missing + group.previewStatusCounts.blocked + group.previewStatusCounts.unknown} GAPS`,
        tone: componentGroupTone(group),
        position: group.position,
        width: group.width,
        height: group.height,
      })),
      nodes: [
        ...scene.components.map((component): TopologyNode => {
          const artifact = artifactByComponent.get(component.id);
          return {
            id: component.id,
            entityId: component.id,
            ownerId: component.id,
            kind: "component",
            title: component.name,
            subtitle: component.source.filePath,
            detail: `${component.usedBy.length} route${component.usedBy.length === 1 ? "" : "s"} · ${component.previewStatus}`,
            tone: componentTone(component.previewStatus),
            selected: component.id === scene.selectedComponentId,
            position: component.position,
            width: component.width,
            height: component.height,
            image:
              artifact?.imageUrl && artifact.status === "captured"
                ? {
                    key: `${artifact.id}:${artifact.contentHash ?? artifact.imageUrl}`,
                    url: artifact.imageUrl,
                  }
                : undefined,
          };
        }),
        ...scene.routeNodes.map((route): TopologyNode => ({
          id: route.id,
          entityId: route.screenId,
          ownerId: scene.selectedComponentId,
          kind: "route",
          title: route.title,
          subtitle: route.routePath ?? route.screenId,
          tone: route.resolution === "resolved" ? "accent" : "error",
          selected: false,
          position: route.position,
          width: route.width,
          height: route.height,
        })),
      ],
      connections: scene.connections.map((connection) => ({
        id: connection.id,
        ownerId: scene.selectedComponentId,
        label: connection.resolution === "resolved" ? "used by" : "unresolved",
        tone: connection.resolution === "resolved" ? "accent" : "error",
        sourcePoint: connection.sourcePoint,
        targetPoint: connection.targetPoint,
      })),
    };
  }, [previewArtifacts, scene]);
  return (
    <PixiTopologyCanvas
      camera={camera}
      model={model}
      onResize={onResize}
      onSelectNode={(node) => {
        if (node.kind === "route") onSelectScreen(node.entityId);
        else onSelectComponent(node.entityId);
      }}
    />
  );
}

export function PixiFlowCanvas({
  camera,
  onResize,
  onSelectStep,
  scene,
  snapshots,
}: {
  camera: CanvasCamera;
  onResize: (size: CanvasViewportSize) => void;
  onSelectStep: (flowId: string, stepId: string) => void;
  scene: FlowScene;
  snapshots: StudioSnapshot[];
}) {
  const model = useMemo<TopologyModel>(() => {
    const snapshotByScreen = new Map(
      snapshots
        .filter(
          (snapshot) =>
            snapshot.status === "captured" && Boolean(snapshot.imageUrl),
        )
        .map((snapshot) => [snapshot.screenId, snapshot]),
    );
    return {
      kind: "flows",
      focusOwnerIds: new Set(scene.focusFlowIds),
      groups: scene.lanes.map((lane) => ({
        id: `flow-lane:${lane.id}`,
        ownerId: lane.id,
        title: lane.title,
        detail: `${lane.stepNodeIds.length} STEPS · ${lane.breakCount ? `${lane.breakCount} BREAK${lane.breakCount === 1 ? "" : "S"}` : "CLEAN"}`,
        tone: lane.breakCount > 0 ? "error" : "default",
        position: lane.position,
        width: lane.width,
        height: lane.height,
      })),
      nodes: scene.steps.map((step): TopologyNode => {
        const snapshot = step.resolvedScreenId
          ? snapshotByScreen.get(step.resolvedScreenId)
          : undefined;
        return {
          id: step.nodeId,
          entityId: step.stepId,
          ownerId: step.flowId,
          kind: "flow-step",
          title: step.title,
          subtitle: `${step.order + 1}  ${step.routePath ?? step.title}`,
          tone:
            step.resolution === "unresolved"
              ? "error"
              : step.resolution === "unbound"
                ? "warning"
                : "default",
          selected: step.nodeId === scene.selectedStepNodeId,
          position: step.position,
          width: step.width,
          height: step.height,
          image:
            snapshot?.imageUrl && snapshot.status === "captured"
              ? {
                  key: `${snapshot.id}:${snapshot.contentHash ?? snapshot.imageUrl}`,
                  url: snapshot.imageUrl,
                }
              : undefined,
        };
      }),
      connections: scene.connections.map((connection) => ({
        id: connection.id,
        ownerId: connection.flowId,
        label: connection.action ?? "next",
        tone: connection.status === "broken" ? "error" : "default",
        sourcePoint: connection.sourcePoint,
        targetPoint: connection.targetPoint,
      })),
    };
  }, [scene, snapshots]);
  return (
    <PixiTopologyCanvas
      camera={camera}
      model={model}
      onResize={onResize}
      onSelectNode={(node) => onSelectStep(node.ownerId ?? "", node.entityId)}
    />
  );
}
