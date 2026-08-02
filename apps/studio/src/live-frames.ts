import {
  selectLiveFrames,
  type PromotedLiveFrame,
} from "@topo/live-frame-host";
import type { AtlasScene } from "@topo/layout";
import type { ApplicationGraph, ScreenNode } from "@topo/schema";

export interface CreateAtlasLiveFramesOptions {
  baseUrl: string;
  connected: boolean;
  graph: ApplicationGraph;
  hoveredScreenId?: string;
  maxFrames: number;
  promoteOnHover: boolean;
  scene: AtlasScene;
  selectedScreenId?: string;
}

/** Lightweight browser projection of the canonical schema helper. */
export function studioScreenPreviewPath(
  screen: Pick<ScreenNode, "routePath" | "previewRoute">,
): string | undefined {
  if (screen.previewRoute?.status === "unresolved") return undefined;
  return screen.previewRoute?.path ?? screen.routePath;
}

export function createAtlasLiveFrames(
  options: CreateAtlasLiveFramesOptions,
): PromotedLiveFrame[] {
  if (!options.connected) return [];
  const screensById = new Map(
    options.graph.screens.map((screen) => [screen.id, screen]),
  );
  return selectLiveFrames(
    options.baseUrl,
    options.scene.layout.screens.flatMap((positioned) => {
      const screen = screensById.get(positioned.id);
      const previewPath = screen ? studioScreenPreviewPath(screen) : undefined;
      return screen && previewPath
        ? [
            {
              id: screen.id,
              title: screen.title,
              routePath: screen.routePath,
              previewPath,
              position: positioned.position,
              width: positioned.width,
              height: positioned.height,
              selected: screen.id === options.selectedScreenId,
              hovered:
                options.promoteOnHover && screen.id === options.hoveredScreenId,
              live: screen.renderStatus === "live",
            },
          ]
        : [];
    }),
    { maxFrames: options.maxFrames },
  );
}
