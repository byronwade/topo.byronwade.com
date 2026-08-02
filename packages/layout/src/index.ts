import {
  createComponentGroups,
  createRouteDistricts,
  createRouteSections,
  layoutGraph,
  layoutRouteDistricts,
  type CanvasBounds,
  type CanvasLayout,
  type CanvasPoint,
  type ComponentPreviewStatusCounts,
  type LayoutOptions,
  type RouteDistrict,
  type RouteRenderStatusCounts,
  type RouteSection,
} from "@topo/canvas-engine";
import type {
  ApplicationGraph,
  AtlasOrganization,
  ComponentNode,
  Flow,
  FlowStatus,
  GraphEdge,
  SourceLocation,
} from "@topo/schema";

export interface AtlasConnection {
  confidence: number;
  id: string;
  kind: GraphEdge["kind"];
  source: string;
  sourceRouteId: string;
  sourcePoint: CanvasPoint;
  target: string;
  targetRouteId: string;
  targetPoint: CanvasPoint;
}

export interface AtlasRouteNode {
  id: string;
  label: string;
  routePath: string;
  depth: number;
  dynamic: boolean;
  primaryScreenId: string;
  screenIds: string[];
  adapterIds: string[];
  states: string[];
  sourceFilePaths: string[];
  renderStatusCounts: RouteRenderStatusCounts;
  parentRouteId?: string;
  childRouteIds: string[];
  hierarchyLevel: number;
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface AtlasRouteGroup {
  id: string;
  label: string;
  source: "automatic" | "configured";
  routePrefix: string;
  routePrefixes: string[];
  order: number;
  routeNodeIds: string[];
  screenIds: string[];
  routeCount: number;
  screenCount: number;
  stateCount: number;
  dynamicRouteCount: number;
  maxDepth: number;
  renderStatusCounts: RouteRenderStatusCounts;
  layoutMode: "grid" | "hierarchy";
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface AtlasRouteSection {
  id: string;
  label: string;
  source: RouteSection["source"];
  routePrefixes: string[];
  order: number;
  groupIds: string[];
  routeNodeIds: string[];
  screenIds: string[];
  routeCount: number;
  screenCount: number;
  stateCount: number;
  dynamicRouteCount: number;
  renderStatusCounts: RouteRenderStatusCounts;
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface AtlasRouteHierarchyConnection {
  id: string;
  groupId: string;
  parentRouteId: string;
  childRouteId: string;
  sourcePoint: CanvasPoint;
  targetPoint: CanvasPoint;
}

export interface AtlasRouteMap {
  bounds: CanvasBounds;
  sections: AtlasRouteSection[];
  groups: AtlasRouteGroup[];
  hierarchyConnections: AtlasRouteHierarchyConnection[];
  routes: AtlasRouteNode[];
}

export interface AtlasScene {
  version: 4;
  bounds: CanvasBounds;
  connections: AtlasConnection[];
  layout: CanvasLayout;
  routeMap: AtlasRouteMap;
  selectedBounds: CanvasBounds;
  selectedGroupBounds: CanvasBounds;
  selectedSectionBounds: CanvasBounds;
  selectedScreenId?: string;
}

export interface ComponentSceneNode extends ComponentNode {
  groupId: string;
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface ComponentSceneGroup {
  id: string;
  label: string;
  source: "automatic" | "configured";
  sourcePrefix: string;
  sourcePrefixes: string[];
  order: number;
  componentIds: string[];
  componentCount: number;
  routeUsageCount: number;
  previewCount: number;
  previewStatusCounts: ComponentPreviewStatusCounts;
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface ComponentRouteNode {
  id: string;
  screenId: string;
  title: string;
  routePath?: string;
  source?: SourceLocation;
  resolution: "resolved" | "unresolved";
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface ComponentUsageConnection {
  id: string;
  sourceComponentId: string;
  targetRouteNodeId: string;
  targetScreenId: string;
  resolution: ComponentRouteNode["resolution"];
  sourcePoint: CanvasPoint;
  targetPoint: CanvasPoint;
}

export interface ComponentScene {
  version: 2;
  bounds: CanvasBounds;
  components: ComponentSceneNode[];
  groups: ComponentSceneGroup[];
  routeNodes: ComponentRouteNode[];
  connections: ComponentUsageConnection[];
  selectedBounds: CanvasBounds;
  selectedGroupBounds: CanvasBounds;
  selectedComponentId?: string;
  selectedGroupId?: string;
}

export interface FlowSceneStep {
  nodeId: string;
  flowId: string;
  stepId: string;
  order: number;
  title: string;
  routePath?: string;
  screenId?: string;
  resolvedScreenId?: string;
  action?: string;
  expected?: string;
  noteIds: string[];
  nextStepIds: string[];
  resolution: "resolved" | "unresolved" | "unbound";
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface FlowSceneLane {
  id: string;
  title: string;
  description: string;
  status: FlowStatus;
  stepNodeIds: string[];
  breakCount: number;
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface FlowSceneConnection {
  id: string;
  flowId: string;
  sourceNodeId: string;
  sourceStepId: string;
  targetNodeId: string;
  targetStepId: string;
  action?: string;
  status: "resolved" | "broken";
  sourcePoint: CanvasPoint;
  targetPoint: CanvasPoint;
}

export interface FlowScene {
  version: 1;
  bounds: CanvasBounds;
  lanes: FlowSceneLane[];
  steps: FlowSceneStep[];
  connections: FlowSceneConnection[];
  focusFlowIds: string[];
  selectedBounds: CanvasBounds;
  selectedFlowId?: string;
  selectedStepId?: string;
  selectedStepNodeId?: string;
}

export interface LayoutEngine {
  atlas(
    graph: ApplicationGraph,
    selectedScreenId?: string,
    options?: AtlasSceneOptions,
  ): AtlasScene;
  layout(graph: ApplicationGraph, options?: LayoutOptions): CanvasLayout;
}

export interface AtlasSceneOptions extends LayoutOptions {
  routeOrganization?: AtlasOrganization;
}

const ATLAS_LAYOUT_DEFAULTS: LayoutOptions = {
  columnGap: 72,
  groupGap: 144,
  groupHeaderHeight: 116,
  maxGroupsPerRow: 10,
  maxRowsPerColumn: 5,
  nodeGap: 72,
  nodeHeight: 688,
  nodeWidth: 780,
  padding: 52,
  targetRowWidth: 8_700,
};

const ROUTE_MAP_CARD_WIDTH = 360;
const ROUTE_MAP_CARD_HEIGHT = 230;
const ROUTE_MAP_CARD_GAP = 24;
const ROUTE_MAP_GROUP_GAP = 112;
const ROUTE_MAP_GROUP_HEADER = 108;
const ROUTE_MAP_GROUP_PADDING = 32;
const ROUTE_MAP_GROUP_LAYOUT_GAP = 48;
const ROUTE_MAP_SECTION_GAP = 144;
const ROUTE_MAP_SECTION_HEADER = 96;
const ROUTE_MAP_SECTION_PADDING = 40;
const ROUTE_MAP_SECTION_MIN_TARGET_WIDTH = 2_400;
const ROUTE_MAP_SECTION_MAX_TARGET_WIDTH = 6_400;
const ROUTE_MAP_SECTION_TARGET_ASPECT = 2.4;
const ROUTE_MAP_PACKING_ALLOWANCE = 1.4;

function routeMapColumnCount(routeCount: number): number {
  if (routeCount <= 1) return 1;
  if (routeCount <= 4) return 2;
  if (routeCount <= 12) return 3;
  if (routeCount <= 24) return 4;
  if (routeCount <= 48) return 6;
  return 8;
}

interface DistrictRoutePlacement {
  layoutMode: AtlasRouteGroup["layoutMode"];
  columns: number;
  rows: number;
  positions: Map<string, CanvasPoint>;
}

function routeMapSectionTargetWidth(
  geometries: readonly { width: number; height: number }[],
): number {
  const widest = Math.max(0, ...geometries.map((geometry) => geometry.width));
  const packedArea = geometries.reduce(
    (total, geometry) =>
      total +
      (geometry.width + ROUTE_MAP_GROUP_LAYOUT_GAP) *
        (geometry.height + ROUTE_MAP_GROUP_LAYOUT_GAP),
    0,
  );
  const landscapeEstimate =
    Math.sqrt(packedArea * ROUTE_MAP_SECTION_TARGET_ASPECT) *
      ROUTE_MAP_PACKING_ALLOWANCE +
    ROUTE_MAP_SECTION_PADDING * 2;
  return Math.min(
    ROUTE_MAP_SECTION_MAX_TARGET_WIDTH,
    Math.max(
      ROUTE_MAP_SECTION_MIN_TARGET_WIDTH,
      widest + ROUTE_MAP_SECTION_PADDING * 2,
      landscapeEstimate,
    ),
  );
}

function placeDistrictRoutes(district: RouteDistrict): DistrictRoutePlacement {
  const maxHierarchyLevel = Math.max(
    0,
    ...district.routes.map((route) => route.hierarchyLevel),
  );
  if (maxHierarchyLevel === 0) {
    const columns = routeMapColumnCount(district.routes.length);
    const rows = Math.max(1, Math.ceil(district.routes.length / columns));
    return {
      layoutMode: "grid",
      columns,
      rows,
      positions: new Map(
        district.routes.map((route, index) => [
          route.id,
          {
            x: (index % columns) * (ROUTE_MAP_CARD_WIDTH + ROUTE_MAP_CARD_GAP),
            y:
              Math.floor(index / columns) *
              (ROUTE_MAP_CARD_HEIGHT + ROUTE_MAP_CARD_GAP),
          },
        ]),
      ),
    };
  }

  const routesByLevel = new Map<number, RouteDistrict["routes"]>();
  for (const route of district.routes) {
    routesByLevel.set(route.hierarchyLevel, [
      ...(routesByLevel.get(route.hierarchyLevel) ?? []),
      route,
    ]);
  }
  const rows = Math.max(
    1,
    ...[...routesByLevel.values()].map((routes) => routes.length),
  );
  const positions = new Map<string, CanvasPoint>();
  for (let level = 0; level <= maxHierarchyLevel; level += 1) {
    const levelRoutes = routesByLevel.get(level) ?? [];
    const rowOffset = (rows - levelRoutes.length) / 2;
    levelRoutes.forEach((route, index) => {
      positions.set(route.id, {
        x: level * (ROUTE_MAP_CARD_WIDTH + ROUTE_MAP_GROUP_GAP),
        y: (rowOffset + index) * (ROUTE_MAP_CARD_HEIGHT + ROUTE_MAP_CARD_GAP),
      });
    });
  }
  return {
    layoutMode: "hierarchy",
    columns: maxHierarchyLevel + 1,
    rows,
    positions,
  };
}

function createAtlasRouteMap(
  districts: readonly RouteDistrict[],
): AtlasRouteMap {
  const sections: AtlasRouteSection[] = [];
  const groups: AtlasRouteGroup[] = [];
  const routes: AtlasRouteNode[] = [];
  const hierarchyConnections: AtlasRouteHierarchyConnection[] = [];
  const districtGeometry = new Map(
    districts.map((district) => {
      const placement = placeDistrictRoutes(district);
      const columnSpacing =
        placement.layoutMode === "hierarchy"
          ? ROUTE_MAP_GROUP_GAP
          : ROUTE_MAP_CARD_GAP;
      return [
        district.id,
        {
          placement,
          width:
            ROUTE_MAP_GROUP_PADDING * 2 +
            placement.columns * ROUTE_MAP_CARD_WIDTH +
            Math.max(0, placement.columns - 1) * columnSpacing,
          height:
            ROUTE_MAP_GROUP_PADDING * 2 +
            ROUTE_MAP_GROUP_HEADER +
            placement.rows * ROUTE_MAP_CARD_HEIGHT +
            Math.max(0, placement.rows - 1) * ROUTE_MAP_CARD_GAP,
        },
      ] as const;
    }),
  );
  const routeSections = createRouteSections(districts);
  let sectionY = 0;

  for (const section of routeSections) {
    const sectionTargetWidth = routeMapSectionTargetWidth(
      section.districts.flatMap((district) => {
        const geometry = districtGeometry.get(district.id);
        return geometry ? [geometry] : [];
      }),
    );
    let cursorX = ROUTE_MAP_SECTION_PADDING;
    let cursorY = ROUTE_MAP_SECTION_HEADER + ROUTE_MAP_SECTION_PADDING;
    let rowHeight = 0;
    let maxRight = ROUTE_MAP_SECTION_PADDING;
    const groupIds: string[] = [];
    const sectionRouteNodeIds: string[] = [];

    for (const district of section.districts) {
      const geometry = districtGeometry.get(district.id);
      if (!geometry) continue;
      if (
        cursorX > ROUTE_MAP_SECTION_PADDING &&
        cursorX + geometry.width + ROUTE_MAP_SECTION_PADDING >
          sectionTargetWidth
      ) {
        cursorX = ROUTE_MAP_SECTION_PADDING;
        cursorY += rowHeight + ROUTE_MAP_GROUP_LAYOUT_GAP;
        rowHeight = 0;
      }

      const groupPosition = { x: cursorX, y: sectionY + cursorY };
      const routeNodeIds: string[] = [];
      district.routes.forEach((route) => {
        const routePosition = geometry.placement.positions.get(route.id) ?? {
          x: 0,
          y: 0,
        };
        routeNodeIds.push(route.id);
        sectionRouteNodeIds.push(route.id);
        routes.push({
          ...route,
          position: {
            x: groupPosition.x + ROUTE_MAP_GROUP_PADDING + routePosition.x,
            y:
              groupPosition.y +
              ROUTE_MAP_GROUP_PADDING +
              ROUTE_MAP_GROUP_HEADER +
              routePosition.y,
          },
          width: ROUTE_MAP_CARD_WIDTH,
          height: ROUTE_MAP_CARD_HEIGHT,
        });
      });
      groupIds.push(district.id);
      groups.push({
        id: district.id,
        label: district.label,
        source: district.source,
        routePrefix: district.routePrefix,
        routePrefixes: district.routePrefixes,
        order: groups.length,
        routeNodeIds,
        screenIds: district.screens.map((screen) => screen.id),
        routeCount: district.routeCount,
        screenCount: district.screenCount,
        stateCount: district.stateCount,
        dynamicRouteCount: district.dynamicRouteCount,
        maxDepth: district.maxDepth,
        renderStatusCounts: district.renderStatusCounts,
        layoutMode: geometry.placement.layoutMode,
        position: groupPosition,
        width: geometry.width,
        height: geometry.height,
      });
      cursorX += geometry.width + ROUTE_MAP_GROUP_LAYOUT_GAP;
      rowHeight = Math.max(rowHeight, geometry.height);
      maxRight = Math.max(maxRight, cursorX - ROUTE_MAP_GROUP_LAYOUT_GAP);
    }

    const width = maxRight + ROUTE_MAP_SECTION_PADDING;
    const height = cursorY + rowHeight + ROUTE_MAP_SECTION_PADDING;
    sections.push({
      id: section.id,
      label: section.label,
      source: section.source,
      routePrefixes: section.routePrefixes,
      order: section.order,
      groupIds,
      routeNodeIds: sectionRouteNodeIds,
      screenIds: section.screenIds,
      routeCount: section.routeCount,
      screenCount: section.screenCount,
      stateCount: section.stateCount,
      dynamicRouteCount: section.dynamicRouteCount,
      renderStatusCounts: section.renderStatusCounts,
      position: { x: 0, y: sectionY },
      width,
      height,
    });
    sectionY += height + ROUTE_MAP_SECTION_GAP;
  }

  const atlasWidth = Math.max(0, ...sections.map((section) => section.width));
  const horizontalOffsetBySectionId = new Map<string, number>();
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const routeById = new Map(routes.map((route) => [route.id, route]));
  for (const section of sections) {
    const horizontalOffset = Math.max(0, (atlasWidth - section.width) / 2);
    horizontalOffsetBySectionId.set(section.id, horizontalOffset);
    section.position.x += horizontalOffset;
  }
  for (const section of sections) {
    const horizontalOffset = horizontalOffsetBySectionId.get(section.id) ?? 0;
    for (const groupId of section.groupIds) {
      const group = groupById.get(groupId);
      if (group) group.position.x += horizontalOffset;
    }
    for (const routeId of section.routeNodeIds) {
      const route = routeById.get(routeId);
      if (route) route.position.x += horizontalOffset;
    }
  }

  for (const group of groups) {
    for (const childRouteId of group.routeNodeIds) {
      const child = routeById.get(childRouteId);
      const parent = child?.parentRouteId
        ? routeById.get(child.parentRouteId)
        : undefined;
      if (!child || !parent) continue;
      hierarchyConnections.push({
        id: `route-hierarchy:${parent.id}:${child.id}`,
        groupId: group.id,
        parentRouteId: parent.id,
        childRouteId: child.id,
        sourcePoint: {
          x: parent.position.x + parent.width,
          y: parent.position.y + parent.height / 2,
        },
        targetPoint: {
          x: child.position.x,
          y: child.position.y + child.height / 2,
        },
      });
    }
  }

  return {
    bounds: padBounds(
      boundsForPositionedItems(sections, { x: 0, y: 0, width: 1, height: 1 }),
      28,
    ),
    sections,
    groups,
    hierarchyConnections,
    routes,
  };
}

function boundsForPositionedItems(
  items: ReadonlyArray<{
    position: CanvasPoint;
    width: number;
    height: number;
  }>,
  fallback: CanvasBounds = { x: 0, y: 0, width: 1, height: 1 },
): CanvasBounds {
  if (items.length === 0) return fallback;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.position.x);
    minY = Math.min(minY, item.position.y);
    maxX = Math.max(maxX, item.position.x + item.width);
    maxY = Math.max(maxY, item.position.y + item.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function padBounds(bounds: CanvasBounds, padding: number): CanvasBounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

/**
 * Produce a stable, renderer-neutral route map plus a full-size selected-screen
 * layout. Renderers can switch between a compact overview and a faithful live
 * screen without recomputing route organization or losing graph identity.
 */
export function createAtlasScene(
  graph: ApplicationGraph,
  selectedScreenId?: string,
  options: AtlasSceneOptions = {},
): AtlasScene {
  const { routeOrganization, ...layoutOptions } = options;
  const districts = createRouteDistricts(graph.screens, routeOrganization);
  const base = layoutRouteDistricts(districts, {
    ...ATLAS_LAYOUT_DEFAULTS,
    ...layoutOptions,
  });
  const routeMap = createAtlasRouteMap(districts);
  const selected =
    base.screens.find((screen) => screen.id === selectedScreenId) ??
    base.screens[0];
  const offset = selected?.position ?? { x: 0, y: 0 };
  const screens = base.screens.map((screen) => ({
    ...screen,
    position: {
      x: screen.position.x - offset.x,
      y: screen.position.y - offset.y,
    },
  }));
  const groups = base.groups.map((group) => ({
    ...group,
    position: {
      x: group.position.x - offset.x,
      y: group.position.y - offset.y,
    },
  }));
  const routeByScreenId = new Map<string, AtlasRouteNode>();
  for (const route of routeMap.routes) {
    for (const screenId of route.screenIds)
      routeByScreenId.set(screenId, route);
  }
  const connections = graph.edges.flatMap((edge): AtlasConnection[] => {
    const source = routeByScreenId.get(edge.source);
    const target = routeByScreenId.get(edge.target);
    if (!source || !target) return [];
    return [
      {
        confidence: edge.confidence,
        id: edge.id,
        kind: edge.kind,
        source: edge.source,
        sourceRouteId: source.id,
        sourcePoint: {
          x: source.position.x + source.width,
          y: source.position.y + source.height / 2,
        },
        target: edge.target,
        targetRouteId: target.id,
        targetPoint: {
          x: target.position.x,
          y: target.position.y + target.height / 2,
        },
      },
    ];
  });
  const layout: CanvasLayout = { ...base, groups, screens };
  const selectedGroup = routeMap.groups.find((group) =>
    group.screenIds.includes(selected?.id ?? ""),
  );
  const selectedSection = routeMap.sections.find((section) =>
    section.screenIds.includes(selected?.id ?? ""),
  );
  const selectedScreenBounds = {
    x: 0,
    y: -18,
    width: selected?.width ?? ATLAS_LAYOUT_DEFAULTS.nodeWidth!,
    height: (selected?.height ?? ATLAS_LAYOUT_DEFAULTS.nodeHeight!) + 18,
  };

  return {
    version: 4,
    bounds: routeMap.bounds,
    connections,
    layout,
    routeMap,
    selectedBounds: selectedScreenBounds,
    selectedGroupBounds: selectedGroup
      ? padBounds(
          {
            x: selectedGroup.position.x,
            y: selectedGroup.position.y,
            width: selectedGroup.width,
            height: selectedGroup.height,
          },
          28,
        )
      : selectedScreenBounds,
    selectedSectionBounds: selectedSection
      ? padBounds(
          {
            x: selectedSection.position.x,
            y: selectedSection.position.y,
            width: selectedSection.width,
            height: selectedSection.height,
          },
          28,
        )
      : selectedGroup
        ? padBounds(
            {
              x: selectedGroup.position.x,
              y: selectedGroup.position.y,
              width: selectedGroup.width,
              height: selectedGroup.height,
            },
            28,
          )
        : selectedScreenBounds,
    selectedScreenId: selected?.id,
  };
}

export interface ComponentSceneOptions {
  organization?: AtlasOrganization;
}

const COMPONENT_NODE_WIDTH = 240;
const COMPONENT_NODE_HEIGHT = 148;
const COMPONENT_NODE_GAP = 18;
const COMPONENT_GROUP_PADDING = 28;
const COMPONENT_GROUP_HEADER = 44;
const COMPONENT_GROUP_GAP = 96;
const COMPONENT_ATLAS_MIN_TARGET_WIDTH = 2_100;
const COMPONENT_ATLAS_MAX_TARGET_WIDTH = 6_400;
const COMPONENT_ATLAS_TARGET_ASPECT = 2.2;
const COMPONENT_ATLAS_PACKING_ALLOWANCE = 1.15;

type ComponentCollection = ReturnType<typeof createComponentGroups>[number];

interface ComponentGroupGeometry {
  collection: ComponentCollection;
  columnCount: number;
  height: number;
  width: number;
}

function componentGroupGeometry(
  collection: ComponentCollection,
): ComponentGroupGeometry {
  const columnLimit = collection.componentCount > 12 ? 6 : 4;
  const columnCount = Math.min(columnLimit, collection.componentCount);
  const rowCount = Math.ceil(collection.componentCount / columnCount);
  return {
    collection,
    columnCount,
    width:
      COMPONENT_GROUP_PADDING * 2 +
      columnCount * COMPONENT_NODE_WIDTH +
      Math.max(0, columnCount - 1) * COMPONENT_NODE_GAP,
    height:
      COMPONENT_GROUP_PADDING * 2 +
      COMPONENT_GROUP_HEADER +
      rowCount * COMPONENT_NODE_HEIGHT +
      Math.max(0, rowCount - 1) * COMPONENT_NODE_GAP,
  };
}

function componentAtlasTargetWidth(
  geometries: readonly ComponentGroupGeometry[],
): number {
  const widest = Math.max(0, ...geometries.map((item) => item.width));
  const packedArea = geometries.reduce(
    (area, item) => area + item.width * item.height,
    0,
  );
  const landscapeEstimate =
    Math.sqrt(packedArea * COMPONENT_ATLAS_TARGET_ASPECT) *
    COMPONENT_ATLAS_PACKING_ALLOWANCE;
  return Math.min(
    COMPONENT_ATLAS_MAX_TARGET_WIDTH,
    Math.max(COMPONENT_ATLAS_MIN_TARGET_WIDTH, widest, landscapeEstimate),
  );
}

function componentGeometryRows(
  geometries: readonly ComponentGroupGeometry[],
  targetWidth: number,
): ComponentGroupGeometry[][] {
  const rows: ComponentGroupGeometry[][] = [];
  for (const geometry of geometries) {
    const current = rows.at(-1);
    const currentWidth =
      current?.reduce((width, item) => width + item.width, 0) ?? 0;
    const nextWidth =
      currentWidth +
      (current?.length ? current.length * COMPONENT_GROUP_GAP : 0) +
      geometry.width;
    if (current?.length && nextWidth > targetWidth) {
      rows.push([geometry]);
    } else if (current) {
      current.push(geometry);
    } else {
      rows.push([geometry]);
    }
  }
  return rows;
}

function componentRowWidth(row: readonly ComponentGroupGeometry[]): number {
  return (
    row.reduce((width, item) => width + item.width, 0) +
    Math.max(0, row.length - 1) * COMPONENT_GROUP_GAP
  );
}

/**
 * Build the component coverage atlas as a deterministic bipartite read model.
 * The whole component catalog remains available for overview rendering while
 * exact route consumers for the selected component are promoted nearby.
 */
export function createComponentScene(
  graph: ApplicationGraph,
  selectedComponentId?: string,
  options: ComponentSceneOptions = {},
): ComponentScene {
  const selected =
    graph.components.find(
      (component) => component.id === selectedComponentId,
    ) ??
    graph.components.find(
      (component) => component.previewStatus !== "renderable",
    ) ??
    graph.components[0];
  const groups: ComponentSceneGroup[] = [];
  const components: ComponentSceneNode[] = [];
  const geometries = createComponentGroups(
    graph.components,
    options.organization,
  ).map(componentGroupGeometry);
  const rows = componentGeometryRows(
    geometries,
    componentAtlasTargetWidth(geometries),
  );
  const atlasWidth = Math.max(0, ...rows.map(componentRowWidth));
  let cursorY = 0;

  for (const row of rows) {
    const rowHeight = Math.max(...row.map((item) => item.height));
    let cursorX = (atlasWidth - componentRowWidth(row)) / 2;
    for (const geometry of row) {
      const { collection, columnCount, height, width } = geometry;
      groups.push({
        id: collection.id,
        label: collection.label,
        source: collection.source,
        sourcePrefix: collection.sourcePrefix,
        sourcePrefixes: collection.sourcePrefixes,
        order: collection.order,
        componentIds: collection.componentIds,
        componentCount: collection.componentCount,
        routeUsageCount: collection.routeUsageCount,
        previewCount: collection.previewCount,
        previewStatusCounts: collection.previewStatusCounts,
        position: { x: cursorX, y: cursorY },
        width,
        height,
      });
      collection.components.forEach((component, index) => {
        const column = index % columnCount;
        const componentRow = Math.floor(index / columnCount);
        components.push({
          ...component,
          groupId: collection.id,
          position: {
            x:
              cursorX +
              COMPONENT_GROUP_PADDING +
              column * (COMPONENT_NODE_WIDTH + COMPONENT_NODE_GAP),
            y:
              cursorY +
              COMPONENT_GROUP_PADDING +
              COMPONENT_GROUP_HEADER +
              componentRow * (COMPONENT_NODE_HEIGHT + COMPONENT_NODE_GAP),
          },
          width: COMPONENT_NODE_WIDTH,
          height: COMPONENT_NODE_HEIGHT,
        });
      });
      cursorX += width + COMPONENT_GROUP_GAP;
    }
    cursorY += rowHeight + COMPONENT_GROUP_GAP;
  }

  const selectedPositioned =
    components.find((component) => component.id === selected?.id) ??
    components[0];
  const offset = selectedPositioned?.position ?? { x: 0, y: 0 };
  const translatedComponents = components.map((component) => ({
    ...component,
    position: {
      x: component.position.x - offset.x,
      y: component.position.y - offset.y,
    },
  }));
  const translatedGroups = groups.map((group) => ({
    ...group,
    position: {
      x: group.position.x - offset.x,
      y: group.position.y - offset.y,
    },
  }));

  const screenById = new Map(
    graph.screens.map((screen) => [screen.id, screen]),
  );
  const consumers = [...new Set(selected?.usedBy ?? [])];
  const routeWidth = 220;
  const routeHeight = 62;
  const routeGap = 14;
  const routeX = COMPONENT_NODE_WIDTH + 156;
  const routeStartY =
    consumers.length > 0
      ? -(consumers.length * routeHeight + (consumers.length - 1) * routeGap) /
          2 +
        COMPONENT_NODE_HEIGHT / 2
      : 0;
  const routeNodes: ComponentRouteNode[] = consumers.map((screenId, index) => {
    const screen = screenById.get(screenId);
    return {
      id: `component-usage:${selected?.id ?? "none"}:${screenId}`,
      screenId,
      title: screen?.title ?? screenId,
      routePath: screen?.routePath,
      source: screen?.source,
      resolution: screen ? "resolved" : "unresolved",
      position: {
        x: routeX,
        y: routeStartY + index * (routeHeight + routeGap),
      },
      width: routeWidth,
      height: routeHeight,
    };
  });
  const connections: ComponentUsageConnection[] = routeNodes.map((route) => ({
    id: `component-usage-edge:${selected?.id ?? "none"}:${route.screenId}`,
    sourceComponentId: selected?.id ?? "none",
    targetRouteNodeId: route.id,
    targetScreenId: route.screenId,
    resolution: route.resolution,
    sourcePoint: {
      x: COMPONENT_NODE_WIDTH,
      y: COMPONENT_NODE_HEIGHT / 2,
    },
    targetPoint: {
      x: route.position.x,
      y: route.position.y + route.height / 2,
    },
  }));
  const selectedNode = translatedComponents.find(
    (component) => component.id === selected?.id,
  );
  const selectedGroup = translatedGroups.find(
    (group) => group.id === selectedNode?.groupId,
  );
  const focusItems = [...(selectedNode ? [selectedNode] : []), ...routeNodes];
  const bounds = boundsForPositionedItems(
    [...translatedGroups, ...routeNodes],
    {
      x: 0,
      y: 0,
      width: COMPONENT_NODE_WIDTH,
      height: COMPONENT_NODE_HEIGHT,
    },
  );

  return {
    version: 2,
    bounds,
    components: translatedComponents,
    groups: translatedGroups,
    routeNodes,
    connections,
    selectedBounds: padBounds(
      boundsForPositionedItems(focusItems, {
        x: 0,
        y: 0,
        width: COMPONENT_NODE_WIDTH,
        height: COMPONENT_NODE_HEIGHT,
      }),
      24,
    ),
    selectedGroupBounds: selectedGroup
      ? padBounds(
          {
            x: selectedGroup.position.x,
            y: selectedGroup.position.y,
            width: selectedGroup.width,
            height: selectedGroup.height,
          },
          24,
        )
      : {
          x: 0,
          y: 0,
          width: COMPONENT_NODE_WIDTH,
          height: COMPONENT_NODE_HEIGHT,
        },
    selectedComponentId: selected?.id,
    selectedGroupId: selectedGroup?.id,
  };
}

function flowStepResolution(
  screenIdIndex: ReadonlyMap<string, string>,
  routePathIndex: ReadonlyMap<string, string>,
  step: Flow["steps"][number],
): Pick<FlowSceneStep, "resolution" | "resolvedScreenId"> {
  const resolvedScreenId = step.screenId
    ? screenIdIndex.get(step.screenId)
    : step.routePath
      ? routePathIndex.get(step.routePath)
      : undefined;
  if (resolvedScreenId) return { resolution: "resolved", resolvedScreenId };
  if (step.screenId || step.routePath) return { resolution: "unresolved" };
  return { resolution: "unbound" };
}

function maximum(values: Iterable<number>, fallback = 0): number {
  let result = fallback;
  for (const value of values) result = Math.max(result, value);
  return result;
}

function flowDepths(flow: Flow): Map<string, number> {
  const byId = new Map(flow.steps.map((step) => [step.id, step]));
  const entryId = flow.entryStepId ?? flow.steps[0]?.id;
  const depths = new Map<string, number>();
  if (entryId && byId.has(entryId)) {
    depths.set(entryId, 0);
    const queue = [entryId];
    for (let index = 0; index < queue.length; index += 1) {
      const stepId = queue[index]!;
      const depth = depths.get(stepId) ?? 0;
      for (const nextId of byId.get(stepId)?.nextStepIds ?? []) {
        if (depths.has(nextId)) continue;
        depths.set(nextId, depth + 1);
        queue.push(nextId);
      }
    }
  }
  let nextDisconnectedDepth =
    depths.size > 0 ? maximum(depths.values()) + 1 : 0;
  for (const step of flow.steps) {
    if (depths.has(step.id)) continue;
    depths.set(step.id, nextDisconnectedDepth);
    nextDisconnectedDepth += 1;
  }
  return depths;
}

const FLOW_STEP_WIDTH = 134;
const FLOW_STEP_HEIGHT = 100;
const FLOW_STEP_COLUMN_GAP = 48;
const FLOW_STEP_ROW_GAP = 24;
const FLOW_LANE_PADDING_X = 30;
const FLOW_LANE_HEADER = 58;
const FLOW_LANE_PADDING_BOTTOM = 28;
const FLOW_LANE_COLUMN_GAP = 80;
const FLOW_LANE_ROW_GAP = 58;
const FLOW_FOCUS_TRAILING_SPACE = 280;
const FLOW_ATLAS_MIN_TARGET_WIDTH = 1_400;
const FLOW_ATLAS_MAX_TARGET_WIDTH = 6_400;
const FLOW_ATLAS_TARGET_ASPECT = 2.2;
const FLOW_ATLAS_PACKING_ALLOWANCE = 1.35;

interface FlowLaneGeometry {
  flow: Flow;
  depths: Map<string, number>;
  rowByStepId: Map<string, number>;
  width: number;
  height: number;
}

function flowLaneGeometry(flow: Flow): FlowLaneGeometry {
  const depths = flowDepths(flow);
  const rowsAtDepth = new Map<number, number>();
  const rowByStepId = new Map<string, number>();
  for (const step of flow.steps) {
    const depth = depths.get(step.id) ?? 0;
    const row = rowsAtDepth.get(depth) ?? 0;
    rowsAtDepth.set(depth, row + 1);
    rowByStepId.set(step.id, row);
  }
  const maxDepth = maximum(depths.values());
  const maxRows = maximum(rowsAtDepth.values(), 1);
  return {
    flow,
    depths,
    rowByStepId,
    width:
      FLOW_LANE_PADDING_X * 2 +
      (maxDepth + 1) * FLOW_STEP_WIDTH +
      maxDepth * FLOW_STEP_COLUMN_GAP,
    height:
      FLOW_LANE_HEADER +
      maxRows * FLOW_STEP_HEIGHT +
      Math.max(0, maxRows - 1) * FLOW_STEP_ROW_GAP +
      FLOW_LANE_PADDING_BOTTOM,
  };
}

function flowAtlasTargetWidth(geometries: readonly FlowLaneGeometry[]): number {
  const widest = maximum(geometries.map((item) => item.width));
  const packedArea = geometries.reduce(
    (area, item) => area + item.width * item.height,
    0,
  );
  const landscapeEstimate =
    Math.sqrt(packedArea * FLOW_ATLAS_TARGET_ASPECT) *
    FLOW_ATLAS_PACKING_ALLOWANCE;
  return Math.min(
    FLOW_ATLAS_MAX_TARGET_WIDTH,
    Math.max(FLOW_ATLAS_MIN_TARGET_WIDTH, widest, landscapeEstimate),
  );
}

function flowGeometryRows(
  geometries: readonly FlowLaneGeometry[],
  targetWidth: number,
): FlowLaneGeometry[][] {
  const rows: FlowLaneGeometry[][] = [];
  for (const geometry of geometries) {
    const current = rows.at(-1);
    const currentWidth = current
      ? current.reduce((width, item) => width + item.width, 0)
      : 0;
    const nextWidth =
      currentWidth +
      (current?.length ? current.length * FLOW_LANE_COLUMN_GAP : 0) +
      geometry.width;
    if (current?.length && nextWidth > targetWidth) {
      rows.push([geometry]);
    } else if (current) {
      current.push(geometry);
    } else {
      rows.push([geometry]);
    }
  }
  return rows;
}

function flowRowWidth(row: readonly FlowLaneGeometry[]): number {
  return (
    row.reduce((width, item) => width + item.width, 0) +
    Math.max(0, row.length - 1) * FLOW_LANE_COLUMN_GAP
  );
}

function nearestSupportingFlow(
  lanes: readonly FlowSceneLane[],
  selectedFlowId?: string,
): FlowSceneLane | undefined {
  const selected = lanes.find((lane) => lane.id === selectedFlowId);
  if (!selected) return lanes[0];
  const selectedCenter = {
    x: selected.position.x + selected.width / 2,
    y: selected.position.y + selected.height / 2,
  };
  let nearest: FlowSceneLane | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    if (lane.id === selected.id) continue;
    const deltaX = lane.position.x + lane.width / 2 - selectedCenter.x;
    const deltaY = lane.position.y + lane.height / 2 - selectedCenter.y;
    const distance = deltaX * deltaX + deltaY * deltaY;
    if (distance < nearestDistance) {
      nearest = lane;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Build a directed flow scene from explicit `nextStepIds`. Array order is used
 * only for stable ordering within one graph rank, never to invent an edge.
 */
export function createFlowScene(
  graph: ApplicationGraph,
  flows: Flow[],
  selectedFlowId?: string,
  selectedStepId?: string,
): FlowScene {
  const selectedFlow =
    flows.find((flow) => flow.id === selectedFlowId) ?? flows[0];
  const lanes: FlowSceneLane[] = [];
  const steps: FlowSceneStep[] = [];
  const screenIdIndex = new Map(
    graph.screens.map((screen) => [screen.id, screen.id]),
  );
  const routePathIndex = new Map<string, string>();
  for (const screen of graph.screens) {
    if (!routePathIndex.has(screen.routePath)) {
      routePathIndex.set(screen.routePath, screen.id);
    }
  }
  const geometries = flows.map(flowLaneGeometry);
  const geometryRows = flowGeometryRows(
    geometries,
    flowAtlasTargetWidth(geometries),
  );
  const atlasWidth = maximum(geometryRows.map(flowRowWidth));
  const lanePositions = new Map<string, CanvasPoint>();
  let cursorY = 0;
  for (const row of geometryRows) {
    const rowHeight = maximum(row.map((item) => item.height));
    let cursorX = (atlasWidth - flowRowWidth(row)) / 2;
    for (const geometry of row) {
      lanePositions.set(geometry.flow.id, { x: cursorX, y: cursorY });
      cursorX += geometry.width + FLOW_LANE_COLUMN_GAP;
    }
    cursorY += rowHeight + FLOW_LANE_ROW_GAP;
  }

  for (const geometry of geometries) {
    const { depths, flow, height, rowByStepId, width } = geometry;
    const lanePosition = lanePositions.get(flow.id) ?? { x: 0, y: 0 };
    let breakCount = 0;
    for (const [order, step] of flow.steps.entries()) {
      const depth = depths.get(step.id) ?? 0;
      const row = rowByStepId.get(step.id) ?? 0;
      const resolution = flowStepResolution(
        screenIdIndex,
        routePathIndex,
        step,
      );
      if (resolution.resolution === "unresolved") breakCount += 1;
      steps.push({
        nodeId: `${flow.id}:${step.id}`,
        flowId: flow.id,
        stepId: step.id,
        order,
        title: step.title,
        routePath: step.routePath,
        screenId: step.screenId,
        action: step.action,
        expected: step.expected,
        noteIds: step.noteIds,
        nextStepIds: step.nextStepIds,
        ...resolution,
        position: {
          x:
            lanePosition.x +
            FLOW_LANE_PADDING_X +
            depth * (FLOW_STEP_WIDTH + FLOW_STEP_COLUMN_GAP),
          y:
            lanePosition.y +
            FLOW_LANE_HEADER +
            row * (FLOW_STEP_HEIGHT + FLOW_STEP_ROW_GAP),
        },
        width: FLOW_STEP_WIDTH,
        height: FLOW_STEP_HEIGHT,
      });
    }
    lanes.push({
      id: flow.id,
      title: flow.title,
      description: flow.description,
      status: flow.status,
      stepNodeIds: flow.steps.map((step) => `${flow.id}:${step.id}`),
      breakCount,
      position: lanePosition,
      width,
      height,
    });
  }

  const selectedStep = selectedFlow
    ? (steps.find(
        (step) =>
          step.flowId === selectedFlow.id && step.stepId === selectedStepId,
      ) ??
      steps.find(
        (step) =>
          step.flowId === selectedFlow.id &&
          step.stepId ===
            (selectedFlow.entryStepId ?? selectedFlow.steps[0]?.id),
      ))
    : undefined;
  const offset = selectedStep?.position ?? { x: 0, y: 0 };
  const translatedSteps = steps.map((step) => ({
    ...step,
    position: {
      x: step.position.x - offset.x,
      y: step.position.y - offset.y,
    },
  }));
  const translatedLanes = lanes.map((lane) => ({
    ...lane,
    position: {
      x: lane.position.x - offset.x,
      y: lane.position.y - offset.y,
    },
  }));
  const stepByNodeId = new Map(
    translatedSteps.map((step) => [step.nodeId, step]),
  );
  const connections: FlowSceneConnection[] = [];
  for (const flow of flows) {
    for (const step of flow.steps) {
      const sourceNodeId = `${flow.id}:${step.id}`;
      const source = stepByNodeId.get(sourceNodeId);
      if (!source) continue;
      for (const targetStepId of step.nextStepIds) {
        const targetNodeId = `${flow.id}:${targetStepId}`;
        const target = stepByNodeId.get(targetNodeId);
        if (!target) continue;
        connections.push({
          id: `flow-edge:${flow.id}:${step.id}:${targetStepId}`,
          flowId: flow.id,
          sourceNodeId,
          sourceStepId: step.id,
          targetNodeId,
          targetStepId,
          action: step.action,
          status:
            source.resolution === "unresolved" ||
            target.resolution === "unresolved"
              ? "broken"
              : "resolved",
          sourcePoint: {
            x: source.position.x + source.width,
            y: source.position.y + source.height / 2,
          },
          targetPoint: {
            x: target.position.x,
            y: target.position.y + target.height / 2,
          },
        });
      }
    }
  }
  const supportingFlow = nearestSupportingFlow(lanes, selectedFlow?.id);
  const focusFlowIds = [selectedFlow?.id, supportingFlow?.id].filter(
    (id): id is string => Boolean(id),
  );
  const selectedFocusLane = translatedLanes.find(
    (lane) => lane.id === selectedFlow?.id,
  );
  const focusLanes = selectedFocusLane
    ? [selectedFocusLane]
    : translatedLanes.slice(0, 1);
  const bounds = boundsForPositionedItems(translatedLanes, {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  const selectedBounds = padBounds(
    boundsForPositionedItems(focusLanes, bounds),
    24,
  );
  if (selectedFocusLane) {
    selectedBounds.height += FLOW_FOCUS_TRAILING_SPACE;
  }

  return {
    version: 1,
    bounds,
    lanes: translatedLanes,
    steps: translatedSteps,
    connections,
    focusFlowIds,
    selectedBounds,
    selectedFlowId: selectedFlow?.id,
    selectedStepId: selectedStep?.stepId,
    selectedStepNodeId: selectedStep?.nodeId,
  };
}

export function createLayoutEngine(): LayoutEngine {
  return { atlas: createAtlasScene, layout: layoutGraph };
}
