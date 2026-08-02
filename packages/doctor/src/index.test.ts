import { describe, expect, it } from "vitest";

import { defineConfig, type TopoProject } from "@topo/config";
import { makeTestGraph } from "@topo/test-utils";

import { runDoctor, type DoctorRuntimeEvidence } from "./index.js";

function project(config = defineConfig()): TopoProject {
  return {
    projectRoot: "C:/work/topo",
    sourceRoot: "C:/work/topo/apps/web",
    configPath: "C:/work/topo/topo.config.ts",
    config,
  };
}

const passingEvidence: DoctorRuntimeEvidence = {
  observedAt: "2026-08-01T06:00:00.000Z",
  nodeVersion: "24.14.0",
  browser: {
    available: true,
    executablePath: "C:/playwright/chromium.exe",
  },
  preview: { reachable: true, status: 200, latencyMs: 12 },
};

describe("runDoctor", () => {
  it("produces one stable, sanitized report from project and graph evidence", async () => {
    const report = await runDoctor({
      project: project(),
      graph: makeTestGraph({
        rootDir: "C:/work/topo/apps/web",
        framework: "next-app",
        screens: [
          {
            id: "screen:/",
            kind: "screen",
            title: "Home",
            routePath: "/",
            state: "default",
            framework: "next-app",
            source: { filePath: "app/page.tsx" },
            renderStatus: "unseen",
            group: "app",
            tags: [],
          },
        ],
      }),
      probe: async () => passingEvidence,
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      generatedAt: passingEvidence.observedAt,
      ok: true,
      summary: { total: 10, passed: 10, warnings: 0, errors: 0 },
    });
    expect(report.checks.map((item) => item.id)).toEqual([
      "runtime.node-version",
      "runtime.playwright-browser",
      "security.daemon-loopback",
      "security.preview-origin",
      "application.preview-reachable",
      "application.source-selection",
      "application.framework",
      "application.source-scan",
      "application.preview-routes",
      "application.preview-profiles",
    ]);
    expect(JSON.stringify(report)).not.toContain("cookies");
    expect(JSON.stringify(report)).not.toContain("localStorage");
  });

  it("distinguishes blocking errors from actionable warnings", async () => {
    const report = await runDoctor({
      project: project(
        defineConfig({
          daemon: { host: "0.0.0.0" },
          preview: { baseUrl: "https://preview.example.com" },
        }),
      ),
      graph: makeTestGraph({ framework: "unknown", screens: [] }),
      probe: async () => ({
        ...passingEvidence,
        nodeVersion: "22.1.0",
        browser: {
          available: false,
          executablePath: "C:/missing/chromium.exe",
          error: "not found",
        },
        preview: { reachable: false, latencyMs: 1500, error: "timeout" },
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({
      total: 10,
      passed: 3,
      warnings: 4,
      errors: 3,
    });
    expect(
      report.checks.find((item) => item.id === "runtime.playwright-browser"),
    ).toMatchObject({
      status: "warning",
      action: "pnpm exec playwright install chromium",
    });
    expect(
      report.checks.find((item) => item.id === "security.daemon-loopback"),
    ).toMatchObject({ status: "error" });
  });

  it("reports unresolved parameterized routes without exposing preview capabilities", async () => {
    const report = await runDoctor({
      project: project(),
      graph: makeTestGraph({
        rootDir: "C:/work/topo/apps/web",
        framework: "next-app",
        screens: [
          {
            id: "screen:/customers/[customerId]",
            kind: "screen",
            title: "Customer",
            routePath: "/customers/[customerId]",
            state: "default",
            framework: "next-app",
            source: { filePath: "app/customers/[customerId]/page.tsx" },
            previewRoute: {
              version: 1,
              status: "unresolved",
              reason:
                'Add preview.routes["/customers/[customerId]"] to topo.config.ts with one concrete local path.',
            },
            renderStatus: "blocked",
            group: "app",
            tags: [],
          },
        ],
      }),
      probe: async () => passingEvidence,
    });

    expect(
      report.checks.find((item) => item.id === "application.preview-routes"),
    ).toMatchObject({
      status: "warning",
      action: "Add preview.routes entries in topo.config.ts",
      evidence: {
        unresolvedRoutes: ["/customers/[customerId]"],
        configuredRoutes: [],
      },
    });
    expect(report.summary).toMatchObject({ total: 10, warnings: 1 });
    expect(JSON.stringify(report)).not.toContain("cookies");
  });

  it("warns when the project root silently combines multiple framework families", async () => {
    const report = await runDoctor({
      project: {
        ...project(defineConfig()),
        sourceRoot: "C:/work/topo",
      },
      graph: makeTestGraph({
        rootDir: "C:/work/topo",
        framework: "mixed",
        screens: [
          {
            id: "screen:/app",
            kind: "screen",
            title: "App",
            routePath: "/app",
            state: "default",
            framework: "next-app",
            source: { filePath: "apps/web/app/page.tsx" },
            renderStatus: "unseen",
            group: "app",
            tags: [],
          },
          {
            id: "screen:/jobs",
            kind: "screen",
            title: "Jobs",
            routePath: "/jobs",
            state: "default",
            framework: "tanstack-router",
            source: { filePath: "apps/operations/src/routes/jobs.tsx" },
            renderStatus: "unseen",
            group: "src",
            tags: [],
          },
        ],
      }),
      probe: async () => passingEvidence,
    });

    expect(
      report.checks.find((item) => item.id === "application.source-selection"),
    ).toMatchObject({
      status: "warning",
      action: "Set rootDir in topo.config.ts to one application directory",
      evidence: {
        configuredRootDir: ".",
        explicit: false,
        frameworkFamilies: ["next-app", "tanstack-router"],
      },
    });
    expect(report.summary).toMatchObject({ total: 10, warnings: 1 });
  });
});
