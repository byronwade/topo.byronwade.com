export {
  findStudioBoard,
  studioBoards,
  studioFrame,
  type StudioBoard,
  type StudioBoardLayout,
  type StudioBoardRenderer,
  type StudioBoardRole,
  type StudioBoardShell,
  type StudioFrameContract,
} from "./boards.js";

export interface StudioDestination {
  label: string;
  description: string;
  path: string;
}

export interface StudioCommand {
  label: string;
  shortcut?: string;
}

export interface StudioDefinition<
  TDestination extends StudioDestination = StudioDestination,
  TCommand extends StudioCommand = StudioCommand,
> {
  defaultDestination: string;
  destinations: Readonly<Record<string, Readonly<TDestination>>>;
  commands: Readonly<Record<string, Readonly<TCommand>>>;
}

export interface StudioDefinitionInput<
  TDestination extends StudioDestination = StudioDestination,
  TCommand extends StudioCommand = StudioCommand,
> {
  extends?: StudioDefinition<TDestination, TCommand>;
  defaultDestination?: string;
  remove?: {
    destinations?: readonly string[];
    commands?: readonly string[];
  };
  destinations?: Record<string, TDestination | false>;
  commands?: Record<string, TCommand | false>;
}

export interface StudioRoute<
  TDestination extends StudioDestination = StudioDestination,
> {
  destinationId: string;
  destination: Readonly<TDestination>;
  view: string;
}

export const STUDIO_SEARCH_KINDS = [
  "route",
  "component",
  "api-endpoint",
  "flow",
  "flow-step",
  "note",
  "finding",
  "interaction",
  "doctor-check",
] as const;

export type StudioSearchKind = (typeof STUDIO_SEARCH_KINDS)[number];

export interface StudioSearchSelection {
  kind:
    | "screen"
    | "component"
    | "api-endpoint"
    | "flow"
    | "flow-step"
    | "note"
    | "finding"
    | "interaction-probe";
  id: string;
  parentId?: string;
}

/** Stable entity identities represented by an addressable Studio view. */
export interface StudioSelectionState {
  screenId?: string;
  flowId?: string;
  flowStepId?: string;
  componentId?: string;
  endpointId?: string;
  previewId?: string;
  noteId?: string;
  findingId?: string;
  probeId?: string;
}

const STUDIO_SELECTION_QUERY_BY_FIELD = {
  screenId: "screen",
  flowId: "flow",
  flowStepId: "step",
  componentId: "component",
  endpointId: "endpoint",
  previewId: "preview",
  noteId: "note",
  findingId: "finding",
  probeId: "probe",
} as const satisfies Readonly<Record<keyof StudioSelectionState, string>>;

export const STUDIO_SELECTION_QUERY_KEYS = Object.freeze(
  Object.values(STUDIO_SELECTION_QUERY_BY_FIELD),
);

const STUDIO_SELECTION_ID_MAX_LENGTH = 512;

function boundedSelectionId(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length <= STUDIO_SELECTION_ID_MAX_LENGTH
    ? normalized
    : undefined;
}

/** Read stable Studio entity identities without interpreting project data. */
export function parseStudioSelection(href: string): StudioSelectionState {
  const url = new URL(href, "http://topo.local");
  return Object.fromEntries(
    Object.entries(STUDIO_SELECTION_QUERY_BY_FIELD).flatMap(([field, key]) => {
      const value = boundedSelectionId(url.searchParams.get(key));
      return value ? [[field, value]] : [];
    }),
  ) as StudioSelectionState;
}

/**
 * Patch selection identity into a local Studio href while preserving unrelated
 * session, overlay, extension, and project query parameters.
 */
export function patchStudioSelectionHref(
  href: string,
  patch: Partial<StudioSelectionState>,
): string {
  const url = new URL(href, "http://topo.local");
  for (const [field, value] of Object.entries(patch) as Array<
    [keyof StudioSelectionState, string | undefined]
  >) {
    const key = STUDIO_SELECTION_QUERY_BY_FIELD[field];
    if (!key) continue;
    if (value === undefined) {
      url.searchParams.delete(key);
      continue;
    }
    const normalized = boundedSelectionId(value);
    if (!normalized) {
      throw new Error(
        `Studio selection ${field} must contain 1-${STUDIO_SELECTION_ID_MAX_LENGTH} characters`,
      );
    }
    url.searchParams.set(key, normalized);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface StudioSearchTarget {
  destinationId: string;
  view?: string;
  selection?: StudioSearchSelection;
}

/** A JSON-readable project result that never depends on rendered geometry. */
export interface StudioSearchRecord {
  id: string;
  kind: StudioSearchKind;
  title: string;
  description: string;
  /** Complete lower-priority evidence such as paths, bodies, tags, or effects. */
  text?: string;
  target: StudioSearchTarget;
}

export interface StudioSearchMatch extends StudioSearchRecord {
  score: number;
  matchedTerms: string[];
}

export interface StudioSearchOptions {
  limit?: number;
}

export interface StudioSearchIndex {
  readonly size: number;
  search(query: string, options?: StudioSearchOptions): StudioSearchMatch[];
}

export { createStudioSearchIndex } from "./search.js";

const ENTRY_ID_PATTERN = /^[a-z][A-Za-z0-9-]*$/;
function assertEntryId(kind: "destination" | "command", id: string): void {
  if (!ENTRY_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid Studio ${kind} id "${id}"; begin with a lowercase letter and use letters, numbers, or hyphens`,
    );
  }
}

function routeParts(path: string): { root: string; landingView: string } {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error(
      `Invalid Studio destination path "${path}"; use an absolute pathname`,
    );
  }
  const segments = path.split("/").filter(Boolean);
  const rootSegment = segments[0];
  if (!rootSegment) {
    throw new Error("A Studio destination path must include a route root");
  }
  return {
    root: `/${rootSegment}`,
    landingView: segments[1] ?? "index",
  };
}

function mergeEntries<T>(
  base: Readonly<Record<string, Readonly<T>>> | undefined,
  changes: Record<string, T | false> | undefined,
  removals: readonly string[] | undefined,
  kind: "destination" | "command",
): Record<string, Readonly<T>> {
  const entries: Record<string, Readonly<T>> = { ...base };
  for (const [id, value] of Object.entries(changes ?? {})) {
    assertEntryId(kind, id);
    if (value === false) {
      delete entries[id];
      continue;
    }
    entries[id] = Object.freeze({ ...value });
  }
  for (const id of removals ?? []) {
    assertEntryId(kind, id);
    delete entries[id];
  }
  return entries;
}

export function defineStudio<
  TDestination extends StudioDestination = StudioDestination,
  TCommand extends StudioCommand = StudioCommand,
>(
  input: StudioDefinitionInput<TDestination, TCommand>,
): StudioDefinition<TDestination, TCommand> {
  const destinations = mergeEntries(
    input.extends?.destinations,
    input.destinations,
    input.remove?.destinations,
    "destination",
  );
  const commands = mergeEntries(
    input.extends?.commands,
    input.commands,
    input.remove?.commands,
    "command",
  );
  const destinationIds = Object.keys(destinations);
  if (destinationIds.length === 0) {
    throw new Error("A Studio definition requires at least one destination");
  }

  const routeOwners = new Map<string, string>();
  for (const [id, destination] of Object.entries(destinations)) {
    assertEntryId("destination", id);
    if (!destination.label.trim() || !destination.description.trim()) {
      throw new Error(
        `Studio destination "${id}" needs a label and description`,
      );
    }
    const { root } = routeParts(destination.path);
    const existing = routeOwners.get(root);
    if (existing) {
      throw new Error(
        `Studio destinations "${existing}" and "${id}" share route root "${root}"`,
      );
    }
    routeOwners.set(root, id);
  }
  for (const [id, command] of Object.entries(commands)) {
    assertEntryId("command", id);
    if (!command.label.trim()) {
      throw new Error(`Studio command "${id}" needs a label`);
    }
  }

  const inheritedDefault = input.extends?.defaultDestination;
  const requestedDefault = input.defaultDestination ?? inheritedDefault;
  const defaultDestination =
    requestedDefault && destinations[requestedDefault]
      ? requestedDefault
      : destinationIds[0]!;
  if (input.defaultDestination && !destinations[input.defaultDestination]) {
    throw new Error(
      `Studio default destination "${input.defaultDestination}" is not registered`,
    );
  }

  return Object.freeze({
    defaultDestination,
    destinations: Object.freeze(destinations),
    commands: Object.freeze(commands),
  });
}

export function matchStudioRoute<
  TDestination extends StudioDestination,
  TCommand extends StudioCommand,
>(
  studio: StudioDefinition<TDestination, TCommand>,
  href: string,
): StudioRoute<TDestination> {
  const url = new URL(href, "http://topo.local");
  const [rootSegment, requestedView] = url.pathname.split("/").filter(Boolean);
  const requestedRoot = rootSegment ? `/${rootSegment}` : undefined;
  let destinationId = studio.defaultDestination;
  if (requestedRoot) {
    const match = Object.entries(studio.destinations).find(
      ([, destination]) => routeParts(destination.path).root === requestedRoot,
    );
    if (match) destinationId = match[0];
  }
  const destination = studio.destinations[destinationId];
  if (!destination) {
    throw new Error(`Studio destination "${destinationId}" is not registered`);
  }
  const { landingView } = routeParts(destination.path);
  const matchedRoot = routeParts(destination.path).root === requestedRoot;
  return {
    destinationId,
    destination,
    view: matchedRoot ? (requestedView ?? landingView) : landingView,
  };
}
