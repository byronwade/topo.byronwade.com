import {
  ApplicationGraphSchema,
  screenPreviewPath,
  type ApplicationGraph,
  type Finding,
} from "@topo/schema";

export interface SourceChangeImpact {
  /** Direct means every changed file matched graph evidence. */
  strategy: "direct" | "conservative";
  /** Normalized, unique, workspace-relative paths in deterministic order. */
  changedPaths: string[];
  screenIds: string[];
  componentIds: string[];
}

function normalizeSourcePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function graphVersions(
  previous: ApplicationGraph | undefined,
  next: ApplicationGraph,
): ApplicationGraph[] {
  return previous && previous !== next ? [previous, next] : [next];
}

/**
 * Converts raw file-watch paths into the smallest refresh scope justified by
 * graph evidence. An unmatched path may be a layout, stylesheet, config, or
 * transitive dependency, so correctness requires a conservative full refresh.
 */
export function planSourceChangeImpact(
  previous: ApplicationGraph | undefined,
  next: ApplicationGraph,
  changedPaths: readonly string[],
): SourceChangeImpact {
  const paths = [
    ...new Set(changedPaths.map(normalizeSourcePath).filter(Boolean)),
  ].sort();
  const changed = new Set(paths);
  const screenIds = new Set<string>();
  const componentIds = new Set<string>();
  const matchedPaths = new Set<string>();
  const versions = graphVersions(previous, next);

  for (const graph of versions) {
    for (const screen of graph.screens) {
      const sourcePath = normalizeSourcePath(screen.source.filePath);
      if (!changed.has(sourcePath)) continue;
      matchedPaths.add(sourcePath);
      screenIds.add(screen.id);
    }

    for (const component of graph.components) {
      const sourcePaths = [
        component.source.filePath,
        ...component.previewSources.map((preview) => preview.source.filePath),
      ].map(normalizeSourcePath);
      const matches = sourcePaths.filter((sourcePath) =>
        changed.has(sourcePath),
      );
      if (matches.length === 0) continue;
      for (const sourcePath of matches) matchedPaths.add(sourcePath);
      componentIds.add(component.id);
      for (const screenId of component.usedBy) screenIds.add(screenId);
    }
  }

  const strategy = paths.every((sourcePath) => matchedPaths.has(sourcePath))
    ? "direct"
    : "conservative";
  if (strategy === "conservative") {
    for (const graph of versions) {
      for (const screen of graph.screens) screenIds.add(screen.id);
      for (const component of graph.components) componentIds.add(component.id);
    }
  }

  const existingScreenIds = new Set(next.screens.map((screen) => screen.id));
  const existingComponentIds = new Set(
    next.components.map((component) => component.id),
  );
  return {
    strategy,
    changedPaths: paths,
    screenIds: [...screenIds].filter((id) => existingScreenIds.has(id)).sort(),
    componentIds: [...componentIds]
      .filter((id) => existingComponentIds.has(id))
      .sort(),
  };
}

export function reconcileGraph(
  previous: ApplicationGraph | undefined,
  next: ApplicationGraph,
  invalidatedScreenIds: readonly string[] = [],
  options: { validate?: boolean } = {},
): ApplicationGraph {
  const invalidated = new Set(invalidatedScreenIds);
  const oldScreens = new Map(
    previous?.screens.map((screen) => [screen.id, screen]) ?? [],
  );
  const reconciled: ApplicationGraph = {
    ...next,
    screens: next.screens.map((screen) => {
      const previousScreen = oldScreens.get(screen.id);
      const previewChanged =
        previousScreen !== undefined &&
        screenPreviewPath(previousScreen) !== screenPreviewPath(screen);
      return {
        ...screen,
        renderStatus:
          screen.previewRoute?.status === "unresolved"
            ? "blocked"
            : invalidated.has(screen.id) || previewChanged
              ? screen.renderStatus
              : (previousScreen?.renderStatus ?? screen.renderStatus),
      };
    }),
  };
  return options.validate === false
    ? reconciled
    : ApplicationGraphSchema.parse(reconciled);
}

/**
 * Compares canonical graph content while ignoring the scan timestamp. This
 * avoids rewriting derived artifacts after edits that do not change Topo's
 * normalized read model.
 */
export function applicationGraphContentEqual(
  left: ApplicationGraph,
  right: ApplicationGraph,
): boolean {
  const { generatedAt: _leftGeneratedAt, ...leftContent } = left;
  const { generatedAt: _rightGeneratedAt, ...rightContent } = right;
  return JSON.stringify(leftContent) === JSON.stringify(rightContent);
}

export function mergeFindings(...groups: Finding[][]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const finding of groups.flat()) byId.set(finding.id, finding);
  return [...byId.values()];
}
