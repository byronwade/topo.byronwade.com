import type {
  ApplicationGraph,
  AtlasOrganization,
  ComponentNode,
  ScreenNode,
} from "@topo/schema";

export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * Renderer-independent viewport state.
 *
 * Every Topo canvas uses the same transform: screen = world * zoom + offset.
 * Keeping this contract outside Pixi and React lets alternate renderers and
 * automation clients reproduce the exact viewport without reading UI state.
 */
export interface CanvasCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasBounds extends CanvasPoint {
  width: number;
  height: number;
}

export interface CanvasViewportSize {
  width: number;
  height: number;
}

export interface CanvasViewportItem extends CanvasBounds {
  id: string;
  alwaysVisible?: boolean;
}

export interface CanvasViewportSelectionOptions {
  /** Extra screen pixels retained around the viewport to avoid pan-edge churn. */
  overscan?: number;
}

export interface CanvasVisibilityDelta {
  visible: Set<string>;
  entered: string[];
  exited: string[];
}

export type CanvasFitAlignment = "start" | "center" | "end";

export interface FitCanvasOptions {
  /** Position fitted content on each axis when its scaled size leaves room. */
  alignX?: CanvasFitAlignment;
  alignY?: CanvasFitAlignment;
  maxZoom?: number;
  minZoom?: number;
  padding?: number;
}

export const DEFAULT_CANVAS_MIN_ZOOM = 0.1;
export const DEFAULT_CANVAS_MAX_ZOOM = 4;

/**
 * Select world-space items that intersect a camera viewport.
 *
 * Input order is retained so layout identity stays deterministic. Overscan is
 * expressed in screen pixels and converted through the current zoom.
 */
export function selectVisibleCanvasItems<TItem extends CanvasViewportItem>(
  items: readonly TItem[],
  camera: CanvasCamera,
  viewport: CanvasViewportSize,
  options: CanvasViewportSelectionOptions = {},
): TItem[] {
  const zoom = Math.max(Number.EPSILON, camera.zoom);
  const worldOverscan = Math.max(0, options.overscan ?? 0) / zoom;
  const left = -camera.x / zoom - worldOverscan;
  const top = -camera.y / zoom - worldOverscan;
  const right = (viewport.width - camera.x) / zoom + worldOverscan;
  const bottom = (viewport.height - camera.y) / zoom + worldOverscan;

  return items.filter(
    (item) =>
      item.alwaysVisible === true ||
      (item.x + item.width >= left &&
        item.x <= right &&
        item.y + item.height >= top &&
        item.y <= bottom),
  );
}

/** Return the minimal visibility mutations between two deterministic views. */
export function diffCanvasVisibility<TItem extends { id: string }>(
  previous: ReadonlySet<string>,
  nextItems: readonly TItem[],
): CanvasVisibilityDelta {
  const visible = new Set(nextItems.map((item) => item.id));
  const entered = nextItems
    .filter((item) => !previous.has(item.id))
    .map((item) => item.id);
  const exited = [...previous].filter((id) => !visible.has(id));
  return { visible, entered, exited };
}

export function clampCanvasZoom(
  zoom: number,
  minZoom = DEFAULT_CANVAS_MIN_ZOOM,
  maxZoom = DEFAULT_CANVAS_MAX_ZOOM,
): number {
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

/** Zoom while preserving the world point beneath the supplied screen point. */
export function zoomCanvasAt(
  camera: CanvasCamera,
  nextZoom: number,
  screenPoint: CanvasPoint,
  minZoom = DEFAULT_CANVAS_MIN_ZOOM,
  maxZoom = DEFAULT_CANVAS_MAX_ZOOM,
): CanvasCamera {
  const zoom = clampCanvasZoom(nextZoom, minZoom, maxZoom);
  const worldX = (screenPoint.x - camera.x) / camera.zoom;
  const worldY = (screenPoint.y - camera.y) / camera.zoom;

  return {
    x: screenPoint.x - worldX * zoom,
    y: screenPoint.y - worldY * zoom,
    zoom,
  };
}

export function panCanvasBy(
  camera: CanvasCamera,
  delta: CanvasPoint,
): CanvasCamera {
  return {
    ...camera,
    x: camera.x + delta.x,
    y: camera.y + delta.y,
  };
}

function alignedCanvasOffset(
  viewportSize: number,
  contentSize: number,
  padding: number,
  alignment: CanvasFitAlignment,
): number {
  if (alignment === "start") return padding;
  if (alignment === "end") return viewportSize - contentSize - padding;
  return (viewportSize - contentSize) / 2;
}

/** Fit world-space bounds into a viewport with deterministic axis alignment. */
export function fitCanvasBounds(
  bounds: CanvasBounds,
  viewport: CanvasViewportSize,
  options: FitCanvasOptions = {},
): CanvasCamera {
  const padding = Math.max(0, options.padding ?? 32);
  const minZoom = options.minZoom ?? DEFAULT_CANVAS_MIN_ZOOM;
  const maxZoom = options.maxZoom ?? DEFAULT_CANVAS_MAX_ZOOM;
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const safeWidth = Math.max(1, bounds.width);
  const safeHeight = Math.max(1, bounds.height);
  const zoom = clampCanvasZoom(
    Math.min(availableWidth / safeWidth, availableHeight / safeHeight),
    minZoom,
    maxZoom,
  );
  const scaledWidth = safeWidth * zoom;
  const scaledHeight = safeHeight * zoom;

  return {
    x:
      alignedCanvasOffset(
        viewport.width,
        scaledWidth,
        padding,
        options.alignX ?? "center",
      ) -
      bounds.x * zoom,
    y:
      alignedCanvasOffset(
        viewport.height,
        scaledHeight,
        padding,
        options.alignY ?? "center",
      ) -
      bounds.y * zoom,
    zoom,
  };
}

export interface CanvasScreen extends ScreenNode {
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface CanvasGroup {
  id: string;
  label: string;
  source: "automatic" | "configured";
  /** Exact route prefix or framework group represented by this district. */
  routePrefix: string;
  /** Every configured route prefix represented by this district. */
  routePrefixes: string[];
  /** Stable, zero-based reading order used by renderers and agents. */
  order: number;
  /** Exact screen membership; no geometry inference is required by clients. */
  screenIds: string[];
  routeCount: number;
  screenCount: number;
  stateCount: number;
  dynamicRouteCount: number;
  maxDepth: number;
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface RouteDistrict {
  id: string;
  label: string;
  source: "automatic" | "configured";
  routePrefix: string;
  routePrefixes: string[];
  screens: ScreenNode[];
  /** Unique route families in deterministic reading order. */
  routes: RouteFamily[];
  routeCount: number;
  screenCount: number;
  stateCount: number;
  dynamicRouteCount: number;
  maxDepth: number;
  renderStatusCounts: RouteRenderStatusCounts;
}

export interface RouteSection {
  /** Stable derived identity used by Studio and machine-readable atlas scenes. */
  id: string;
  label: string;
  source: "automatic" | "configured" | "mixed";
  /** Every canonical prefix represented by the section's districts. */
  routePrefixes: string[];
  /** Stable reading order independent of renderer geometry. */
  order: number;
  districtIds: string[];
  districts: RouteDistrict[];
  screenIds: string[];
  routeCount: number;
  screenCount: number;
  stateCount: number;
  dynamicRouteCount: number;
  renderStatusCounts: RouteRenderStatusCounts;
}

export interface RouteRenderStatusCounts {
  unseen: number;
  captured: number;
  live: number;
  blocked: number;
}

export interface ComponentPreviewStatusCounts {
  renderable: number;
  missing: number;
  blocked: number;
  unknown: number;
}

/**
 * One deterministic source-domain collection shared by Studio, scene readers,
 * and LLM context. Geometry is deliberately absent from this read model.
 */
export interface ComponentGroup {
  id: string;
  label: string;
  source: "automatic" | "configured";
  sourcePrefix: string;
  sourcePrefixes: string[];
  order: number;
  componentIds: string[];
  components: ComponentNode[];
  componentCount: number;
  routeUsageCount: number;
  previewCount: number;
  previewStatusCounts: ComponentPreviewStatusCounts;
}

export interface RouteFamily {
  /** Stable route-path identity independent of screen-state count. */
  id: string;
  label: string;
  routePath: string;
  depth: number;
  dynamic: boolean;
  primaryScreenId: string;
  screenIds: string[];
  /** Exact route-discovery adapters represented by this route family. */
  adapterIds: string[];
  states: string[];
  sourceFilePaths: string[];
  renderStatusCounts: RouteRenderStatusCounts;
  /** Nearest canonical ancestor route present in this district. */
  parentRouteId?: string;
  /** Canonical descendants whose nearest present ancestor is this route. */
  childRouteIds: string[];
  /** Zero-based depth inside the visible district hierarchy. */
  hierarchyLevel: number;
}

export interface CanvasLayout {
  screens: CanvasScreen[];
  groups: CanvasGroup[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  columnGap?: number;
  groupGap?: number;
  groupHeaderHeight?: number;
  maxGroupsPerRow?: number;
  maxRowsPerColumn?: number;
  nodeGap?: number;
  nodeHeight?: number;
  nodeWidth?: number;
  padding?: number;
  /** Preferred world-space row width. Oversized districts keep their own row. */
  targetRowWidth?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  columnGap: 72,
  groupGap: 36,
  groupHeaderHeight: 42,
  maxGroupsPerRow: Number.MAX_SAFE_INTEGER,
  maxRowsPerColumn: Number.MAX_SAFE_INTEGER,
  nodeGap: 24,
  nodeHeight: 112,
  nodeWidth: 248,
  padding: 48,
  targetRowWidth: Number.MAX_SAFE_INTEGER,
};

const ROUTE_STATE_ORDER = ["default", "loading", "error", "not-found"] as const;

function routeSegments(routePath: string): string[] {
  return routePath.split("/").filter(Boolean);
}

export function routeDepth(routePath: string): number {
  return routeSegments(routePath).length;
}

export function isDynamicRoutePath(routePath: string): boolean {
  return routeSegments(routePath).some(
    (segment) =>
      /^\[.+\]$/.test(segment) ||
      segment.startsWith(":") ||
      segment.startsWith("$"),
  );
}

function segmentRank(segment: string): number {
  if (/^\[\.\.\..+\]$/.test(segment) || segment.startsWith("$...")) {
    return 2;
  }
  if (
    /^\[.+\]$/.test(segment) ||
    segment.startsWith(":") ||
    segment.startsWith("$")
  ) {
    return 1;
  }
  return 0;
}

// Natural sorting is exercised repeatedly while building both the visual
// atlas and its LLM read model. Constructing locale comparison options inside
// each comparator dominates large workloads, so retain one immutable collator
// for the lifetime of the local process.
const NATURAL_TEXT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareRoutePaths(left: string, right: string): number {
  const leftSegments = routeSegments(left);
  const rightSegments = routeSegments(right);
  const sharedLength = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftSegment = leftSegments[index]!;
    const rightSegment = rightSegments[index]!;
    const rank = segmentRank(leftSegment) - segmentRank(rightSegment);
    if (rank !== 0) return rank;
    const lexical = NATURAL_TEXT_COLLATOR.compare(leftSegment, rightSegment);
    if (lexical !== 0) return lexical;
  }
  return leftSegments.length - rightSegments.length;
}

function stateRank(state: string): number {
  const index = ROUTE_STATE_ORDER.indexOf(
    state as (typeof ROUTE_STATE_ORDER)[number],
  );
  return index === -1 ? ROUTE_STATE_ORDER.length : index;
}

export function compareRouteScreens(
  left: ScreenNode,
  right: ScreenNode,
): number {
  return (
    compareRoutePaths(left.routePath, right.routePath) ||
    stateRank(left.state) - stateRank(right.state) ||
    left.state.localeCompare(right.state) ||
    left.id.localeCompare(right.id)
  );
}

export function routeDistrictLabel(groupId: string): string {
  if (groupId === "/") return "Entry";
  const leaf = routeSegments(groupId).at(-1) ?? groupId;
  const unwrapped = leaf.replace(/^\((.*)\)$/, "$1").replace(/^@/, "");
  return unwrapped
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function normalizeComponentSourcePath(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^\//, "");
}

function automaticComponentPrefix(filePath: string): string {
  const segments = normalizeComponentSourcePath(filePath).split("/");
  const directories = segments.slice(0, -1);
  if (directories.length === 0) return ".";

  const sourceOffset = directories[0] === "src" ? 1 : 0;
  const root = directories[sourceOffset];
  const prefixThrough = (index: number) =>
    directories.slice(0, Math.min(index + 1, directories.length)).join("/");

  if (["features", "domains", "modules"].includes(root ?? "")) {
    return prefixThrough(
      sourceOffset + (directories[sourceOffset + 1] ? 1 : 0),
    );
  }

  if (["app", "pages", "routes"].includes(root ?? "")) {
    const domainIndex = directories.findIndex(
      (segment, index) =>
        index > sourceOffset &&
        !/^\(.*\)$/.test(segment) &&
        !segment.startsWith("@") &&
        !/^\[.*\]$/.test(segment) &&
        !["components", "_components"].includes(segment),
    );
    return prefixThrough(domainIndex >= 0 ? domainIndex : sourceOffset);
  }

  if (root === "components") {
    return prefixThrough(
      directories[sourceOffset + 1] ? sourceOffset + 1 : sourceOffset,
    );
  }

  if (["shared", "common"].includes(root ?? "")) {
    const next = directories[sourceOffset + 1];
    return prefixThrough(next ? sourceOffset + 1 : sourceOffset);
  }

  return prefixThrough(sourceOffset);
}

function componentGroupLabel(sourcePrefix: string): string {
  if (sourcePrefix === ".") return "Root components";
  const segments = sourcePrefix.split("/").filter(Boolean);
  const leaf = [...segments]
    .reverse()
    .find(
      (segment) =>
        !["components", "_components", "shared", "common"].includes(segment),
    );
  if (!leaf) return "Shared components";
  if (leaf.toLowerCase() === "ui") return "UI";
  if (leaf.toLowerCase() === "api") return "API";
  return routeDistrictLabel(`/${leaf}`);
}

function emptyComponentPreviewStatusCounts(): ComponentPreviewStatusCounts {
  return { renderable: 0, missing: 0, blocked: 0, unknown: 0 };
}

function countComponentPreviewStatuses(
  components: readonly ComponentNode[],
): ComponentPreviewStatusCounts {
  const counts = emptyComponentPreviewStatusCounts();
  for (const component of components) counts[component.previewStatus] += 1;
  return counts;
}

const COMPONENT_ATTENTION_ORDER: ComponentNode["previewStatus"][] = [
  "blocked",
  "missing",
  "unknown",
  "renderable",
];
const COMPONENT_ATTENTION_RANK = new Map(
  COMPONENT_ATTENTION_ORDER.map((status, index) => [status, index]),
);

function compareComponents(left: ComponentNode, right: ComponentNode): number {
  return (
    (COMPONENT_ATTENTION_RANK.get(left.previewStatus) ??
      COMPONENT_ATTENTION_ORDER.length) -
      (COMPONENT_ATTENTION_RANK.get(right.previewStatus) ??
        COMPONENT_ATTENTION_ORDER.length) ||
    NATURAL_TEXT_COLLATOR.compare(left.name, right.name) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Organize components into project-owned or automatic source domains.
 * Configured prefixes use deterministic longest-prefix ownership. Automatic
 * groups recognize common feature, route, shared, and component folder shapes
 * without depending on a framework adapter.
 */
export function createComponentGroups(
  components: readonly ComponentNode[],
  organization?: AtlasOrganization,
): ComponentGroup[] {
  const configuredGroups = organization?.componentGroups ?? {};
  const configuredClaims = Object.entries(configuredGroups)
    .flatMap(([id, rule]) =>
      rule.prefixes.map((prefix) => ({ id, prefix, rule })),
    )
    .sort(
      (left, right) =>
        right.prefix.length - left.prefix.length ||
        left.rule.order - right.rule.order ||
        left.id.localeCompare(right.id),
    );
  const grouped = new Map<
    string,
    {
      configuredId?: string;
      sourcePrefix: string;
      components: ComponentNode[];
    }
  >();

  for (const component of components) {
    const sourcePath = normalizeComponentSourcePath(component.source.filePath);
    const configured = configuredClaims.find(
      ({ prefix }) =>
        sourcePath === prefix || sourcePath.startsWith(`${prefix}/`),
    );
    const sourcePrefix =
      configured?.prefix ?? automaticComponentPrefix(sourcePath);
    const key = configured
      ? `configured:${configured.id}`
      : `source:${sourcePrefix}`;
    const current = grouped.get(key) ?? {
      ...(configured ? { configuredId: configured.id } : {}),
      sourcePrefix,
      components: [],
    };
    current.components.push(component);
    grouped.set(key, current);
  }

  const seeds = [...grouped.entries()].map(([key, value]) => {
    const configured = value.configuredId
      ? configuredGroups[value.configuredId]
      : undefined;
    const ordered = [...value.components].sort(compareComponents);
    const routeUsage = new Set(
      ordered.flatMap((component) => component.usedBy),
    );
    return {
      id: configured
        ? `component-group:${value.configuredId}`
        : `component-${key}`,
      label: configured?.label ?? componentGroupLabel(value.sourcePrefix),
      source: configured ? ("configured" as const) : ("automatic" as const),
      sourcePrefix: configured?.prefixes[0] ?? value.sourcePrefix,
      sourcePrefixes: configured?.prefixes ?? [value.sourcePrefix],
      configuredOrder: configured?.order,
      components: ordered,
      componentIds: ordered.map((component) => component.id),
      componentCount: ordered.length,
      routeUsageCount: routeUsage.size,
      previewCount: ordered.reduce(
        (count, component) => count + component.previewSources.length,
        0,
      ),
      previewStatusCounts: countComponentPreviewStatuses(ordered),
    };
  });

  return seeds
    .sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "configured" ? -1 : 1;
      }
      if (
        left.configuredOrder !== undefined &&
        right.configuredOrder !== undefined
      ) {
        return (
          left.configuredOrder - right.configuredOrder ||
          left.id.localeCompare(right.id)
        );
      }
      return (
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }) || left.id.localeCompare(right.id)
      );
    })
    .map(({ configuredOrder: _configuredOrder, ...group }, order) => ({
      ...group,
      order,
    }));
}

function emptyRenderStatusCounts(): RouteRenderStatusCounts {
  return { unseen: 0, captured: 0, live: 0, blocked: 0 };
}

function countRenderStatuses(
  screens: readonly ScreenNode[],
): RouteRenderStatusCounts {
  const counts = emptyRenderStatusCounts();
  for (const screen of screens) counts[screen.renderStatus] += 1;
  return counts;
}

function routeFamilyLabel(routePath: string, primary: ScreenNode): string {
  if (routePath === "/") return primary.title || "Home";
  const segment = routeSegments(routePath).at(-1);
  if (!segment) return primary.title;
  if (isDynamicRoutePath(`/${segment}`)) return segment;
  return primary.title || routeDistrictLabel(`/${segment}`);
}

interface ScreenRouteFamily {
  routePath: string;
  screens: ScreenNode[];
}

function createScreenRouteFamilies(
  screens: readonly ScreenNode[],
): ScreenRouteFamily[] {
  const grouped = new Map<string, ScreenNode[]>();
  for (const screen of screens) {
    const family = grouped.get(screen.routePath) ?? [];
    family.push(screen);
    grouped.set(screen.routePath, family);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => compareRoutePaths(left, right))
    .map(([routePath, familyScreens]) => ({
      routePath,
      screens: [...familyScreens].sort(compareRouteScreens),
    }));
}

function nearestPresentParentRouteId(
  routePath: string,
  routeIdByPath: ReadonlyMap<string, string>,
): string | undefined {
  const segments = routeSegments(routePath);
  for (let length = segments.length - 1; length >= 0; length -= 1) {
    const candidate =
      length === 0 ? "/" : `/${segments.slice(0, length).join("/")}`;
    const routeId = routeIdByPath.get(candidate);
    if (routeId) return routeId;
  }
  return undefined;
}

function linkRouteFamilyHierarchy(
  unlinkedRoutes: readonly Omit<
    RouteFamily,
    "parentRouteId" | "childRouteIds" | "hierarchyLevel"
  >[],
): RouteFamily[] {
  const routeIdByPath = new Map(
    unlinkedRoutes.map((route) => [route.routePath, route.id]),
  );
  const parentById = new Map(
    unlinkedRoutes.map((route) => [
      route.id,
      nearestPresentParentRouteId(route.routePath, routeIdByPath),
    ]),
  );
  const childrenById = new Map<string, string[]>();
  for (const route of unlinkedRoutes) childrenById.set(route.id, []);
  for (const route of unlinkedRoutes) {
    const parentId = parentById.get(route.id);
    if (parentId) childrenById.get(parentId)?.push(route.id);
  }
  const levelById = new Map<string, number>();
  const hierarchyLevel = (routeId: string): number => {
    const cached = levelById.get(routeId);
    if (cached !== undefined) return cached;
    const parentId = parentById.get(routeId);
    const level = parentId ? hierarchyLevel(parentId) + 1 : 0;
    levelById.set(routeId, level);
    return level;
  };

  return unlinkedRoutes.map((route) => {
    const parentRouteId = parentById.get(route.id);
    return {
      ...route,
      ...(parentRouteId ? { parentRouteId } : {}),
      childRouteIds: childrenById.get(route.id) ?? [],
      hierarchyLevel: hierarchyLevel(route.id),
    };
  });
}

function createRouteFamilies(screens: readonly ScreenNode[]): RouteFamily[] {
  const routes = createScreenRouteFamilies(screens).map(
    ({ routePath, screens: ordered }) => {
      const primary =
        ordered.find((screen) => screen.state === "default") ?? ordered[0]!;
      return {
        id: `route:${routePath}`,
        label: routeFamilyLabel(routePath, primary),
        routePath,
        depth: routeDepth(routePath),
        dynamic: isDynamicRoutePath(routePath),
        primaryScreenId: primary.id,
        screenIds: ordered.map((screen) => screen.id),
        adapterIds: [
          ...new Set(
            ordered.flatMap((screen) =>
              screen.adapterId ? [screen.adapterId] : [],
            ),
          ),
        ].sort(),
        states: ordered.map((screen) => screen.state),
        sourceFilePaths: [
          ...new Set(ordered.map((screen) => screen.source.filePath)),
        ],
        renderStatusCounts: countRenderStatuses(ordered),
      };
    },
  );
  return linkRouteFamilyHierarchy(routes);
}

function createRouteDistrictRecord(
  id: string,
  districtScreens: ScreenNode[],
  options: {
    label?: string;
    routePrefix?: string;
    routePrefixes?: string[];
    source?: RouteDistrict["source"];
  } = {},
): RouteDistrict {
  const routes = createRouteFamilies(districtScreens);
  return {
    id,
    label: options.label ?? routeDistrictLabel(id),
    source: options.source ?? "automatic",
    routePrefix: options.routePrefix ?? id,
    routePrefixes: options.routePrefixes ?? [id],
    screens: districtScreens,
    routes,
    routeCount: routes.length,
    screenCount: districtScreens.length,
    stateCount: districtScreens.filter((screen) => screen.state !== "default")
      .length,
    dynamicRouteCount: routes.filter((route) => route.dynamic).length,
    maxDepth: Math.max(
      0,
      ...districtScreens.map((screen) => routeDepth(screen.routePath)),
    ),
    renderStatusCounts: countRenderStatuses(districtScreens),
  };
}

const AUTOMATIC_DISTRICT_SPLIT_THRESHOLD = 12;
const AUTOMATIC_DISTRICT_MIN_NESTED_AREAS = 3;

function splitOversizedAutomaticDistrict(
  district: RouteDistrict,
): RouteDistrict[] {
  if (
    district.source !== "automatic" ||
    district.routeCount <= AUTOMATIC_DISTRICT_SPLIT_THRESHOLD ||
    !district.routePrefix.startsWith("/")
  ) {
    return [district];
  }

  const baseSegments = routeSegments(district.routePrefix);
  const routesByNestedPrefix = new Map<string, RouteFamily[]>();
  const parentRoutes: RouteFamily[] = [];
  for (const route of district.routes) {
    const segments = routeSegments(route.routePath);
    const isInsideBase = baseSegments.every(
      (segment, index) => segments[index] === segment,
    );
    if (!isInsideBase || segments.length <= baseSegments.length) {
      parentRoutes.push(route);
      continue;
    }
    const prefix = `/${segments.slice(0, baseSegments.length + 1).join("/")}`;
    routesByNestedPrefix.set(prefix, [
      ...(routesByNestedPrefix.get(prefix) ?? []),
      route,
    ]);
  }

  const nestedAreas = [...routesByNestedPrefix.entries()].filter(
    ([, routes]) => routes.length >= 2,
  );
  if (nestedAreas.length < AUTOMATIC_DISTRICT_MIN_NESTED_AREAS) {
    return [district];
  }

  const screenById = new Map(
    district.screens.map((screen) => [screen.id, screen]),
  );
  const nestedPrefixes = new Set(nestedAreas.map(([prefix]) => prefix));
  const parentAndSingletonRoutes = [
    ...parentRoutes,
    ...[...routesByNestedPrefix.entries()]
      .filter(([prefix]) => !nestedPrefixes.has(prefix))
      .flatMap(([, routes]) => routes),
  ];
  const screensForRoutes = (routes: readonly RouteFamily[]) =>
    routes.flatMap((route) =>
      route.screenIds.flatMap((screenId) => {
        const screen = screenById.get(screenId);
        return screen ? [screen] : [];
      }),
    );
  const nestedDistricts = nestedAreas
    .sort(([left], [right]) => compareRoutePaths(left, right))
    .map(([prefix, routes]) =>
      createRouteDistrictRecord(
        `automatic:${prefix}`,
        screensForRoutes(routes),
        {
          label: routeDistrictLabel(prefix),
          routePrefix: prefix,
          routePrefixes: [prefix],
        },
      ),
    );
  const parentDistrict = createRouteDistrictRecord(
    district.id,
    screensForRoutes(parentAndSingletonRoutes),
    {
      label: district.label,
      routePrefix: district.routePrefix,
      routePrefixes: district.routePrefixes,
    },
  );
  return parentDistrict.routeCount > 0
    ? [parentDistrict, ...nestedDistricts]
    : nestedDistricts;
}

/**
 * Build the deterministic route read model shared by layout, Studio navigation,
 * daemon scenes, and MCP. Route families remain adjacent, static siblings sort
 * before dynamic siblings, and every group carries exact membership metadata.
 */
export function createRouteDistricts(
  screens: readonly ScreenNode[],
  organization?: AtlasOrganization,
): RouteDistrict[] {
  const grouped = new Map<string, ScreenNode[]>();
  const configuredGroups = organization?.routeGroups ?? {};
  const configuredClaims = Object.entries(configuredGroups)
    .flatMap(([id, rule]) =>
      rule.prefixes.map((prefix) => ({ id, prefix, rule })),
    )
    .sort(
      (left, right) =>
        right.prefix.length - left.prefix.length ||
        left.rule.order - right.rule.order ||
        left.id.localeCompare(right.id),
    );
  for (const family of createScreenRouteFamilies(screens)) {
    const configuredGroup = configuredClaims.find(
      ({ prefix }) =>
        prefix === "/" ||
        family.routePath === prefix ||
        family.routePath.startsWith(`${prefix}/`),
    );
    const primary =
      family.screens.find((screen) => screen.state === "default") ??
      family.screens[0]!;
    const groupId = configuredGroup?.id ?? primary.group;
    const group = grouped.get(groupId) ?? [];
    group.push(...family.screens);
    grouped.set(groupId, group);
  }

  const districts = [...grouped.entries()]
    .map(([id, districtScreens]) => {
      const configured = configuredGroups[id];
      return createRouteDistrictRecord(id, districtScreens, {
        label: configured?.label ?? routeDistrictLabel(id),
        source: configured ? "configured" : "automatic",
        routePrefix: configured?.prefixes[0] ?? id,
        routePrefixes: configured?.prefixes ?? [id],
      });
    })
    .flatMap(splitOversizedAutomaticDistrict);

  return districts.sort((left, right) => {
    if (left.id === "/") return -1;
    if (right.id === "/") return 1;
    const leftConfigured = configuredGroups[left.id];
    const rightConfigured = configuredGroups[right.id];
    if (leftConfigured && rightConfigured) {
      return (
        leftConfigured.order - rightConfigured.order ||
        left.id.localeCompare(right.id)
      );
    }
    if (leftConfigured) return -1;
    if (rightConfigured) return 1;
    const leftEntry = left.screens.some((screen) =>
      screen.tags.includes("entry"),
    );
    const rightEntry = right.screens.some((screen) =>
      screen.tags.includes("entry"),
    );
    if (leftEntry !== rightEntry) return leftEntry ? -1 : 1;
    return compareRoutePaths(left.routePrefix, right.routePrefix);
  });
}

function rootRoutePrefix(routePrefix: string): string {
  const [root] = routeSegments(routePrefix);
  return root ? `/${root}` : "/";
}

function routeSectionSource(
  districts: readonly RouteDistrict[],
): RouteSection["source"] {
  const sources = new Set(districts.map((district) => district.source));
  if (sources.size > 1) return "mixed";
  return districts[0]?.source ?? "automatic";
}

function createRouteSectionRecord(
  id: string,
  label: string,
  districts: readonly RouteDistrict[],
  order: number,
): RouteSection {
  const screens = districts.flatMap((district) => district.screens);
  return {
    id,
    label,
    source: routeSectionSource(districts),
    routePrefixes: [
      ...new Set(districts.flatMap((district) => district.routePrefixes)),
    ],
    order,
    districtIds: districts.map((district) => district.id),
    districts: [...districts],
    screenIds: [...new Set(screens.map((screen) => screen.id))],
    routeCount: districts.reduce(
      (total, district) => total + district.routeCount,
      0,
    ),
    screenCount: districts.reduce(
      (total, district) => total + district.screenCount,
      0,
    ),
    stateCount: districts.reduce(
      (total, district) => total + district.stateCount,
      0,
    ),
    dynamicRouteCount: districts.reduce(
      (total, district) => total + district.dynamicRouteCount,
      0,
    ),
    renderStatusCounts: countRenderStatuses(screens),
  };
}

/**
 * Organize route districts into a small number of deterministic atlas regions.
 *
 * Large automatic domains already split into child districts. Those children
 * are kept beneath their root domain instead of becoming top-level peers. All
 * remaining automatic roots form one Top level region, while configured
 * districts retain their project-owned identity as independent regions.
 */
export function createRouteSections(
  districts: readonly RouteDistrict[],
): RouteSection[] {
  const districtOrder = new Map(
    districts.map((district, index) => [district.id, index]),
  );
  const automatic = districts.filter(
    (district) => district.source === "automatic",
  );
  const automaticByRoot = new Map<string, RouteDistrict[]>();
  for (const district of automatic) {
    const root = rootRoutePrefix(district.routePrefix);
    automaticByRoot.set(root, [...(automaticByRoot.get(root) ?? []), district]);
  }

  const claimed = new Set<string>();
  const sectionSeeds: Array<{
    id: string;
    label: string;
    districts: RouteDistrict[];
    sortOrder: number;
  }> = [];

  for (const [root, rootDistricts] of automaticByRoot) {
    if (root === "/" || rootDistricts.length < 2) continue;
    rootDistricts.forEach((district) => claimed.add(district.id));
    sectionSeeds.push({
      id: `section:${root}`,
      label: routeDistrictLabel(root),
      districts: rootDistricts,
      sortOrder: Math.min(
        ...rootDistricts.map(
          (district) =>
            districtOrder.get(district.id) ?? Number.MAX_SAFE_INTEGER,
        ),
      ),
    });
  }

  const topLevelDistricts = automatic.filter(
    (district) => !claimed.has(district.id),
  );
  if (topLevelDistricts.length > 0) {
    sectionSeeds.push({
      id: "section:top-level",
      label:
        topLevelDistricts.length === 1
          ? topLevelDistricts[0]!.label
          : "Top level",
      districts: topLevelDistricts,
      sortOrder: Math.min(
        ...topLevelDistricts.map(
          (district) =>
            districtOrder.get(district.id) ?? Number.MAX_SAFE_INTEGER,
        ),
      ),
    });
  }

  for (const district of districts.filter(
    (candidate) => candidate.source === "configured",
  )) {
    sectionSeeds.push({
      id: `section:configured:${district.id}`,
      label: district.label,
      districts: [district],
      sortOrder: districtOrder.get(district.id) ?? Number.MAX_SAFE_INTEGER,
    });
  }

  return sectionSeeds
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    )
    .map((seed, order) =>
      createRouteSectionRecord(seed.id, seed.label, seed.districts, order),
    );
}

export function layoutGraph(
  graph: ApplicationGraph,
  options: LayoutOptions = {},
  organization?: AtlasOrganization,
): CanvasLayout {
  return layoutRouteDistricts(
    createRouteDistricts(graph.screens, organization),
    options,
  );
}

/** Project one already-normalized district model into full-size screen space. */
export function layoutRouteDistricts(
  districts: readonly RouteDistrict[],
  options: LayoutOptions = {},
): CanvasLayout {
  const settings = { ...DEFAULTS, ...options };

  const groups: CanvasGroup[] = [];
  const screens: CanvasScreen[] = [];
  let cursorX = settings.padding;
  let cursorY = settings.padding;
  let rowHeight = 0;
  let maxWidth = settings.padding * 2;
  let maxHeight = settings.padding * 2;

  let groupsInRow = 0;
  for (const [groupIndex, district] of districts.entries()) {
    const groupScreens = district.screens;
    const groupsPerRow = Math.max(1, Math.floor(settings.maxGroupsPerRow));
    const rowsPerColumn = Math.max(
      1,
      Math.min(groupScreens.length, Math.floor(settings.maxRowsPerColumn)),
    );
    const columnCount = Math.ceil(groupScreens.length / rowsPerColumn);
    const groupHeight =
      settings.padding +
      settings.groupHeaderHeight +
      rowsPerColumn * settings.nodeHeight +
      Math.max(0, rowsPerColumn - 1) * settings.nodeGap;
    const groupWidth =
      settings.padding * 2 +
      columnCount * settings.nodeWidth +
      Math.max(0, columnCount - 1) * settings.columnGap;
    const exceedsTargetWidth =
      groupsInRow > 0 &&
      cursorX + groupWidth - settings.padding > settings.targetRowWidth;
    if (groupIndex > 0 && (groupsInRow >= groupsPerRow || exceedsTargetWidth)) {
      cursorX = settings.padding;
      cursorY += rowHeight + settings.groupGap;
      rowHeight = 0;
      groupsInRow = 0;
    }
    const groupY = cursorY;

    groups.push({
      id: district.id,
      label: district.label,
      source: district.source,
      routePrefix: district.routePrefix,
      routePrefixes: district.routePrefixes,
      order: groupIndex,
      screenIds: groupScreens.map((screen) => screen.id),
      routeCount: district.routeCount,
      screenCount: district.screenCount,
      stateCount: district.stateCount,
      dynamicRouteCount: district.dynamicRouteCount,
      maxDepth: district.maxDepth,
      position: { x: cursorX, y: groupY },
      width: groupWidth,
      height: groupHeight,
    });

    groupScreens.forEach((screen, index) => {
      const column = Math.floor(index / rowsPerColumn);
      const row = index % rowsPerColumn;
      screens.push({
        ...screen,
        position: {
          x:
            cursorX +
            settings.padding +
            column * (settings.nodeWidth + settings.columnGap),
          y:
            groupY +
            settings.padding +
            settings.groupHeaderHeight +
            row * (settings.nodeHeight + settings.nodeGap),
        },
        width: settings.nodeWidth,
        height: settings.nodeHeight,
      });
    });

    cursorX += groupWidth + settings.groupGap;
    groupsInRow += 1;
    rowHeight = Math.max(rowHeight, groupHeight);
    maxWidth = Math.max(
      maxWidth,
      cursorX - settings.groupGap + settings.padding,
    );
    maxHeight = Math.max(maxHeight, groupY + groupHeight + settings.padding);
  }

  return {
    screens,
    groups,
    width: maxWidth,
    height: maxHeight,
  };
}
