import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import {
  fitCanvasBounds,
  panCanvasBy,
  zoomCanvasAt,
  type CanvasBounds,
  type CanvasCamera,
  type FitCanvasOptions,
  type CanvasPoint,
  type CanvasViewportSize,
} from "@topo/canvas-engine";
import type { ApplicationGraph } from "@topo/schema";

export function useGraphSelection(
  graph: ApplicationGraph,
  selectedId?: string,
) {
  return useMemo(
    () =>
      graph.screens.find((screen) => screen.id === selectedId) ??
      graph.screens[0],
    [graph, selectedId],
  );
}

export interface CanvasCameraOptions {
  alignX?: FitCanvasOptions["alignX"];
  alignY?: FitCanvasOptions["alignY"];
  bounds: CanvasBounds;
  fitMaxZoom?: number;
  initialCamera?: CanvasCamera;
  initialViewport?: CanvasViewportSize;
  interactionMode?: CanvasInteractionMode;
  maxZoom?: number;
  minZoom?: number;
  padding?: number;
  pointerIgnoreSelector?: string;
}

export type CanvasInteractionMode = "select" | "pan";

export function shouldStartCanvasPan(
  mode: CanvasInteractionMode,
  pointerType: string,
  button: number,
): boolean {
  if (pointerType === "touch") return true;
  if (button === 1) return true;
  return button === 0 && mode === "pan";
}

export interface CanvasCameraController {
  camera: CanvasCamera;
  fit: () => void;
  fitBounds: (bounds: CanvasBounds, options?: FitCanvasOptions) => void;
  isPanning: boolean;
  onViewportResize: (viewport: CanvasViewportSize) => void;
  setCamera: (
    next: CanvasCamera | ((current: CanvasCamera) => CanvasCamera),
  ) => void;
  viewportBindings: {
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  };
  zoomBy: (factor: number) => void;
}

interface PinchState {
  camera: CanvasCamera;
  centroid: CanvasPoint;
  distance: number;
}

const DEFAULT_VIEWPORT = { width: 1, height: 1 };

function pointInViewport(event: {
  clientX: number;
  clientY: number;
  currentTarget: HTMLElement;
}): CanvasPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function pinchPoints(points: Map<number, CanvasPoint>) {
  const [first, second] = [...points.values()];
  if (!first || !second) return undefined;
  return {
    centroid: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.max(12, Math.hypot(first.x - second.x, first.y - second.y)),
  };
}

/** Shared pointer, touch, wheel, keyboard, and fit behavior for Topo canvases. */
export function useCanvasCamera(
  options: CanvasCameraOptions,
): CanvasCameraController {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [camera, setCameraState] = useState<CanvasCamera>(
    options.initialCamera ?? { x: 0, y: 0, zoom: 1 },
  );
  const [isPanning, setIsPanning] = useState(false);
  const cameraRef = useRef(camera);
  const viewportRef = useRef<CanvasViewportSize>(
    options.initialViewport ?? DEFAULT_VIEWPORT,
  );
  const hasFittedRef = useRef(false);
  const pointersRef = useRef(new Map<number, CanvasPoint>());
  const pinchRef = useRef<PinchState | null>(null);

  const setCamera = useCallback<CanvasCameraController["setCamera"]>((next) => {
    setCameraState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      cameraRef.current = resolved;
      return resolved;
    });
  }, []);

  const fitToViewport = useCallback(
    (viewport: CanvasViewportSize = viewportRef.current) => {
      const settings = optionsRef.current;
      hasFittedRef.current = true;
      setCamera(
        fitCanvasBounds(settings.bounds, viewport, {
          alignX: settings.alignX,
          alignY: settings.alignY,
          minZoom: settings.minZoom,
          maxZoom: settings.fitMaxZoom ?? settings.maxZoom,
          padding: settings.padding,
        }),
      );
    },
    [setCamera],
  );

  const fitBounds = useCallback(
    (bounds: CanvasBounds, fitOptions: FitCanvasOptions = {}) => {
      const settings = optionsRef.current;
      hasFittedRef.current = true;
      setCamera(
        fitCanvasBounds(bounds, viewportRef.current, {
          alignX: fitOptions.alignX ?? settings.alignX,
          alignY: fitOptions.alignY ?? settings.alignY,
          minZoom: fitOptions.minZoom ?? settings.minZoom,
          maxZoom:
            fitOptions.maxZoom ?? settings.fitMaxZoom ?? settings.maxZoom,
          padding: fitOptions.padding ?? settings.padding,
        }),
      );
    },
    [setCamera],
  );

  const onViewportResize = useCallback(
    (viewport: CanvasViewportSize) => {
      viewportRef.current = viewport;
      if (!hasFittedRef.current && viewport.width > 1 && viewport.height > 1) {
        fitToViewport(viewport);
      }
    },
    [fitToViewport],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      const settings = optionsRef.current;
      setCamera((current) =>
        zoomCanvasAt(
          current,
          current.zoom * factor,
          { x: viewport.width / 2, y: viewport.height / 2 },
          settings.minZoom,
          settings.maxZoom,
        ),
      );
    },
    [setCamera],
  );

  const beginPinch = useCallback(() => {
    const points = pinchPoints(pointersRef.current);
    if (!points) return;
    pinchRef.current = { camera: cameraRef.current, ...points };
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        !shouldStartCanvasPan(
          optionsRef.current.interactionMode ?? "pan",
          event.pointerType,
          event.button,
        )
      ) {
        return;
      }
      const ignoreSelector = optionsRef.current.pointerIgnoreSelector;
      if (
        ignoreSelector &&
        event.target instanceof Element &&
        event.target.closest(ignoreSelector)
      ) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      pointersRef.current.set(event.pointerId, pointInViewport(event));
      if (pointersRef.current.size === 2) beginPinch();
      setIsPanning(true);
    },
    [beginPinch],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const previous = pointersRef.current.get(event.pointerId);
      if (!previous) return;
      const point = pointInViewport(event);
      pointersRef.current.set(event.pointerId, point);

      if (pointersRef.current.size >= 2) {
        if (!pinchRef.current) beginPinch();
        const pinch = pinchRef.current;
        const points = pinchPoints(pointersRef.current);
        if (!pinch || !points) return;
        const settings = optionsRef.current;
        const zoomed = zoomCanvasAt(
          pinch.camera,
          pinch.camera.zoom * (points.distance / pinch.distance),
          pinch.centroid,
          settings.minZoom,
          settings.maxZoom,
        );
        setCamera({
          ...zoomed,
          x: zoomed.x + points.centroid.x - pinch.centroid.x,
          y: zoomed.y + points.centroid.y - pinch.centroid.y,
        });
        return;
      }

      setCamera((current) =>
        panCanvasBy(current, {
          x: point.x - previous.x,
          y: point.y - previous.y,
        }),
      );
    },
    [beginPinch, setCamera],
  );

  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = null;
    if (pointersRef.current.size === 0) setIsPanning(false);
  }, []);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      event.preventDefault();
      const point = pointInViewport(event);
      const settings = optionsRef.current;
      setCamera((current) =>
        zoomCanvasAt(
          current,
          current.zoom * Math.exp(-event.deltaY * 0.0015),
          point,
          settings.minZoom,
          settings.maxZoom,
        ),
      );
    },
    [setCamera],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === "0") {
        event.preventDefault();
        fitToViewport();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(1.2);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomBy(1 / 1.2);
      }
    },
    [fitToViewport, zoomBy],
  );

  return {
    camera,
    fit: fitToViewport,
    fitBounds,
    isPanning,
    onViewportResize,
    setCamera,
    viewportBindings: {
      onKeyDown,
      onPointerCancel: onPointerEnd,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onWheel,
    },
    zoomBy,
  };
}
