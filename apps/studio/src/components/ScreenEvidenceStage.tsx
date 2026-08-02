import { lazy, Suspense, useEffect, type ReactNode, type Ref } from "react";

import { ChevronRight, FileCode2, Maximize2, Minus, Plus } from "lucide-react";

import { createLiveFrame } from "@topo/live-frame-host";
import { useCanvasCamera, type CanvasInteractionMode } from "@topo/react";

import { studioScreenPreviewPath } from "../live-frames";
import type { ScreenEvidence } from "../screen-evidence";

const PixiEditorCanvas = lazy(async () => {
  const module = await import("../PixiEditorCanvas");
  return { default: module.PixiEditorCanvas };
});

const EVIDENCE_ARTBOARD = { x: 0, y: 0, width: 780, height: 706 } as const;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;

export interface ScreenEvidenceStageProps {
  ariaLabel?: string;
  artboardOverlay?: ReactNode;
  className?: string;
  connected: boolean;
  contextLabel?: string;
  evidence: Pick<ScreenEvidence, "screen" | "snapshot">;
  interactionMode: CanvasInteractionMode;
  liveFrameRef?: Ref<HTMLIFrameElement>;
  overlay?: ReactNode;
  previewBaseUrl: string;
  toolbarActions?: ReactNode;
}

/**
 * Shared hybrid viewport for one canonical screen. It owns camera behavior,
 * GPU grid rendering, and bounded live/snapshot promotion so destinations do
 * not create competing visual interpretations of the same evidence.
 */
export function ScreenEvidenceStage({
  ariaLabel = "Topo screen evidence canvas. Use Pan to drag, scroll to zoom, and press 0 to fit.",
  artboardOverlay,
  className,
  connected,
  contextLabel,
  evidence,
  interactionMode,
  liveFrameRef,
  overlay,
  previewBaseUrl,
  toolbarActions,
}: ScreenEvidenceStageProps) {
  const screen = evidence.screen;
  const snapshot = evidence.snapshot;
  const previewPath = screen ? studioScreenPreviewPath(screen) : undefined;
  const liveFrame =
    connected && screen && previewPath
      ? createLiveFrame(
          previewBaseUrl,
          screen.routePath,
          screen.title,
          previewPath,
        )
      : undefined;
  const {
    camera,
    fit: fitArtboard,
    isPanning,
    onViewportResize,
    viewportBindings,
    zoomBy,
  } = useCanvasCamera({
    bounds: EVIDENCE_ARTBOARD,
    fitMaxZoom: 1,
    initialCamera: { x: 74, y: 36, zoom: 1 },
    initialViewport: { width: 928, height: 778 },
    interactionMode,
    maxZoom: MAX_ZOOM,
    minZoom: MIN_ZOOM,
    padding: 24,
    pointerIgnoreSelector: "[data-canvas-interactive]",
  });

  useEffect(() => {
    fitArtboard();
  }, [fitArtboard, screen?.id]);

  const previewKind = liveFrame
    ? "live"
    : snapshot?.imageUrl
      ? "snapshot"
      : "empty";
  const evidenceDetail =
    snapshot?.width && snapshot.height
      ? `${snapshot.width} × ${snapshot.height}`
      : (screen?.renderStatus ?? "unseen");
  const missingEvidenceDetail =
    screen?.previewRoute?.status === "unresolved"
      ? screen.previewRoute.reason
      : (screen?.source.filePath ?? "Scan a project to discover screens.");

  return (
    <section
      className={`editor-canvas-panel screen-evidence-panel${className ? ` ${className}` : ""}`}
    >
      <div className="editor-canvas-toolbar">
        <div>
          {contextLabel ?? screen?.routePath ?? "No route"}
          {!contextLabel && (
            <>
              <ChevronRight size={11} />
              <strong>{screen?.title ?? "No screen"}</strong>
            </>
          )}
          <span>{evidenceDetail}</span>
        </div>
        <div className="editor-canvas-toolbar-end">
          {toolbarActions}
          <div className="editor-zoom-controls">
            <button
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / 1.2)}
              type="button"
            >
              <Minus size={13} />
            </button>
            <button
              aria-label="Fit artboard"
              onClick={() => fitArtboard()}
              type="button"
            >
              {Math.round(camera.zoom * 100)}%
            </button>
            <button
              aria-label="Zoom in"
              onClick={() => zoomBy(1.2)}
              type="button"
            >
              <Plus size={13} />
            </button>
            <button
              aria-label="Fit artboard to viewport"
              onClick={() => fitArtboard()}
              type="button"
            >
              <Maximize2 size={13} />
            </button>
          </div>
        </div>
      </div>
      <div
        aria-label={ariaLabel}
        className={`editor-stage mode-${interactionMode}${isPanning ? " is-panning" : ""}`}
        data-camera-x={Math.round(camera.x * 100) / 100}
        data-camera-y={Math.round(camera.y * 100) / 100}
        data-camera-zoom={Math.round(camera.zoom * 1000) / 1000}
        data-preview-kind={previewKind}
        data-preview-path={previewPath}
        data-renderer="pixi-hybrid"
        data-screen-id={screen?.id}
        data-snapshot-id={snapshot?.id}
        {...viewportBindings}
        role="application"
        tabIndex={0}
      >
        <Suspense
          fallback={<div className="editor-pixi-fallback" aria-hidden="true" />}
        >
          <PixiEditorCanvas camera={camera} onResize={onViewportResize} />
        </Suspense>
        <div
          className="editor-world"
          style={{
            transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
          }}
        >
          <span className="artboard-label">
            {previewKind === "live"
              ? "●"
              : previewKind === "snapshot"
                ? "▦"
                : "○"}{" "}
            {screen?.routePath ?? "No screen"}
          </span>
          <div
            aria-label={
              screen
                ? `${screen.title} ${previewKind} evidence`
                : "No screen evidence"
            }
            className="editor-artboard"
            data-canvas-interactive={liveFrame ? "true" : undefined}
          >
            {liveFrame ? (
              <iframe
                className="editor-screen-preview"
                ref={liveFrameRef}
                sandbox={liveFrame.sandbox}
                src={liveFrame.src}
                title={liveFrame.title}
              />
            ) : snapshot?.imageUrl ? (
              <img
                alt={`Captured preview of ${screen?.title ?? snapshot.routePath}`}
                className="editor-screen-preview"
                src={snapshot.imageUrl}
              />
            ) : (
              <div className="editor-evidence-empty">
                <FileCode2 size={24} />
                <strong>
                  {screen?.previewRoute?.status === "unresolved"
                    ? "Preview route example required"
                    : "No visual evidence captured"}
                </strong>
                <span>{missingEvidenceDetail}</span>
              </div>
            )}
            {artboardOverlay}
            <span className={`editor-evidence-badge is-${previewKind}`}>
              {previewKind === "live"
                ? "● LIVE"
                : previewKind === "snapshot"
                  ? "● SNAPSHOT"
                  : "○ UNSEEN"}
            </span>
          </div>
        </div>
        {overlay}
      </div>
    </section>
  );
}
