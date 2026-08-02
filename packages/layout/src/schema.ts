import { z } from "zod";

import {
  ComponentNodeSchema,
  FlowStatusSchema,
  GraphEdgeSchema,
  ScreenNodeSchema,
  SourceLocationSchema,
} from "@topo/schema";

const CanvasPointSchema = z.object({ x: z.number(), y: z.number() });
const CanvasBoundsSchema = CanvasPointSchema.extend({
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
const CanvasScreenSchema = ScreenNodeSchema.extend({
  position: CanvasPointSchema,
  width: z.number().positive(),
  height: z.number().positive(),
});
const RouteDistrictMetadataSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  source: z.enum(["automatic", "configured"]),
  routePrefix: z.string().min(1),
  routePrefixes: z.array(z.string().startsWith("/")).min(1),
  order: z.number().int().nonnegative(),
  screenIds: z.array(z.string().min(1)),
  routeCount: z.number().int().nonnegative(),
  screenCount: z.number().int().nonnegative(),
  stateCount: z.number().int().nonnegative(),
  dynamicRouteCount: z.number().int().nonnegative(),
  maxDepth: z.number().int().nonnegative(),
});
const CanvasGroupSchema = RouteDistrictMetadataSchema.extend({
  position: CanvasPointSchema,
  width: z.number().positive(),
  height: z.number().positive(),
});

export const AtlasConnectionSchema = GraphEdgeSchema.extend({
  sourceRouteId: z.string().min(1),
  sourcePoint: CanvasPointSchema,
  targetRouteId: z.string().min(1),
  targetPoint: CanvasPointSchema,
});

const RouteRenderStatusCountsSchema = z.object({
  unseen: z.number().int().nonnegative(),
  captured: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});

const AtlasRouteNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  routePath: z.string().min(1),
  depth: z.number().int().nonnegative(),
  dynamic: z.boolean(),
  primaryScreenId: z.string().min(1),
  screenIds: z.array(z.string().min(1)).min(1),
  adapterIds: z.array(z.string().min(1)),
  states: z.array(z.string().min(1)).min(1),
  sourceFilePaths: z.array(z.string().min(1)).min(1),
  renderStatusCounts: RouteRenderStatusCountsSchema,
  parentRouteId: z.string().min(1).optional(),
  childRouteIds: z.array(z.string().min(1)),
  hierarchyLevel: z.number().int().nonnegative(),
  position: CanvasPointSchema,
  width: z.number().positive(),
  height: z.number().positive(),
});

const AtlasRouteGroupSchema = RouteDistrictMetadataSchema.extend({
  routeNodeIds: z.array(z.string().min(1)),
  renderStatusCounts: RouteRenderStatusCountsSchema,
  layoutMode: z.enum(["grid", "hierarchy"]),
  position: CanvasPointSchema,
  width: z.number().positive(),
  height: z.number().positive(),
});

const AtlasRouteSectionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  source: z.enum(["automatic", "configured", "mixed"]),
  routePrefixes: z.array(z.string().startsWith("/")).min(1),
  order: z.number().int().nonnegative(),
  groupIds: z.array(z.string().min(1)).min(1),
  routeNodeIds: z.array(z.string().min(1)).min(1),
  screenIds: z.array(z.string().min(1)).min(1),
  routeCount: z.number().int().nonnegative(),
  screenCount: z.number().int().nonnegative(),
  stateCount: z.number().int().nonnegative(),
  dynamicRouteCount: z.number().int().nonnegative(),
  renderStatusCounts: RouteRenderStatusCountsSchema,
  position: CanvasPointSchema,
  width: z.number().positive(),
  height: z.number().positive(),
});

export const AtlasSceneSchema = z.object({
  version: z.literal(4),
  bounds: CanvasBoundsSchema,
  connections: z.array(AtlasConnectionSchema),
  layout: z.object({
    screens: z.array(CanvasScreenSchema),
    groups: z.array(CanvasGroupSchema),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
  routeMap: z.object({
    bounds: CanvasBoundsSchema,
    sections: z.array(AtlasRouteSectionSchema),
    groups: z.array(AtlasRouteGroupSchema),
    hierarchyConnections: z.array(
      z.object({
        id: z.string().min(1),
        groupId: z.string().min(1),
        parentRouteId: z.string().min(1),
        childRouteId: z.string().min(1),
        sourcePoint: CanvasPointSchema,
        targetPoint: CanvasPointSchema,
      }),
    ),
    routes: z.array(AtlasRouteNodeSchema),
  }),
  selectedBounds: CanvasBoundsSchema,
  selectedGroupBounds: CanvasBoundsSchema,
  selectedSectionBounds: CanvasBoundsSchema,
  selectedScreenId: z.string().min(1).optional(),
});

export const ComponentSceneSchema = z.object({
  version: z.literal(2),
  bounds: CanvasBoundsSchema,
  components: z.array(
    ComponentNodeSchema.extend({
      groupId: z.string().min(1),
      position: CanvasPointSchema,
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
  groups: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      source: z.enum(["automatic", "configured"]),
      sourcePrefix: z.string().min(1),
      sourcePrefixes: z.array(z.string().min(1)).min(1),
      order: z.number().int().nonnegative(),
      componentIds: z.array(z.string().min(1)),
      componentCount: z.number().int().nonnegative(),
      routeUsageCount: z.number().int().nonnegative(),
      previewCount: z.number().int().nonnegative(),
      previewStatusCounts: z.object({
        renderable: z.number().int().nonnegative(),
        missing: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
      }),
      position: CanvasPointSchema,
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
  routeNodes: z.array(
    z.object({
      id: z.string().min(1),
      screenId: z.string().min(1),
      title: z.string().min(1),
      routePath: z.string().min(1).optional(),
      source: SourceLocationSchema.optional(),
      resolution: z.enum(["resolved", "unresolved"]),
      position: CanvasPointSchema,
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
  connections: z.array(
    z.object({
      id: z.string().min(1),
      sourceComponentId: z.string().min(1),
      targetRouteNodeId: z.string().min(1),
      targetScreenId: z.string().min(1),
      resolution: z.enum(["resolved", "unresolved"]),
      sourcePoint: CanvasPointSchema,
      targetPoint: CanvasPointSchema,
    }),
  ),
  selectedBounds: CanvasBoundsSchema,
  selectedGroupBounds: CanvasBoundsSchema,
  selectedComponentId: z.string().min(1).optional(),
  selectedGroupId: z.string().min(1).optional(),
});

export const FlowSceneSchema = z.object({
  version: z.literal(1),
  bounds: CanvasBoundsSchema,
  lanes: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string(),
      status: FlowStatusSchema,
      stepNodeIds: z.array(z.string().min(1)),
      breakCount: z.number().int().nonnegative(),
      position: CanvasPointSchema,
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
  steps: z.array(
    z.object({
      nodeId: z.string().min(1),
      flowId: z.string().min(1),
      stepId: z.string().min(1),
      order: z.number().int().nonnegative(),
      title: z.string().min(1),
      routePath: z.string().min(1).optional(),
      screenId: z.string().min(1).optional(),
      resolvedScreenId: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      expected: z.string().min(1).optional(),
      noteIds: z.array(z.string().min(1)),
      nextStepIds: z.array(z.string().min(1)),
      resolution: z.enum(["resolved", "unresolved", "unbound"]),
      position: CanvasPointSchema,
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
  connections: z.array(
    z.object({
      id: z.string().min(1),
      flowId: z.string().min(1),
      sourceNodeId: z.string().min(1),
      sourceStepId: z.string().min(1),
      targetNodeId: z.string().min(1),
      targetStepId: z.string().min(1),
      action: z.string().min(1).optional(),
      status: z.enum(["resolved", "broken"]),
      sourcePoint: CanvasPointSchema,
      targetPoint: CanvasPointSchema,
    }),
  ),
  focusFlowIds: z.array(z.string().min(1)),
  selectedBounds: CanvasBoundsSchema,
  selectedFlowId: z.string().min(1).optional(),
  selectedStepId: z.string().min(1).optional(),
  selectedStepNodeId: z.string().min(1).optional(),
});
