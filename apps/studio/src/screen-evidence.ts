import type {
  ApplicationGraph,
  ComponentNode,
  Finding,
  ScreenNode,
} from "@topo/schema";

import type { StudioNote, StudioSnapshot } from "./studio-model";

export interface ScreenEvidence {
  screen?: ScreenNode;
  snapshot?: StudioSnapshot;
  components: ComponentNode[];
  findings: Finding[];
  notes: StudioNote[];
}

export interface SelectScreenEvidenceOptions {
  graph: ApplicationGraph;
  notes: readonly StudioNote[];
  snapshots: readonly StudioSnapshot[];
  selectedScreenId?: string;
}

/**
 * Resolve a finding to a screen only through explicit source identity or a
 * component's declared `usedBy` relationship. Copy and titles are never used
 * as hidden routing heuristics.
 */
export function selectFindingScreen(
  graph: ApplicationGraph,
  finding: Finding | undefined,
  preferredScreenId?: string,
): ScreenNode | undefined {
  const preferred = graph.screens.find(
    (screen) => screen.id === preferredScreenId,
  );
  const sourcePath = finding?.source?.filePath;
  if (!sourcePath) return preferred ?? graph.screens[0];

  const exactScreen = graph.screens.find(
    (screen) => screen.source.filePath === sourcePath,
  );
  if (exactScreen) return exactScreen;

  const sourceComponents = graph.components.filter(
    (component) => component.source.filePath === sourcePath,
  );
  if (
    preferred &&
    sourceComponents.some((component) =>
      componentReferencesScreen(component, preferred),
    )
  ) {
    return preferred;
  }
  return (
    graph.screens.find((screen) =>
      sourceComponents.some((component) =>
        componentReferencesScreen(component, screen),
      ),
    ) ??
    preferred ??
    graph.screens[0]
  );
}

/**
 * Resolve the application screen that explicitly consumes a component. A
 * preferred screen wins only when it is one of the component's declared
 * `usedBy` targets; otherwise declaration order is preserved.
 */
export function selectComponentScreen(
  graph: ApplicationGraph,
  component: ComponentNode | undefined,
  preferredScreenId?: string,
): ScreenNode | undefined {
  const preferred = graph.screens.find(
    (screen) => screen.id === preferredScreenId,
  );
  if (!component) return preferred ?? graph.screens[0];
  if (preferred && componentReferencesScreen(component, preferred)) {
    return preferred;
  }

  for (const reference of component.usedBy) {
    const screen = graph.screens.find(
      (candidate) =>
        candidate.id === reference ||
        candidate.routePath === reference ||
        candidate.source.filePath === reference,
    );
    if (screen) return screen;
  }

  return preferred ?? graph.screens[0];
}

/**
 * Resolve the screen explicitly referenced by a durable Markdown note. Unlike
 * general screen selection, this resolver has no first-screen fallback: an
 * unbound canvas, checklist, or flow note must remain visibly unbound.
 */
export function selectNoteScreen(
  graph: ApplicationGraph,
  note: StudioNote | undefined,
): ScreenNode | undefined {
  if (!note) return undefined;

  if (note.targetKind === "screen" && note.targetId) {
    const targetScreen = graph.screens.find(
      (screen) => screen.id === note.targetId,
    );
    if (targetScreen) return targetScreen;
  }

  if (note.targetRoute) {
    const routeScreen = graph.screens.find(
      (screen) => screen.routePath === note.targetRoute,
    );
    if (routeScreen) return routeScreen;
  }

  const sourcePath = note.anchor?.source?.filePath;
  if (sourcePath) {
    const sourceScreen = graph.screens.find(
      (screen) => screen.source.filePath === sourcePath,
    );
    if (sourceScreen) return sourceScreen;
  }

  const targetComponent =
    note.targetKind === "component" && note.targetId
      ? graph.components.find((component) => component.id === note.targetId)
      : undefined;
  const sourceComponents = sourcePath
    ? graph.components.filter(
        (component) => component.source.filePath === sourcePath,
      )
    : [];
  const components = targetComponent
    ? [targetComponent, ...sourceComponents]
    : sourceComponents;

  return graph.screens.find((screen) =>
    components.some((component) =>
      componentReferencesScreen(component, screen),
    ),
  );
}

function newestCapturedSnapshot(
  snapshots: readonly StudioSnapshot[],
  screenId: string,
): StudioSnapshot | undefined {
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.screenId === screenId && snapshot.status === "captured",
    )
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))[0];
}

function componentReferencesScreen(
  component: ComponentNode,
  screen: ScreenNode,
): boolean {
  const identities = new Set([
    screen.id,
    screen.routePath,
    screen.source.filePath,
  ]);
  return component.usedBy.some((reference) => identities.has(reference));
}

function noteReferencesScreen(note: StudioNote, screen: ScreenNode): boolean {
  return (
    note.targetRoute === screen.routePath ||
    (note.targetKind === "screen" && note.targetId === screen.id) ||
    note.anchor?.source?.filePath === screen.source.filePath
  );
}

/**
 * One deterministic read model for the selected screen workspace. The module
 * never invents element structure: it returns only source-backed graph,
 * capture, component-usage, finding, and Markdown-note evidence.
 */
export function selectScreenEvidence(
  options: SelectScreenEvidenceOptions,
): ScreenEvidence {
  const screen =
    options.graph.screens.find(
      (candidate) => candidate.id === options.selectedScreenId,
    ) ?? options.graph.screens[0];
  if (!screen) {
    return { components: [], findings: [], notes: [] };
  }

  return {
    screen,
    snapshot: newestCapturedSnapshot(options.snapshots, screen.id),
    components: options.graph.components.filter((component) =>
      componentReferencesScreen(component, screen),
    ),
    findings: options.graph.findings.filter(
      (finding) => finding.source?.filePath === screen.source.filePath,
    ),
    notes: options.notes.filter((note) => noteReferencesScreen(note, screen)),
  };
}
