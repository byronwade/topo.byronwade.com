import { describe, expect, it } from "vitest";

import type { NoteRecord } from "@topo/notes";
import { emptyApplicationGraph, type ApplicationGraph } from "@topo/schema";

import { exportReview } from "./index.js";

const graph: ApplicationGraph = {
  ...emptyApplicationGraph("C:/projects/fieldbase"),
  generatedAt: "2026-08-01T12:00:00.000Z",
  framework: "next-app",
  screens: [
    {
      id: "screen:dashboard",
      kind: "screen",
      title: "Dashboard",
      routePath: "/dashboard",
      framework: "next-app",
      state: "default",
      group: "dashboard",
      source: { filePath: "app/dashboard/page.tsx", line: 4 },
      renderStatus: "captured",
      tags: [],
    },
  ],
  findings: [
    {
      id: "finding:save-button",
      severity: "high",
      status: "open",
      title: "Save <button> has no effect",
      description: "Activation produced no recognized effect.",
      source: { filePath: "app/dashboard/page.tsx", line: 18, column: 7 },
      evidence: ["No URL, network, DOM, or storage change."],
      confidence: 0.92,
    },
  ],
};

const notes: NoteRecord[] = [
  {
    version: 1,
    id: "note:dashboard",
    type: "screen",
    title: "Review <dashboard>",
    body: "Confirm the empty state & retry behavior.",
    targetRoute: "/dashboard",
    status: "open",
    anchor: { status: "attached", source: graph.screens[0]!.source },
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  },
];

const snapshots = [
  {
    id: "snapshot:dashboard",
    screenId: "screen:dashboard",
    routePath: "/dashboard",
    capturedAt: "2026-08-01T12:01:00.000Z",
    status: "captured" as const,
    artifactPath: ".topo/snapshots/dashboard.png",
    contentHash: "a".repeat(64),
    width: 1440,
    height: 1000,
  },
];

describe("exportReview", () => {
  it("renders complete Markdown with source and snapshot references", () => {
    const artifact = exportReview(
      { graph, notes, snapshots },
      { format: "markdown", attachSnapshots: true },
    );

    expect(artifact.fileName).toBe("TOPO_REVIEW.md");
    expect(artifact.body).toContain("## Screens");
    expect(artifact.body).toContain("## Findings (1)");
    expect(artifact.body).toContain("## Notes (1)");
    expect(artifact.body).toContain("## Snapshot references (1)");
    expect(artifact.body).toContain(".topo/snapshots/dashboard.png");
    expect(artifact.body).not.toContain("data:image");
  });

  it("emits SARIF 2.1.0 with stable finding and structured note evidence", () => {
    const artifact = exportReview(
      { graph, notes, snapshots },
      { format: "sarif", attachSnapshots: true },
    );
    const sarif = JSON.parse(artifact.body) as {
      version: string;
      runs: Array<{
        results: Array<{ ruleId: string; level: string }>;
        properties: {
          topo: { notes: NoteRecord[]; snapshotReferences: unknown[] };
        };
      }>;
    };

    expect(artifact.mimeType).toContain("application/sarif+json");
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results[0]).toMatchObject({
      ruleId: "finding:save-button",
      level: "error",
    });
    expect(sarif.runs[0]?.properties.topo.notes[0]?.id).toBe("note:dashboard");
    expect(sarif.runs[0]?.properties.topo.snapshotReferences).toHaveLength(1);
  });

  it("escapes user content in a self-contained HTML report", () => {
    const artifact = exportReview({ graph, notes }, { format: "html" });

    expect(artifact.fileName).toBe("TOPO_REVIEW.html");
    expect(artifact.body).toContain("<!doctype html>");
    expect(artifact.body).toContain("Save &lt;button&gt; has no effect");
    expect(artifact.body).toContain("Review &lt;dashboard&gt;");
    expect(artifact.body).toContain("empty state &amp; retry");
    expect(artifact.body).not.toContain("<script");
  });

  it("honors findings-only and notes-only exports without changing coverage", () => {
    const findings = exportReview(
      { graph, notes },
      { format: "markdown", include: "findings" },
    );
    const notesOnly = exportReview(
      { graph, notes },
      { format: "html", include: "notes" },
    );

    expect(findings.body).toContain("## Findings (1)");
    expect(findings.body).not.toContain("## Notes (1)");
    expect(findings.body).toContain("## Screens");
    expect(notesOnly.body).toContain("Notes (1)");
    expect(notesOnly.body).not.toContain("Findings (1)");
  });

  it("rejects unsupported runtime options", () => {
    expect(() =>
      exportReview(
        { graph, notes },
        { format: "pdf" as unknown as "markdown" },
      ),
    ).toThrow("Unsupported review export format");
  });
});
