export interface LiveFrameDescriptor {
  src: string;
  title: string;
  /** Canonical framework route identity. */
  routePath: string;
  /** Concrete local path loaded into the frame. */
  previewPath: string;
  sandbox: string;
}

export interface LiveFrameCandidate {
  id: string;
  title: string;
  routePath: string;
  previewPath?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  selected?: boolean;
  hovered?: boolean;
  live?: boolean;
}

export interface PromotedLiveFrame extends LiveFrameDescriptor {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  reason: "selected" | "hover" | "live";
  interactive: boolean;
}

export interface SelectLiveFramesOptions {
  maxFrames?: number;
}

/**
 * Resolve a route while preserving the opaque one-time gateway capability.
 * Other base query parameters are intentionally not copied into application
 * routes.
 */
export function createPreviewRouteUrl(
  baseUrl: string,
  routePath: string,
): string {
  const base = new URL(baseUrl);
  const url = new URL(routePath, base);
  const session = base.searchParams.get("topo_session");
  if (session) url.searchParams.set("topo_session", session);
  return url.toString();
}

export function createLiveFrame(
  baseUrl: string,
  routePath: string,
  title: string,
  previewPath = routePath,
): LiveFrameDescriptor {
  return {
    src: createPreviewRouteUrl(baseUrl, previewPath),
    title: `${title} live preview`,
    routePath,
    previewPath,
    sandbox:
      "allow-forms allow-modals allow-popups allow-same-origin allow-scripts",
  };
}

function promotionReason(
  candidate: LiveFrameCandidate,
): PromotedLiveFrame["reason"] | undefined {
  if (candidate.selected) return "selected";
  if (candidate.hovered) return "hover";
  if (candidate.live) return "live";
  return undefined;
}

function distanceFromSelected(
  candidate: LiveFrameCandidate,
  selected: LiveFrameCandidate | undefined,
): number {
  if (!selected) return 0;
  const candidateX = candidate.position.x + candidate.width / 2;
  const candidateY = candidate.position.y + candidate.height / 2;
  const selectedX = selected.position.x + selected.width / 2;
  const selectedY = selected.position.y + selected.height / 2;
  return Math.hypot(candidateX - selectedX, candidateY - selectedY);
}

/**
 * Bound DOM promotion independently from rendering. The selected screen is
 * always first, an intentional hover is next, then already-live neighbors are
 * ordered by world-space locality and stable identity.
 */
export function selectLiveFrames(
  baseUrl: string,
  candidates: readonly LiveFrameCandidate[],
  options: SelectLiveFramesOptions = {},
): PromotedLiveFrame[] {
  const maxFrames = Math.max(0, Math.floor(options.maxFrames ?? 4));
  if (maxFrames === 0) return [];
  const selected = candidates.find((candidate) => candidate.selected);
  const rank = { selected: 0, hover: 1, live: 2 } as const;

  return candidates
    .flatMap((candidate) => {
      const reason = promotionReason(candidate);
      return reason ? [{ candidate, reason }] : [];
    })
    .sort(
      (left, right) =>
        rank[left.reason] - rank[right.reason] ||
        distanceFromSelected(left.candidate, selected) -
          distanceFromSelected(right.candidate, selected) ||
        left.candidate.id.localeCompare(right.candidate.id),
    )
    .slice(0, maxFrames)
    .map(({ candidate, reason }) => ({
      ...createLiveFrame(
        baseUrl,
        candidate.routePath,
        candidate.title,
        candidate.previewPath,
      ),
      id: candidate.id,
      position: candidate.position,
      width: candidate.width,
      height: candidate.height,
      reason,
      interactive: reason === "selected" || reason === "hover",
    }));
}
