import type { NoteRecord } from "@topo/notes";
import type { ApplicationGraph, Finding, SourceLocation } from "@topo/schema";

export const REVIEW_EXPORT_FORMATS = ["markdown", "sarif", "html"] as const;
export const REVIEW_EXPORT_INCLUDES = ["all", "findings", "notes"] as const;

export type ReviewExportFormat = (typeof REVIEW_EXPORT_FORMATS)[number];
export type ReviewExportInclude = (typeof REVIEW_EXPORT_INCLUDES)[number];

export interface ReviewSnapshotReference {
  id: string;
  screenId: string;
  routePath: string;
  capturedAt: string;
  status: "captured" | "failed";
  artifactPath?: string;
  contentHash?: string;
  width?: number;
  height?: number;
  error?: string;
}

export interface ReviewExportInput {
  graph: ApplicationGraph;
  notes: readonly NoteRecord[];
  snapshots?: readonly ReviewSnapshotReference[];
}

export interface ReviewExportOptions {
  format?: ReviewExportFormat;
  include?: ReviewExportInclude;
  attachSnapshots?: boolean;
}

export interface ReviewExportArtifact {
  format: ReviewExportFormat;
  fileName: string;
  mimeType: string;
  body: string;
}

interface ResolvedReviewExportOptions {
  format: ReviewExportFormat;
  include: ReviewExportInclude;
  attachSnapshots: boolean;
}

function resolveOptions(
  options: ReviewExportOptions,
): ResolvedReviewExportOptions {
  const format = options.format ?? "markdown";
  const include = options.include ?? "all";
  if (!REVIEW_EXPORT_FORMATS.includes(format)) {
    throw new Error(`Unsupported review export format: ${String(format)}`);
  }
  if (!REVIEW_EXPORT_INCLUDES.includes(include)) {
    throw new Error(
      `Unsupported review export include value: ${String(include)}`,
    );
  }
  return {
    format,
    include,
    attachSnapshots: options.attachSnapshots ?? false,
  };
}

function includeFindings(options: ResolvedReviewExportOptions): boolean {
  return options.include !== "notes";
}

function includeNotes(options: ResolvedReviewExportOptions): boolean {
  return options.include !== "findings";
}

function sourceLabel(source: SourceLocation | undefined): string {
  if (!source) return "Not recorded";
  return [source.filePath, source.line, source.column]
    .filter((value) => value !== undefined)
    .join(":");
}

function tableCell(value: string | number | undefined): string {
  if (value === undefined || value === "") return "—";
  return String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

function heading(value: string): string {
  return value.replaceAll(/([\\`*_{}\[\]<>#+.!|])/g, "\\$1");
}

function escapeHtml(value: string | number | undefined): string {
  if (value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function findingLevel(finding: Finding): "error" | "warning" | "note" {
  if (finding.severity === "high") return "error";
  if (finding.severity === "medium") return "warning";
  return "note";
}

function renderMarkdown(
  input: ReviewExportInput,
  options: ResolvedReviewExportOptions,
): ReviewExportArtifact {
  const { graph, notes } = input;
  const snapshots = options.attachSnapshots ? (input.snapshots ?? []) : [];
  const lines = [
    "# Topo review",
    "",
    `Generated: ${graph.generatedAt}`,
    "",
    "## Coverage",
    "",
    `- Framework: ${graph.framework}`,
    `- Screens: ${graph.screens.length}`,
    `- Components: ${graph.components.length}`,
    `- Findings: ${graph.findings.length}`,
    `- Notes: ${notes.length}`,
    ...(options.attachSnapshots
      ? [`- Snapshot references: ${snapshots.length}`]
      : []),
    "",
    "## Screens",
    "",
    "| Route | State | Render status | Source |",
    "| --- | --- | --- | --- |",
    ...(graph.screens.length
      ? graph.screens.map(
          (screen) =>
            `| ${tableCell(screen.routePath)} | ${tableCell(screen.state)} | ${tableCell(screen.renderStatus)} | ${tableCell(sourceLabel(screen.source))} |`,
        )
      : ["| — | — | — | No screens discovered |"]),
    "",
  ];

  if (includeFindings(options)) {
    lines.push(`## Findings (${graph.findings.length})`, "");
    if (graph.findings.length === 0) lines.push("No findings.", "");
    for (const finding of graph.findings) {
      lines.push(
        `### ${heading(finding.title)}`,
        "",
        `- ID: \`${finding.id}\``,
        `- Severity: ${finding.severity}`,
        `- Status: ${finding.status}`,
        `- Confidence: ${finding.confidence.toFixed(2)}`,
        `- Source: \`${sourceLabel(finding.source)}\``,
        "",
        finding.description,
        "",
      );
      if (finding.evidence.length > 0) {
        lines.push("Evidence:", "");
        for (const evidence of finding.evidence) lines.push(`- ${evidence}`);
        lines.push("");
      }
    }
  }

  if (includeNotes(options)) {
    lines.push(`## Notes (${notes.length})`, "");
    if (notes.length === 0) lines.push("No notes yet.", "");
    for (const note of notes) {
      lines.push(
        `### ${heading(note.title)}`,
        "",
        `- ID: \`${note.id}\``,
        `- Type: ${note.type}`,
        `- Status: ${note.status}`,
        `- Target: \`${note.targetRoute ?? note.targetId ?? "Not recorded"}\``,
        `- Anchor: ${note.anchor?.status ?? "unbound"}`,
        ...(note.author ? [`- Author: ${note.author}`] : []),
        "",
        note.body || "(empty note)",
        "",
      );
    }
  }

  if (options.attachSnapshots) {
    lines.push(
      `## Snapshot references (${snapshots.length})`,
      "",
      "Snapshot binaries remain in `.topo/snapshots`; this report retains references without embedding opaque image data.",
      "",
      "| Route | Status | Captured | Dimensions | Artifact | Content hash |",
      "| --- | --- | --- | --- | --- | --- |",
      ...(snapshots.length
        ? snapshots.map(
            (snapshot) =>
              `| ${tableCell(snapshot.routePath)} | ${tableCell(snapshot.status)} | ${tableCell(snapshot.capturedAt)} | ${tableCell(snapshot.width && snapshot.height ? `${snapshot.width}×${snapshot.height}` : undefined)} | ${tableCell(snapshot.artifactPath)} | ${tableCell(snapshot.contentHash)} |`,
          )
        : ["| — | — | — | — | No snapshot references | — |"]),
      "",
    );
  }

  return {
    format: "markdown",
    fileName: "TOPO_REVIEW.md",
    mimeType: "text/markdown; charset=utf-8",
    body: `${lines.join("\n").trimEnd()}\n`,
  };
}

function renderSarif(
  input: ReviewExportInput,
  options: ResolvedReviewExportOptions,
): ReviewExportArtifact {
  const findings = includeFindings(options) ? input.graph.findings : [];
  const notes = includeNotes(options) ? input.notes : [];
  const snapshots = options.attachSnapshots ? (input.snapshots ?? []) : [];
  const ruleIndexes = new Map<string, number>();
  const rules: Array<Record<string, unknown>> = [];
  for (const finding of findings) {
    if (ruleIndexes.has(finding.id)) continue;
    ruleIndexes.set(finding.id, rules.length);
    rules.push({
      id: finding.id,
      name: finding.title,
      shortDescription: { text: finding.title },
      fullDescription: { text: finding.description },
      defaultConfiguration: { level: findingLevel(finding) },
      properties: {
        topoSeverity: finding.severity,
        topoConfidence: finding.confidence,
      },
    });
  }
  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "Topo",
            informationUri: "https://topo.byronwade.com",
            semanticVersion: "0.1.0",
            rules,
          },
        },
        results: findings.map((finding) => ({
          ruleId: finding.id,
          ruleIndex: ruleIndexes.get(finding.id),
          level: findingLevel(finding),
          message: { text: finding.description },
          locations: finding.source
            ? [
                {
                  physicalLocation: {
                    artifactLocation: { uri: finding.source.filePath },
                    region: {
                      startLine: finding.source.line ?? 1,
                      ...(finding.source.column
                        ? { startColumn: finding.source.column }
                        : {}),
                    },
                  },
                },
              ]
            : [],
          partialFingerprints: { topoFindingId: finding.id },
          properties: {
            topoSeverity: finding.severity,
            topoStatus: finding.status,
            topoConfidence: finding.confidence,
            topoEvidence: finding.evidence,
          },
        })),
        properties: {
          topo: {
            schemaVersion: 1,
            generatedAt: input.graph.generatedAt,
            framework: input.graph.framework,
            screenCount: input.graph.screens.length,
            componentCount: input.graph.components.length,
            notes,
            snapshotReferences: snapshots,
          },
        },
      },
    ],
  };
  return {
    format: "sarif",
    fileName: "TOPO_REVIEW.sarif",
    mimeType: "application/sarif+json; charset=utf-8",
    body: `${JSON.stringify(sarif, null, 2)}\n`,
  };
}

function renderHtml(
  input: ReviewExportInput,
  options: ResolvedReviewExportOptions,
): ReviewExportArtifact {
  const { graph, notes } = input;
  const snapshots = options.attachSnapshots ? (input.snapshots ?? []) : [];
  const screenRows = graph.screens.length
    ? graph.screens
        .map(
          (screen) =>
            `<tr><td><code>${escapeHtml(screen.routePath)}</code></td><td>${escapeHtml(screen.state)}</td><td>${escapeHtml(screen.renderStatus)}</td><td><code>${escapeHtml(sourceLabel(screen.source))}</code></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4">No screens discovered.</td></tr>';
  const findingItems = graph.findings
    .map(
      (finding) =>
        `<article class="record"><div class="record-head"><h3>${escapeHtml(finding.title)}</h3><span class="pill ${escapeHtml(findingLevel(finding))}">${escapeHtml(finding.severity)}</span></div><p>${escapeHtml(finding.description)}</p><dl><div><dt>Status</dt><dd>${escapeHtml(finding.status)}</dd></div><div><dt>Confidence</dt><dd>${finding.confidence.toFixed(2)}</dd></div><div><dt>Source</dt><dd><code>${escapeHtml(sourceLabel(finding.source))}</code></dd></div></dl>${finding.evidence.length ? `<ul>${finding.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}</article>`,
    )
    .join("");
  const noteItems = notes
    .map(
      (note) =>
        `<article class="record"><div class="record-head"><h3>${escapeHtml(note.title)}</h3><span class="pill">${escapeHtml(note.type)}</span></div><p class="note-body">${escapeHtml(note.body || "(empty note)")}</p><dl><div><dt>Status</dt><dd>${escapeHtml(note.status)}</dd></div><div><dt>Target</dt><dd><code>${escapeHtml(note.targetRoute ?? note.targetId ?? "Not recorded")}</code></dd></div><div><dt>Anchor</dt><dd>${escapeHtml(note.anchor?.status ?? "unbound")}</dd></div></dl></article>`,
    )
    .join("");
  const snapshotRows = snapshots.length
    ? snapshots
        .map(
          (snapshot) =>
            `<tr><td><code>${escapeHtml(snapshot.routePath)}</code></td><td>${escapeHtml(snapshot.status)}</td><td>${escapeHtml(snapshot.capturedAt)}</td><td>${escapeHtml(snapshot.width && snapshot.height ? `${snapshot.width}×${snapshot.height}` : "Not recorded")}</td><td><code>${escapeHtml(snapshot.artifactPath ?? "Not recorded")}</code></td><td><code>${escapeHtml(snapshot.contentHash ?? "Not recorded")}</code></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6">No snapshot references.</td></tr>';
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Topo review</title>
<style>:root{color-scheme:light;--ink:#151719;--muted:#687078;--line:#dfe3e6;--paper:#f6f7f7;--card:#fff}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(1080px,calc(100% - 40px));margin:48px auto 96px}header{padding:32px 0;border-bottom:1px solid var(--line)}h1{font-size:38px;letter-spacing:-.04em;margin:0 0 8px}h2{margin:48px 0 16px;font-size:22px}h3{margin:0;font-size:16px}.meta{color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:24px 0}.stat,.record,table{background:var(--card);border:1px solid var(--line);border-radius:10px}.stat{padding:16px}.stat strong{display:block;font-size:24px}.record{padding:20px;margin:10px 0}.record-head{display:flex;justify-content:space-between;gap:16px;align-items:center}.pill{display:inline-flex;padding:3px 8px;border-radius:999px;background:#eceff1;color:#4c5359;font-size:11px;text-transform:uppercase}.pill.error{background:#fee5e5;color:#9c1c1c}.pill.warning{background:#fff0ca;color:#754e00}.note-body{white-space:pre-wrap}dl{display:flex;flex-wrap:wrap;gap:16px;margin:16px 0 0}dl div{min-width:150px}dt{color:var(--muted);font-size:11px;text-transform:uppercase}dd{margin:2px 0 0}table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden}th,td{padding:11px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase}tr:last-child td{border-bottom:0}code{font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}@media(max-width:680px){main{width:min(100% - 24px,1080px);margin-top:20px}header{padding-top:16px}table{display:block;overflow-x:auto}}</style>
</head>
<body>
<main>
<header><h1>Topo review</h1><p class="meta">Generated ${escapeHtml(graph.generatedAt)} · ${escapeHtml(graph.framework)}</p></header>
<section class="stats" aria-label="Coverage"><div class="stat"><strong>${graph.screens.length}</strong>Screens</div><div class="stat"><strong>${graph.components.length}</strong>Components</div><div class="stat"><strong>${graph.findings.length}</strong>Findings</div><div class="stat"><strong>${notes.length}</strong>Notes</div></section>
<section><h2>Screens</h2><table><thead><tr><th>Route</th><th>State</th><th>Render</th><th>Source</th></tr></thead><tbody>${screenRows}</tbody></table></section>
${includeFindings(options) ? `<section><h2>Findings (${graph.findings.length})</h2>${findingItems || '<p class="meta">No findings.</p>'}</section>` : ""}
${includeNotes(options) ? `<section><h2>Notes (${notes.length})</h2>${noteItems || '<p class="meta">No notes yet.</p>'}</section>` : ""}
${options.attachSnapshots ? `<section><h2>Snapshot references (${snapshots.length})</h2><p class="meta">Snapshot binaries remain in <code>.topo/snapshots</code>; this report retains references only.</p><table><thead><tr><th>Route</th><th>Status</th><th>Captured</th><th>Size</th><th>Artifact</th><th>Hash</th></tr></thead><tbody>${snapshotRows}</tbody></table></section>` : ""}
</main>
</body>
</html>
`;
  return {
    format: "html",
    fileName: "TOPO_REVIEW.html",
    mimeType: "text/html; charset=utf-8",
    body,
  };
}

/**
 * Produce one deterministic, self-contained review artifact. Snapshot binaries
 * are never embedded; when requested, only explicit references are retained.
 */
export function exportReview(
  input: ReviewExportInput,
  requested: ReviewExportOptions = {},
): ReviewExportArtifact {
  const options = resolveOptions(requested);
  if (options.format === "sarif") return renderSarif(input, options);
  if (options.format === "html") return renderHtml(input, options);
  return renderMarkdown(input, options);
}

/** Backward-compatible Markdown body used by existing MCP clients. */
export function exportReviewMarkdown(input: ReviewExportInput): string {
  return exportReview(input, { format: "markdown" }).body;
}
