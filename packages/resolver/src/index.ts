import type { ApplicationGraph, GraphEdge } from "@topo/schema";

export interface RouteLink { sourceFile: string; href: string; line: number; }

export function findRouteLinks(source: string, sourceFile: string): RouteLink[] {
  return [...source.matchAll(/(?:href|to)\s*=\s*["']([^"']+)["']/g)]
    .map((match) => ({ sourceFile, href: match[1] ?? "", line: source.slice(0, match.index ?? 0).split("\n").length }))
    .filter((link) => link.href.startsWith("/"));
}

export function resolveNavigationEdges(graph: ApplicationGraph, files: Array<{ filePath: string; source: string }>): GraphEdge[] {
  const bySource = new Map(graph.screens.map((screen) => [screen.source.filePath, screen]));
  const byRoute = new Map(graph.screens.filter((screen) => screen.state === "default").map((screen) => [screen.routePath, screen]));
  const edges: GraphEdge[] = [];
  for (const file of files) {
    const sourceScreen = bySource.get(file.filePath);
    if (!sourceScreen) continue;
    for (const link of findRouteLinks(file.source, file.filePath)) {
      const target = byRoute.get(link.href);
      if (!target) continue;
      edges.push({ id: `navigation:${sourceScreen.id}->${target.id}:${link.line}`, source: sourceScreen.id, target: target.id, kind: "navigation", confidence: 1 });
    }
  }
  return edges;
}
