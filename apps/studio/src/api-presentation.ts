import type {
  ApiEndpointNode,
  ApplicationGraph,
  FlowTransition,
  InferredFlow,
  ScreenNode,
} from "@topo/schema";

export type ApiEndpointOrigin = "source" | "contract" | "mixed";

export interface ApiEndpointUsage {
  sourceScreens: ScreenNode[];
  inferredFlows: InferredFlow[];
  transitions: FlowTransition[];
}

/**
 * Keep API presentation derived from the canonical graph. The UI can show
 * relationships without inventing a second endpoint-usage record.
 */
export function describeApiEndpointUsage(
  endpoint: ApiEndpointNode,
  graph: ApplicationGraph,
): ApiEndpointUsage {
  const transitions = graph.flowTransitions.filter((transition) => {
    if (transition.target.kind !== "api-endpoint") return false;
    if (transition.target.endpointId === endpoint.id) return true;
    return (
      transition.target.method === endpoint.method &&
      transition.target.path === endpoint.path
    );
  });
  const screensById = new Map(
    graph.screens.map((screen) => [screen.id, screen] as const),
  );
  const sourceScreens = Array.from(
    new Set(transitions.map((transition) => transition.sourceScreenId)),
  )
    .map((screenId) => screensById.get(screenId))
    .filter((screen): screen is ScreenNode => Boolean(screen));
  const inferredFlows = graph.inferredFlows.filter((flow) =>
    flow.steps.some(
      (step) =>
        step.endpointId === endpoint.id ||
        (step.kind === "api-endpoint" &&
          step.title.includes(`${endpoint.method} ${endpoint.path}`)),
    ),
  );

  return { inferredFlows, sourceScreens, transitions };
}

export function apiEndpointOrigin(
  endpoint: Pick<ApiEndpointNode, "discoveries">,
): ApiEndpointOrigin {
  const hasContract = endpoint.discoveries.some(
    (discovery) => discovery.kind === "openapi",
  );
  const hasSource = endpoint.discoveries.some(
    (discovery) => discovery.kind !== "openapi",
  );
  if (hasContract && hasSource) return "mixed";
  return hasContract ? "contract" : "source";
}

export function apiEndpointOriginLabel(origin: ApiEndpointOrigin): string {
  switch (origin) {
    case "contract":
      return "Contract";
    case "mixed":
      return "Source + contract";
    case "source":
      return "Source-backed";
  }
}

/** Group by the first meaningful API domain instead of putting every route in /api. */
export function apiEndpointGroup(
  endpoint: Pick<ApiEndpointNode, "path">,
): string {
  const segments = endpoint.path.split("/").filter(Boolean);
  if (segments[0] === "api" && segments[1]) {
    return `api/${segments[1]}`;
  }
  return segments[0] ?? "root";
}
