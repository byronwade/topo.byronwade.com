import {
  FLOW_DISCOVERY_ADAPTER_VERSION,
  defineFlowDiscoveryAdapter,
  type DiscoveredFlowTransition,
  type FlowDiscoveryAdapterContext,
} from "@topo/flow-adapter";
import type { HttpMethod, SourceReadIssue } from "@topo/schema";

interface LiteralMatch {
  index: number;
  kind: DiscoveredFlowTransition["kind"];
  target: DiscoveredFlowTransition["target"];
  action: string;
  confidence: number;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if ((starts[middle] ?? 0) <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high) + 1;
}

function canonicalLiteral(value: string): string | undefined {
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  const pathname = value.split(/[?#]/, 1)[0] ?? value;
  if (!pathname || /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)$/i.test(pathname)) {
    return undefined;
  }
  const normalized = pathname.replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function pushRegexMatches(
  result: LiteralMatch[],
  source: string,
  pattern: RegExp,
  create: (match: RegExpExecArray) => Omit<LiteralMatch, "index"> | undefined,
): void {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const item = create(match);
    if (item) result.push({ ...item, index: match.index });
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
}

function sourceMatches(source: string): LiteralMatch[] {
  const result: LiteralMatch[] = [];

  pushRegexMatches(
    result,
    source,
    /<(?:a|Link|NavLink|NuxtLink|RouterLink)\b[^>]*?\b(?:href|to)\s*=\s*(?:\{\s*)?["']([^"']+)["']\s*\}?/g,
    (match) => {
      const routePath = canonicalLiteral(match[1] ?? "");
      return routePath
        ? {
            kind: "navigation",
            target: { kind: "route", routePath },
            action: `Follow link to ${routePath}`,
            confidence: 0.96,
          }
        : undefined;
    },
  );

  pushRegexMatches(
    result,
    source,
    /\b(router\s*\.\s*)?(push|replace|navigate|redirect|goto|navigateTo)\s*\(\s*["']([^"']+)["']/g,
    (match) => {
      const routePath = canonicalLiteral(match[3] ?? "");
      if (!routePath) return undefined;
      const operation = match[2] ?? "navigate";
      const kind =
        operation === "replace" || operation === "redirect"
          ? "redirect"
          : "navigation";
      return {
        kind,
        target: { kind: "route", routePath },
        action: `${operation} to ${routePath}`,
        confidence: 0.93,
      };
    },
  );

  pushRegexMatches(
    result,
    source,
    /<form\b[^>]*?\baction\s*=\s*["']([^"']+)["'][^>]*>/gi,
    (match) => {
      const path = canonicalLiteral(match[1] ?? "");
      if (!path) return undefined;
      const methodMatch = /\bmethod\s*=\s*["'](get|post)["']/i.exec(match[0]);
      const method = (methodMatch?.[1]?.toUpperCase() ?? "GET") as HttpMethod;
      return path.startsWith("/api/")
        ? {
            kind: "submission",
            target: { kind: "api-endpoint", method, path },
            action: `Submit ${method} ${path}`,
            confidence: 0.92,
          }
        : {
            kind: "submission",
            target: { kind: "route", routePath: path },
            action: `Submit form to ${path}`,
            confidence: 0.9,
          };
    },
  );

  pushRegexMatches(
    result,
    source,
    /\bfetch\s*\(\s*["']([^"']+)["']([\s\S]{0,320}?)(?:\)|$)/g,
    (match) => {
      const path = canonicalLiteral(match[1] ?? "");
      if (!path) return undefined;
      const methodMatch = /\bmethod\s*:\s*["']([A-Za-z]+)["']/i.exec(match[2] ?? "");
      const method = (methodMatch?.[1]?.toUpperCase() ?? "GET") as HttpMethod;
      return {
        kind: "request",
        target: { kind: "api-endpoint", method, path },
        action: `Request ${method} ${path}`,
        confidence: 0.9,
      };
    },
  );

  pushRegexMatches(
    result,
    source,
    /\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["']/gi,
    (match) => {
      const path = canonicalLiteral(match[2] ?? "");
      if (!path) return undefined;
      const method = (match[1]?.toUpperCase() ?? "GET") as HttpMethod;
      return {
        kind: "request",
        target: { kind: "api-endpoint", method, path },
        action: `Request ${method} ${path}`,
        confidence: 0.94,
      };
    },
  );

  return result;
}

function computedIssues(
  source: string,
  filePath: string,
  starts: readonly number[],
): SourceReadIssue[] {
  const issues: SourceReadIssue[] = [];
  const pattern = /\b(?:router\s*\.\s*)?(?:push|replace|navigate|redirect|goto|navigateTo)\s*\(\s*(?!["'])/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    issues.push({
      filePath,
      message: `Computed navigation target at line ${lineAt(starts, match.index)} cannot be resolved safely without executing project code.`,
    });
  }
  return issues;
}

export const sourceFlowDiscoveryAdapter = defineFlowDiscoveryAdapter({
  apiVersion: FLOW_DISCOVERY_ADAPTER_VERSION,
  id: "source-flow",
  displayName: "Source flow discovery",
  async scan(context: FlowDiscoveryAdapterContext) {
    const ownersByFile = new Map<string, string[]>();
    for (const screen of context.screens) {
      for (const filePath of screen.sourceFilePaths) {
        const owners = ownersByFile.get(filePath);
        if (owners) owners.push(screen.screenId);
        else ownersByFile.set(filePath, [screen.screenId]);
      }
    }

    const transitions: DiscoveredFlowTransition[] = [];
    const issues: SourceReadIssue[] = [];
    await Promise.all(
      [...ownersByFile.entries()].map(async ([filePath, screenIds]) => {
        const source = await context.readFile(filePath);
        const starts = lineStarts(source);
        const matches = sourceMatches(source);
        for (const match of matches) {
          for (const sourceScreenId of screenIds) {
            transitions.push({
              sourceScreenId,
              kind: match.kind,
              target: match.target,
              action: match.action,
              source: { filePath, line: lineAt(starts, match.index) },
              confidence: match.confidence,
            });
          }
        }
        issues.push(...computedIssues(source, filePath, starts));
      }),
    );

    const unique = new Map<string, DiscoveredFlowTransition>();
    for (const transition of transitions) {
      const target =
        transition.target.kind === "route"
          ? transition.target.routePath
          : `${transition.target.method}:${transition.target.path}`;
      const key = `${transition.sourceScreenId}:${transition.kind}:${target}:${transition.source.filePath}:${transition.source.line ?? 1}`;
      unique.set(key, transition);
    }
    return {
      transitions: [...unique.values()].sort(
        (left, right) =>
          left.sourceScreenId.localeCompare(right.sourceScreenId) ||
          left.source.filePath.localeCompare(right.source.filePath) ||
          (left.source.line ?? 1) - (right.source.line ?? 1),
      ),
      issues,
    };
  },
});

export default sourceFlowDiscoveryAdapter;
