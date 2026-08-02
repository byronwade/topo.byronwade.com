import { compareRouteScreens } from "@topo/canvas-engine";
import type { ComponentNode, ScreenNode } from "@topo/schema";

function queryTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

function includesEveryTerm(text: string, terms: readonly string[]): boolean {
  const searchable = text.toLocaleLowerCase();
  return terms.every((term) => searchable.includes(term));
}

/** Complete, renderer-neutral screen inventory for the Editor navigator. */
export function filterEditorScreens(
  screens: readonly ScreenNode[],
  query: string,
): ScreenNode[] {
  const terms = queryTerms(query);
  return screens
    .filter((screen) => screen.state === "default")
    .filter((screen) =>
      includesEveryTerm(
        [
          screen.routePath,
          screen.title,
          screen.source.filePath,
          screen.framework,
          screen.renderStatus,
          ...screen.tags,
        ].join(" "),
        terms,
      ),
    )
    .sort(compareRouteScreens);
}

/** Complete component inventory for Editor assets and insert search. */
export function filterEditorComponents(
  components: readonly ComponentNode[],
  query: string,
): ComponentNode[] {
  const terms = queryTerms(query);
  return components.filter((component) =>
    includesEveryTerm(
      [
        component.name,
        component.source.filePath,
        component.previewStatus,
        ...component.usedBy,
      ]
        .filter(Boolean)
        .join(" "),
      terms,
    ),
  );
}
