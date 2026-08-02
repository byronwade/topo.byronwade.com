import type {
  StudioSearchIndex,
  StudioSearchMatch,
  StudioSearchOptions,
  StudioSearchRecord,
} from "./index.js";

const STUDIO_SEARCH_LIMIT = 16;
const STUDIO_SEARCH_MAX_LIMIT = 50;

interface IndexedStudioSearchRecord {
  record: Readonly<StudioSearchRecord>;
  title: string;
  description: string;
  text: string;
  titleTokens: string[];
  descriptionTokens: string[];
  allTokens: string[];
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchTerms(value: string): string[] {
  return [...new Set(normalizeSearchText(value).split(/\s+/).filter(Boolean))];
}

function fieldTermScore(
  field: string,
  tokens: readonly string[],
  term: string,
  weight: number,
): number {
  if (field === term) return weight * 6;
  if (field.startsWith(term)) return weight * 4;
  if (tokens.some((token) => token === term)) return weight * 3;
  if (tokens.some((token) => token.startsWith(term))) return weight * 2;
  if (field.includes(term)) return weight;
  return 0;
}

function scoreStudioSearchRecord(
  indexed: IndexedStudioSearchRecord,
  normalizedQuery: string,
  terms: readonly string[],
): number | undefined {
  let score = 0;
  for (const term of terms) {
    const termScore = Math.max(
      fieldTermScore(indexed.title, indexed.titleTokens, term, 24),
      fieldTermScore(indexed.description, indexed.descriptionTokens, term, 12),
      fieldTermScore(indexed.text, indexed.allTokens, term, 4),
    );
    if (termScore === 0) return undefined;
    score += termScore;
  }
  if (indexed.title === normalizedQuery) score += 240;
  else if (indexed.title.startsWith(normalizedQuery)) score += 120;
  else if (indexed.title.includes(normalizedQuery)) score += 64;
  if (indexed.description.includes(normalizedQuery)) score += 24;
  return score;
}

/**
 * Create one immutable, in-process search module for Studio project records.
 * Callers provide stable records once; repeated queries reuse normalized fields.
 */
export function createStudioSearchIndex(
  records: readonly StudioSearchRecord[],
): StudioSearchIndex {
  const ids = new Set<string>();
  const indexed = records.map((record): IndexedStudioSearchRecord => {
    if (!record.id.trim())
      throw new Error("Studio search record id is required");
    if (ids.has(record.id)) {
      throw new Error(`Duplicate Studio search record id "${record.id}"`);
    }
    ids.add(record.id);
    if (!record.title.trim() || !record.description.trim()) {
      throw new Error(
        `Studio search record "${record.id}" needs a title and description`,
      );
    }
    if (!record.target.destinationId.trim()) {
      throw new Error(
        `Studio search record "${record.id}" needs a destination target`,
      );
    }
    const frozen = Object.freeze({
      ...record,
      target: Object.freeze({
        ...record.target,
        ...(record.target.selection
          ? { selection: Object.freeze({ ...record.target.selection }) }
          : {}),
      }),
    });
    const title = normalizeSearchText(record.title);
    const description = normalizeSearchText(record.description);
    const text = normalizeSearchText(
      [
        record.id,
        record.kind,
        record.text,
        record.target.destinationId,
        record.target.view,
        record.target.selection?.id,
        record.target.selection?.parentId,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return {
      record: frozen,
      title,
      description,
      text,
      titleTokens: searchTerms(title),
      descriptionTokens: searchTerms(description),
      allTokens: searchTerms(`${title} ${description} ${text}`),
    };
  });

  return Object.freeze({
    size: indexed.length,
    search(query: string, options: StudioSearchOptions = {}) {
      const normalizedQuery = normalizeSearchText(query);
      const terms = searchTerms(normalizedQuery);
      if (terms.length === 0) return [];
      const requestedLimit = options.limit ?? STUDIO_SEARCH_LIMIT;
      const limit = Math.max(
        1,
        Math.min(STUDIO_SEARCH_MAX_LIMIT, Math.floor(requestedLimit)),
      );
      return indexed
        .flatMap((item): StudioSearchMatch[] => {
          const score = scoreStudioSearchRecord(item, normalizedQuery, terms);
          if (score === undefined) return [];
          return [
            {
              ...item.record,
              score,
              matchedTerms: [...terms],
            },
          ];
        })
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit);
    },
  });
}
