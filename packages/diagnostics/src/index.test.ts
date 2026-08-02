import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emptyApplicationGraph,
  type InteractionProbeArtifact,
} from "@topo/schema";

import { runDiagnosticCheck, runDiagnostics } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("diagnostics", () => {
  it("returns a bounded quality-gate report with explicit threshold semantics", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-diagnostic-check-"),
    );
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "page.tsx"),
      "export default () => <button>Unused</button>;\n",
    );

    const blocked = await runDiagnosticCheck({
      projectRoot: directory,
      rootDir: directory,
      graph: emptyApplicationGraph(directory),
      failOn: "low",
      now: () => "2026-08-01T02:00:00.000Z",
    });
    const advisory = await runDiagnosticCheck({
      projectRoot: directory,
      rootDir: directory,
      graph: emptyApplicationGraph(directory),
      failOn: "medium",
      now: () => "2026-08-01T02:00:00.000Z",
    });

    expect(blocked).toMatchObject({
      schemaVersion: 1,
      mode: "static",
      ok: false,
      policy: { failOn: "low", routes: [] },
      summary: {
        findings: { total: 1, open: 1, blocking: 1 },
        probes: { total: 0, blocking: 0 },
      },
    });
    expect(advisory.ok).toBe(true);
    expect("graph" in blocked).toBe(false);
  });

  it("treats requested runtime activation errors as blocking evidence", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-diagnostic-check-runtime-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.screens = [
      {
        id: "fixture:/dashboard",
        kind: "screen",
        title: "Dashboard",
        routePath: "/dashboard",
        framework: "fixture",
        state: "default",
        group: "/",
        source: { filePath: "app/dashboard/page.tsx", line: 1 },
        renderStatus: "unseen",
        tags: [],
      },
    ];

    const report = await runDiagnosticCheck({
      projectRoot: directory,
      rootDir: directory,
      graph,
      runtime: true,
      routes: ["/dashboard"],
      failOn: "high",
      probe: async () => {
        throw new Error("Preview server unavailable");
      },
      now: () => "2026-08-01T02:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "runtime",
      ok: false,
      policy: { failOn: "high", routes: ["/dashboard"] },
      summary: {
        probes: { total: 1, activationErrors: 1, blocking: 1 },
      },
    });
    expect(report.interactionProbes[0]).toMatchObject({
      routePath: "/dashboard",
      status: "activation-error",
    });
  });

  it("combines static findings into the graph without launching a browser", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-diagnostics-"),
    );
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "page.tsx"),
      "export default () => <button>Unused</button>;\n",
    );
    const result = await runDiagnostics({
      rootDir: directory,
      graph: emptyApplicationGraph(directory),
    });
    expect(result.staticFilesScanned).toBe(1);
    expect(result.findings[0]?.title).toBe("Button may be inert");
    expect(result.graph.findings).toEqual(result.findings);
  });

  it("preserves findings contributed before the diagnostics pipeline", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-diagnostics-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.findings = [
      {
        id: "adapter:warning",
        severity: "low",
        status: "open",
        title: "Adapter warning",
        description: "A framework adapter contributed this finding.",
        evidence: ["adapter contract"],
        confidence: 1,
      },
    ];

    const result = await runDiagnostics({ rootDir: directory, graph });

    expect(
      result.findings.some((finding) => finding.id === "adapter:warning"),
    ).toBe(true);
  });

  it("continues route-scoped runtime probes and replaces stale generated findings", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-diagnostics-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.screens = ["/healthy", "/unavailable", "/preserved"].map(
      (routePath) => ({
        id: `fixture:${routePath}`,
        kind: "screen" as const,
        title: routePath,
        routePath,
        framework: "fixture",
        state: "default" as const,
        group: "/",
        source: { filePath: `app${routePath}/page.tsx`, line: 1 },
        renderStatus: "unseen" as const,
        tags: [],
      }),
    );
    graph.findings = [
      {
        id: "adapter:preserved",
        severity: "info",
        status: "open",
        title: "Adapter evidence",
        description: "Owned outside diagnostics.",
        evidence: ["adapter contract"],
        confidence: 1,
      },
      {
        id: "static:stale",
        severity: "low",
        status: "open",
        title: "Stale static finding",
        description: "Must be replaced by this static run.",
        evidence: ["old source"],
        confidence: 0.5,
      },
      {
        id: "interaction-probe:stale-healthy",
        severity: "low",
        status: "open",
        title: "Stale runtime finding",
        description: "Must be replaced for the rerun route.",
        evidence: ["Probe route: /healthy"],
        confidence: 0.5,
      },
      {
        id: "interaction-probe:preserved",
        severity: "low",
        status: "open",
        title: "Preserved runtime finding",
        description: "Belongs to a route outside this run.",
        evidence: ["Probe route: /preserved"],
        confidence: 0.5,
      },
    ];
    const observation: InteractionProbeArtifact = {
      version: 1,
      id: "interaction-probe:healthy-inert",
      routePath: "/healthy",
      screenId: "fixture:/healthy",
      control: {
        index: 0,
        id: "control:healthy-inert",
        label: "Watch tour",
        tagName: "button",
        role: "button",
        locator: "#tour",
      },
      status: "possibly-inert",
      effects: [],
      evidence: ["Activated #tour on /healthy"],
      observedAt: "2026-08-01T01:00:00.000Z",
    };
    const calledRoutes: string[] = [];

    const result = await runDiagnostics({
      rootDir: directory,
      graph,
      runtime: true,
      routes: ["/healthy", "/unavailable"],
      probe: async (options) => {
        calledRoutes.push(options.routePath);
        if (options.routePath === "/unavailable") {
          throw new Error("Preview server unavailable");
        }
        return {
          observations: [observation],
          findings: [
            {
              id: observation.id,
              severity: "low",
              status: "open",
              title: "Control may be inert",
              description: "No effect was observed.",
              evidence: [
                `Probe artifact: ${observation.id}`,
                "Probe route: /healthy",
              ],
              confidence: 0.82,
            },
          ],
        };
      },
      now: () => "2026-08-01T02:00:00.000Z",
    });

    expect(calledRoutes).toEqual(["/healthy", "/unavailable"]);
    expect(result.interactionProbes).toEqual(
      expect.arrayContaining([
        observation,
        expect.objectContaining({
          routePath: "/unavailable",
          status: "activation-error",
          error: "Preview server unavailable",
        }),
      ]),
    );
    expect(
      result.findings.some((finding) => finding.id === "static:stale"),
    ).toBe(false);
    expect(
      result.findings.some(
        (finding) => finding.id === "interaction-probe:stale-healthy",
      ),
    ).toBe(false);
    expect(
      result.findings.some(
        (finding) => finding.id === "interaction-probe:preserved",
      ),
    ).toBe(true);
    expect(
      result.findings.some((finding) => finding.id === "adapter:preserved"),
    ).toBe(true);
  });

  it("probes a dynamic route through its concrete path and keeps canonical evidence", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "topo-diagnostics-dynamic-"),
    );
    temporaryDirectories.push(directory);
    const graph = emptyApplicationGraph(directory);
    graph.screens = [
      {
        id: "fixture:/jobs/:jobId",
        kind: "screen",
        title: "Job",
        routePath: "/jobs/:jobId",
        framework: "fixture",
        state: "default",
        group: "/jobs",
        source: { filePath: "src/routes/jobs.$jobId.tsx", line: 1 },
        previewRoute: {
          version: 1,
          status: "configured",
          path: "/jobs/job-1042",
          source: "topo.config.ts",
        },
        renderStatus: "unseen",
        tags: [],
      },
    ];
    let received:
      | { routePath: string; previewPath?: string; screenId?: string }
      | undefined;

    const result = await runDiagnostics({
      rootDir: directory,
      graph,
      runtime: true,
      probe: async (options) => {
        received = options;
        return { observations: [], findings: [] };
      },
    });

    expect(received).toMatchObject({
      routePath: "/jobs/:jobId",
      previewPath: "/jobs/job-1042",
      screenId: "fixture:/jobs/:jobId",
    });
    expect(result.probedRoutes).toEqual(["/jobs/:jobId"]);
  });
});
