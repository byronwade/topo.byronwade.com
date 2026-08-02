import type { CanvasCamera, CanvasViewportSize } from "@topo/canvas-engine";
import type { AtlasScene } from "@topo/layout";
import { prioritizeVisibleTextureCandidates } from "@topo/renderer-pixi";

import type { StudioSnapshot } from "./studio-model";

export interface RouteMapTextureCandidate {
  id: string;
  routeId: string;
  screenId: string;
  snapshotId: string;
  textureKey: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
}

export interface RouteMapTextureSelectionOptions {
  camera: CanvasCamera;
  limit: number;
  scene: AtlasScene;
  snapshots: readonly StudioSnapshot[];
  viewport: CanvasViewportSize;
}

export function studioSnapshotTextureKey(snapshot: StudioSnapshot): string {
  return `${snapshot.id}:${snapshot.contentHash ?? snapshot.imageUrl ?? "none"}`;
}

/**
 * Select bounded route thumbnails from the same primary-screen identities used
 * by the route read model. This keeps map imagery deterministic and prevents a
 * renderer from guessing which state represents a route family.
 */
export function selectRouteMapTextureCandidates({
  camera,
  limit,
  scene,
  snapshots,
  viewport,
}: RouteMapTextureSelectionOptions): RouteMapTextureCandidate[] {
  const snapshotByScreenId = new Map(
    snapshots
      .filter(
        (snapshot): snapshot is StudioSnapshot & { imageUrl: string } =>
          snapshot.status === "captured" && Boolean(snapshot.imageUrl),
      )
      .map((snapshot) => [snapshot.screenId, snapshot]),
  );

  return prioritizeVisibleTextureCandidates(
    scene.routeMap.routes.flatMap((route) => {
      const snapshot = snapshotByScreenId.get(route.primaryScreenId);
      if (!snapshot) return [];
      return [
        {
          id: route.id,
          routeId: route.id,
          screenId: route.primaryScreenId,
          snapshotId: snapshot.id,
          textureKey: studioSnapshotTextureKey(snapshot),
          imageUrl: snapshot.imageUrl,
          x: route.position.x,
          y: route.position.y,
          width: route.width,
          height: route.height,
          selected: route.screenIds.includes(scene.selectedScreenId ?? ""),
        },
      ];
    }),
    camera,
    viewport,
    limit,
  );
}
