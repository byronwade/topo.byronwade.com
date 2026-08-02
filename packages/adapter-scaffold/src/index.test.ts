import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  defineApplicationRuntimeAdapter,
  type ApplicationRuntimeAdapter,
} from "@topo/application-runtime";
import {
  createFrameworkAdapterRegistry,
  type FrameworkAdapter,
} from "@topo/framework-adapter";
import {
  defineApiEndpointAdapter,
  type ApiEndpointAdapter,
} from "@topo/endpoint-adapter";
import {
  defineFlowDiscoveryAdapter,
  type FlowDiscoveryAdapter,
} from "@topo/flow-adapter";
import {
  createComponentPreviewAdapterRegistry,
  type ComponentPreviewAdapter,
} from "@topo/preview-adapter";

import {
  AdapterScaffoldManifestSchema,
  applyAdapterScaffold,
  inspectAdapterScaffolds,
  planAdapterScaffold,
  verifyAdapterScaffolds,
  type AdapterScaffoldKind,
  type AdapterScaffoldPlan,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function projectFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "topo-adapter-"));
  temporaryDirectories.push(directory);
  // The implementation exposes the physical project root for containment
  // checks. Canonicalize the fixture too because Windows may return an 8.3
  // short path from mkdtemp while realpath returns the long path.
  return realpath(directory);
}

const cases: Array<{
  kind: AdapterScaffoldKind;
  configKey:
    | "frameworkAdapters"
    | "componentPreviewAdapters"
    | "apiEndpointAdapters"
    | "flowAdapters"
    | "applicationRuntimeAdapters";
  namedExport:
    | "frameworkAdapter"
    | "componentPreviewAdapter"
    | "apiEndpointAdapter"
    | "flowDiscoveryAdapter"
    | "applicationRuntimeAdapter";
}> = [
  {
    kind: "framework",
    configKey: "frameworkAdapters",
    namedExport: "frameworkAdapter",
  },
  {
    kind: "component-preview",
    configKey: "componentPreviewAdapters",
    namedExport: "componentPreviewAdapter",
  },
  {
    kind: "api-endpoint",
    configKey: "apiEndpointAdapters",
    namedExport: "apiEndpointAdapter",
  },
  {
    kind: "flow-discovery",
    configKey: "flowAdapters",
    namedExport: "flowDiscoveryAdapter",
  },
  {
    kind: "application-runtime",
    configKey: "applicationRuntimeAdapters",
    namedExport: "applicationRuntimeAdapter",
  },
];

describe("adapter scaffold", () => {
  it.each(cases)(
    "plans a machine-readable $kind adapter without writing",
    async ({ kind, configKey, namedExport }) => {
      const projectRoot = await projectFixture();

      const plan = await planAdapterScaffold({
        projectRoot,
        kind,
        id: "acme.routes",
        displayName: "Acme routes",
      });

      expect(plan).toMatchObject({
        schemaVersion: 1,
        status: "ready",
        projectRoot,
        outputDirectory: "topo/adapters/acme-routes",
        registration: {
          configKey,
          moduleSpecifier: "./topo/adapters/acme-routes/index.mjs",
        },
        conflicts: [],
      });
      expect(plan.files.map((file) => file.path)).toEqual([
        "adapter.json",
        "index.mjs",
        "index.test.mjs",
        "README.md",
      ]);
      expect(
        plan.files.find((file) => file.path === "index.mjs")?.content,
      ).toContain(`export const ${namedExport}`);
      await expect(
        readFile(
          path.join(
            projectRoot,
            "topo",
            "adapters",
            "acme-routes",
            "index.mjs",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("verifies every local adapter through its public contract", async () => {
    const projectRoot = await projectFixture();
    for (const { kind } of cases) {
      await applyAdapterScaffold(
        await planAdapterScaffold({
          projectRoot,
          kind,
          id: `acme.${kind.replaceAll("-", ".")}`,
          displayName: `Acme ${kind}`,
        }),
      );
    }

    const report = await verifyAdapterScaffolds(projectRoot);

    expect(report).toMatchObject({
      schemaVersion: 1,
      status: "pass",
      summary: {
        checked: 5,
        passed: 5,
        failed: 0,
        issues: 0,
        malformed: 0,
      },
      issues: [],
    });
    expect(report.adapters.map((adapter) => adapter.kind)).toEqual([
      "api-endpoint",
      "application-runtime",
      "component-preview",
      "flow-discovery",
      "framework",
    ]);
    expect(
      report.adapters.every(
        (adapter) =>
          adapter.checks.map((check) => check.id).join(",") ===
            "manifest,module,identity,empty-context" &&
          adapter.checks.every((check) => check.status === "pass"),
      ),
    ).toBe(true);
  });

  it("reports manifest identity drift and contract-invalid execution", async () => {
    const projectRoot = await projectFixture();
    const framework = await applyAdapterScaffold(
      await planAdapterScaffold({
        projectRoot,
        kind: "framework",
        id: "acme.routes",
        displayName: "Acme routes",
      }),
    );
    await writeFile(
      path.join(projectRoot, framework.outputDirectory, "index.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.drifted",
  displayName: "Acme routes",
  detect: () => [{ framework: "acme", confidence: 2, reasons: [] }],
  scan: () => ({ routes: [] }),
};
`,
      "utf8",
    );

    const report = await verifyAdapterScaffolds(projectRoot, {
      id: "acme.routes",
    });

    expect(report.status).toBe("fail");
    expect(report.summary).toEqual({
      checked: 1,
      passed: 0,
      failed: 1,
      issues: 0,
      malformed: 0,
    });
    expect(report.adapters[0]?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "identity", status: "fail" }),
        expect.objectContaining({ id: "empty-context", status: "fail" }),
      ]),
    );
  });

  it("returns an explicit source issue when no local manifests exist", async () => {
    const report = await verifyAdapterScaffolds(await projectFixture());

    expect(report).toMatchObject({
      status: "fail",
      summary: {
        checked: 0,
        passed: 0,
        failed: 0,
        issues: 1,
        malformed: 0,
      },
      issues: [
        {
          filePath: "topo/adapters",
          message: "No local adapter manifests were found.",
        },
      ],
    });
  });

  it.each(cases)(
    "writes a contract-valid zero-dependency $kind adapter atomically",
    async ({ kind, namedExport }) => {
      const projectRoot = await projectFixture();
      const plan = await planAdapterScaffold({
        projectRoot,
        kind,
        id: `acme.${kind.replaceAll("-", ".")}`,
        displayName: `Acme ${kind}`,
      });

      const result = await applyAdapterScaffold(plan);
      const outputPath = path.join(projectRoot, result.outputDirectory);
      const manifest = AdapterScaffoldManifestSchema.parse(
        JSON.parse(
          await readFile(path.join(outputPath, "adapter.json"), "utf8"),
        ),
      );
      const source = await readFile(path.join(outputPath, "index.mjs"), "utf8");
      const generatedTest = await readFile(
        path.join(outputPath, "index.test.mjs"),
        "utf8",
      );
      const loaded = (await import(
        `${pathToFileURL(path.join(outputPath, "index.mjs")).href}?test=${Date.now()}`
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        schemaVersion: 1,
        status: "created",
        outputDirectory: plan.outputDirectory,
        createdPaths: plan.files.map((file) =>
          path.posix.join(plan.outputDirectory, file.path),
        ),
      });
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        kind,
        id: `acme.${kind.replaceAll("-", ".")}`,
        entry: "index.mjs",
        test: "index.test.mjs",
        source: "local",
      });
      expect(source).not.toContain("@topo/");
      expect(generatedTest).toContain("node:test");
      expect(loaded.default).toBe(loaded[namedExport]);

      if (kind === "framework") {
        const registry = createFrameworkAdapterRegistry([
          loaded.default as FrameworkAdapter,
        ]);
        await expect(
          registry.scan({
            rootDir: projectRoot,
            files: [],
            packageNames: new Set(),
            readFile: async () => "",
          }),
        ).resolves.toMatchObject({ routes: [] });
      } else if (kind === "component-preview") {
        expect(generatedTest).toContain("await adapter.resolveCaptureUrl");
        const registry = createComponentPreviewAdapterRegistry([
          loaded.default as ComponentPreviewAdapter,
        ]);
        await expect(
          registry.scan({
            rootDir: projectRoot,
            files: [],
            packageNames: new Set(),
            readFile: async () => "",
          }),
        ).resolves.toMatchObject({ previews: [] });
      } else if (kind === "api-endpoint") {
        expect(
          defineApiEndpointAdapter(loaded.default as ApiEndpointAdapter),
        ).toBe(loaded.default);
      } else if (kind === "flow-discovery") {
        expect(
          defineFlowDiscoveryAdapter(loaded.default as FlowDiscoveryAdapter),
        ).toBe(loaded.default);
      } else {
        expect(
          defineApplicationRuntimeAdapter(
            loaded.default as ApplicationRuntimeAdapter,
          ),
        ).toBe(loaded.default);
      }
    },
  );

  it("rejects output paths that escape the project root", async () => {
    const projectRoot = await projectFixture();

    await expect(
      planAdapterScaffold({
        projectRoot,
        kind: "framework",
        id: "acme.routes",
        displayName: "Acme routes",
        outputDirectory: "../outside",
      }),
    ).rejects.toThrow("project-relative");
  });

  it("keeps custom output inside the canonical adapter catalog", async () => {
    const projectRoot = await projectFixture();

    await expect(
      planAdapterScaffold({
        projectRoot,
        kind: "framework",
        id: "acme.routes",
        displayName: "Acme routes",
        outputDirectory: "custom/acme-routes",
      }),
    ).rejects.toThrow("topo/adapters/<directory>");
  });

  it("rejects linked output ancestors that physically leave the project", async () => {
    const projectRoot = await projectFixture();
    const externalDirectory = await projectFixture();
    await symlink(
      externalDirectory,
      path.join(projectRoot, "topo"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      planAdapterScaffold({
        projectRoot,
        kind: "framework",
        id: "acme.routes",
        displayName: "Acme routes",
      }),
    ).rejects.toThrow("linked path");
  });

  it("reports an existing output as a conflict and refuses to overwrite it", async () => {
    const projectRoot = await projectFixture();
    const existing = path.join(
      projectRoot,
      "topo",
      "adapters",
      "custom-adapter",
    );
    await mkdir(existing, { recursive: true });

    const plan = await planAdapterScaffold({
      projectRoot,
      kind: "framework",
      id: "acme.routes",
      displayName: "Acme routes",
      outputDirectory: "topo/adapters/custom-adapter",
    });

    expect(plan).toMatchObject({
      status: "conflict",
      conflicts: ["topo/adapters/custom-adapter already exists"],
    });
    await expect(applyAdapterScaffold(plan)).rejects.toThrow(
      "no files were changed",
    );
  });

  it("revalidates caller-supplied plans before writing any files", async () => {
    const projectRoot = await projectFixture();
    const plan = await planAdapterScaffold({
      projectRoot,
      kind: "framework",
      id: "acme.routes",
      displayName: "Acme routes",
    });
    const forgedFilePlan = {
      ...plan,
      files: plan.files.map((file, index) =>
        index === 0 ? { ...file, path: "../escaped.json" } : file,
      ),
    } as AdapterScaffoldPlan;

    await expect(applyAdapterScaffold(forgedFilePlan)).rejects.toThrow(
      "invalid scaffold file set",
    );
    await expect(
      readFile(
        path.join(projectRoot, "topo", "adapters", "escaped.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const forgedOutputPlan = {
      ...plan,
      outputDirectory: "topo/adapters/../../escaped-adapter",
    };
    await expect(applyAdapterScaffold(forgedOutputPlan)).rejects.toThrow(
      "project-relative",
    );
  });

  it("rejects incoherent durable adapter identities and registrations", async () => {
    const projectRoot = await projectFixture();
    const plan = await planAdapterScaffold({
      projectRoot,
      kind: "framework",
      id: "acme.routes",
      displayName: "Acme routes",
    });
    const manifest = JSON.parse(
      plan.files.find((file) => file.path === "adapter.json")?.content ?? "{}",
    ) as Record<string, unknown>;

    expect(
      AdapterScaffoldManifestSchema.safeParse({
        ...manifest,
        id: "Invalid Adapter",
      }).success,
    ).toBe(false);
    expect(
      AdapterScaffoldManifestSchema.safeParse({
        ...manifest,
        displayName: "   ",
      }).success,
    ).toBe(false);
    expect(
      AdapterScaffoldManifestSchema.safeParse({
        ...manifest,
        registration: {
          configKey: "applicationRuntimeAdapters",
          moduleSpecifier: plan.registration.moduleSpecifier,
        },
      }).success,
    ).toBe(false);
  });

  it("inspects durable manifests and preserves malformed sources as issues", async () => {
    const projectRoot = await projectFixture();
    await applyAdapterScaffold(
      await planAdapterScaffold({
        projectRoot,
        kind: "framework",
        id: "acme.routes",
        displayName: "Acme routes",
      }),
    );
    const malformedDirectory = path.join(
      projectRoot,
      "topo",
      "adapters",
      "malformed",
    );
    await mkdir(malformedDirectory, { recursive: true });
    await writeFile(
      path.join(malformedDirectory, "adapter.json"),
      '{"schemaVersion":1,"kind":"framework"}\n',
    );
    const misdirectedDirectory = path.join(
      projectRoot,
      "topo",
      "adapters",
      "misdirected",
    );
    await mkdir(misdirectedDirectory, { recursive: true });
    await writeFile(
      path.join(misdirectedDirectory, "adapter.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "framework",
        id: "acme.misdirected",
        displayName: "Misdirected",
        source: "local",
        entry: "index.mjs",
        test: "index.test.mjs",
        registration: {
          configKey: "frameworkAdapters",
          moduleSpecifier: "./somewhere-else/index.mjs",
        },
        generatedBy: "topo adapters create",
      })}\n`,
    );

    const inspection = await inspectAdapterScaffolds(projectRoot);

    expect(inspection.adapters).toEqual([
      expect.objectContaining({
        filePath: "topo/adapters/acme-routes/adapter.json",
        manifest: expect.objectContaining({ id: "acme.routes" }),
      }),
    ]);
    expect(inspection.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "topo/adapters/malformed/adapter.json",
          message: expect.stringContaining("id"),
        }),
        expect.objectContaining({
          filePath: "topo/adapters/misdirected/adapter.json",
          message: expect.stringContaining("moduleSpecifier"),
        }),
      ]),
    );
    expect(inspection.issues).toHaveLength(2);
  });
});
