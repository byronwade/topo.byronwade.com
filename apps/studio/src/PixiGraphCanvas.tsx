import { useEffect, useRef } from "react";

import { Application, Container, Graphics, Text } from "pixi.js";

import type { CanvasLayout } from "@topo/canvas-engine";

interface PixiGraphCanvasProps {
  layout: CanvasLayout;
  selectedId?: string;
  onSelect: (id: string) => void;
  zoom?: number;
}

const colors = {
  background: 0x0b0d10,
  grid: 0x171b22,
  group: 0x12161d,
  groupStroke: 0x242a34,
  card: 0x171c24,
  cardSelected: 0x202b36,
  cardStroke: 0x2d3642,
  cardSelectedStroke: 0x73d6ac,
  muted: 0x788493,
  text: 0xe8eee9,
  accent: 0x73d6ac,
  amber: 0xe2b26e,
};

function drawGrid(container: Container, width: number, height: number): void {
  const grid = new Graphics();
  for (let x = 0; x <= width; x += 32) {
    grid.moveTo(x, 0).lineTo(x, height);
  }
  for (let y = 0; y <= height; y += 32) {
    grid.moveTo(0, y).lineTo(width, y);
  }
  grid.stroke({ color: colors.grid, width: 1, alpha: 0.65 });
  container.addChild(grid);
}

export function PixiGraphCanvas({
  layout,
  selectedId,
  onSelect,
  zoom = 1,
}: PixiGraphCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const app = new Application();

    void (async () => {
      await app.init({
        background: colors.background,
        antialias: true,
        resizeTo: host,
        resolution: window.devicePixelRatio,
        autoDensity: true,
      });
      if (disposed) {
        app.destroy(true);
        return;
      }

      host.appendChild(app.canvas);
      const world = new Container();
      world.scale.set(zoom);
      world.position.set(28, 22);
      app.stage.addChild(world);
      drawGrid(
        world,
        Math.max(layout.width, host.clientWidth),
        Math.max(layout.height, host.clientHeight),
      );

      for (const group of layout.groups) {
        const groupBackground = new Graphics()
          .roundRect(
            group.position.x,
            group.position.y,
            group.width,
            group.height,
            18,
          )
          .fill({ color: colors.group, alpha: 0.82 })
          .stroke({ color: colors.groupStroke, width: 1 });
        world.addChild(groupBackground);
        const groupLabel = new Text({
          text: group.label === "/" ? "ROOT" : group.label.toUpperCase(),
          style: {
            fill: colors.muted,
            fontFamily: "Arial",
            fontSize: 10,
            fontWeight: "700",
            letterSpacing: 1.6,
          },
        });
        groupLabel.position.set(group.position.x + 18, group.position.y + 16);
        world.addChild(groupLabel);
      }

      for (const screen of layout.screens) {
        const selected = screen.id === selectedId;
        const card = new Graphics()
          .roundRect(
            screen.position.x,
            screen.position.y,
            screen.width,
            screen.height,
            12,
          )
          .fill({ color: selected ? colors.cardSelected : colors.card })
          .stroke({
            color: selected ? colors.cardSelectedStroke : colors.cardStroke,
            width: selected ? 2 : 1,
          });
        card.eventMode = "static";
        card.cursor = "pointer";
        card.on("pointertap", () => onSelect(screen.id));
        world.addChild(card);

        const marker = new Graphics()
          .circle(screen.position.x + 20, screen.position.y + 22, 4)
          .fill({
            color:
              screen.renderStatus === "captured" ? colors.accent : colors.amber,
          });
        world.addChild(marker);

        const title = new Text({
          text: screen.title,
          style: {
            fill: colors.text,
            fontFamily: "Arial",
            fontSize: 15,
            fontWeight: "600",
          },
        });
        title.position.set(screen.position.x + 32, screen.position.y + 14);
        world.addChild(title);

        const route = new Text({
          text: screen.routePath,
          style: { fill: colors.muted, fontFamily: "Arial", fontSize: 12 },
        });
        route.position.set(screen.position.x + 18, screen.position.y + 48);
        world.addChild(route);

        const source = new Text({
          text: screen.source.filePath,
          style: { fill: colors.muted, fontFamily: "Arial", fontSize: 10 },
        });
        source.alpha = 0.8;
        source.position.set(
          screen.position.x + 18,
          screen.position.y + screen.height - 24,
        );
        world.addChild(source);
      }

      const centerX = Math.max(layout.width, host.clientWidth) / 2;
      const centerY = Math.max(layout.height, host.clientHeight) / 2;
      world.position.set(
        Math.max(24, (host.clientWidth - layout.width) / 2),
        Math.max(24, (host.clientHeight - layout.height) / 2),
      );
      if (layout.width < host.clientWidth)
        world.position.x = Math.max(24, centerX - layout.width / 2);
      if (layout.height < host.clientHeight)
        world.position.y = Math.max(24, centerY - layout.height / 2);
    })();

    return () => {
      disposed = true;
      app.destroy(true);
      host.replaceChildren();
    };
  }, [layout, onSelect, selectedId, zoom]);

  return (
    <div
      className="pixi-host"
      ref={hostRef}
      aria-label="Topo application atlas"
    />
  );
}
