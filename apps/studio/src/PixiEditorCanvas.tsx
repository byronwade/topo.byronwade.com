import { useEffect, useRef } from "react";

import "pixi.js/unsafe-eval";
import { Graphics } from "pixi.js";

import type { CanvasCamera, CanvasViewportSize } from "@topo/canvas-engine";
import {
  createPixiCanvasHost,
  drawViewportDotGrid,
  type PixiCanvasHost,
} from "@topo/renderer-pixi";

interface PixiEditorCanvasProps {
  camera: CanvasCamera;
  onResize: (size: CanvasViewportSize) => void;
}

const CANVAS_COLOR = 0x0a0a0a;

/**
 * The GPU surface for the editor viewport. Application content remains a DOM
 * overlay so it stays interactive, inspectable, and readable to agents.
 */
export function PixiEditorCanvas({ camera, onResize }: PixiEditorCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  const onResizeRef = useRef(onResize);
  const redrawRef = useRef<(() => void) | null>(null);

  cameraRef.current = camera;
  onResizeRef.current = onResize;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let pixiHost: PixiCanvasHost | undefined;

    void (async () => {
      const mounted = await createPixiCanvasHost(host, {
        background: CANVAS_COLOR,
        renderer: "pixi-editor",
      });
      if (disposed) {
        mounted.destroy();
        return;
      }
      pixiHost = mounted;
      const { app } = mounted;

      const grid = new Graphics();
      app.stage.addChild(grid);

      const redraw = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        drawViewportDotGrid(grid, width, height, cameraRef.current, {
          majorAlpha: 0.62,
          majorColor: 0x343434,
          minorAlpha: 0.5,
          minorColor: 0x282828,
        });
        onResizeRef.current({ width, height });
        mounted.render();
      };
      redrawRef.current = redraw;

      mounted.observeResize(redraw);
      redraw();
    })().catch((error: unknown) => {
      if (disposed) return;
      pixiHost?.destroy();
      pixiHost = undefined;
      host.dataset.rendererError =
        error instanceof Error
          ? error.message
          : "Pixi renderer failed to initialize";
      console.error("Topo Pixi editor failed to initialize", error);
    });

    return () => {
      disposed = true;
      redrawRef.current = null;
      pixiHost?.destroy();
      pixiHost = undefined;
    };
  }, []);

  useEffect(() => {
    redrawRef.current?.();
  }, [camera]);

  return <div className="editor-pixi-host" ref={hostRef} />;
}
