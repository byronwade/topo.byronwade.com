import type {
  AdapterInventoryEntry,
  AdapterInventoryKind,
  AdapterInventoryResponse,
} from "@topo/protocol";

export interface AdapterInventoryGroup {
  kind: AdapterInventoryKind;
  label: string;
  description: string;
  entries: AdapterInventoryEntry[];
}

const GROUPS: Array<
  Omit<AdapterInventoryGroup, "entries">
> = [
  {
    kind: "framework",
    label: "Route discovery",
    description: "Turns framework routing contracts into Topo screens.",
  },
  {
    kind: "flow-discovery",
    label: "Flow discovery",
    description:
      "Finds source-backed navigation, requests, and inferred journeys.",
  },
  {
    kind: "api-endpoint",
    label: "API discovery",
    description: "Finds framework endpoints and declared API contracts.",
  },
  {
    kind: "component-preview",
    label: "Component previews",
    description: "Finds renderable component states and capture URLs.",
  },
  {
    kind: "application-runtime",
    label: "Application runtime",
    description: "Starts the application's native development server.",
  },
];

export function groupAdapterInventory(
  inventory: AdapterInventoryResponse,
): AdapterInventoryGroup[] {
  return GROUPS.map((group) => ({
    ...group,
    entries: inventory.adapters
      .filter((entry) => entry.kind === group.kind)
      .sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          Number(right.registered) - Number(left.registered) ||
          left.displayName.localeCompare(right.displayName),
      ),
  })).filter((group) => group.entries.length > 0);
}

export function presentAdapterStatus(entry: AdapterInventoryEntry): string {
  if (entry.active && entry.kind === "framework") {
    return `Active · ${entry.routeCount} route${entry.routeCount === 1 ? "" : "s"}`;
  }
  if (entry.active && entry.kind === "component-preview") {
    return `Active · ${entry.previewCount} preview${entry.previewCount === 1 ? "" : "s"}`;
  }
  if (entry.active && entry.kind === "flow-discovery") {
    return `Active · ${entry.transitionCount} transition${entry.transitionCount === 1 ? "" : "s"} · ${entry.inferredFlowCount} journey${entry.inferredFlowCount === 1 ? "" : "s"}`;
  }
  if (entry.active && entry.kind === "api-endpoint") {
    return `Active · ${entry.endpointCount} endpoint${entry.endpointCount === 1 ? "" : "s"}`;
  }
  if (entry.active) return "Active";
  return entry.status[0]!.toUpperCase() + entry.status.slice(1);
}
