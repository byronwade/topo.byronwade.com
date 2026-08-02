import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runAdapterCommand } from "./adapter-command.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function projectFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "topo-adapter-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("adapter CLI command", () => {
  it("prints a bounded JSON dry-run without writing", async () => {
    const projectRoot = await projectFixture();
    const lines: string[] = [];

    await runAdapterCommand(
      "create",
      projectRoot,
      [
        "--kind",
        "framework",
        "--id",
        "acme.remix",
        "--name",
        "Remix",
        "--dry-run",
        "--json",
      ],
      (line) => lines.push(line),
    );

    const report = JSON.parse(lines.join("\n")) as {
      status: string;
      dryRun: boolean;
      operations: Array<{ path: string; action: string; bytes: number }>;
      registration: { configKey: string; moduleSpecifier: string };
    };
    expect(report).toMatchObject({
      status: "ready",
      dryRun: true,
      registration: {
        configKey: "frameworkAdapters",
        moduleSpecifier: "./topo/adapters/acme-remix/index.mjs",
      },
    });
    expect(report.operations).toHaveLength(4);
    expect(
      report.operations.every((operation) => operation.action === "create"),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain(
      "export const frameworkAdapter",
    );
    await expect(
      readFile(
        path.join(
          projectRoot,
          "topo",
          "adapters",
          "acme-remix",
          "adapter.json",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates the adapter and returns exact registration guidance", async () => {
    const projectRoot = await projectFixture();
    const lines: string[] = [];

    await runAdapterCommand(
      "create",
      projectRoot,
      [
        "--kind",
        "component-preview",
        "--id",
        "acme.preview",
        "--name",
        "Acme previews",
      ],
      (line) => lines.push(line),
    );

    expect(lines).toEqual(
      expect.arrayContaining([
        "Created component-preview adapter acme.preview in topo/adapters/acme-preview.",
        'Register in topo.config.ts: extensions: { componentPreviewAdapters: ["./topo/adapters/acme-preview/index.mjs"] }',
        "Test: node --test topo/adapters/acme-preview/index.test.mjs",
      ]),
    );
    await expect(
      readFile(
        path.join(
          projectRoot,
          "topo",
          "adapters",
          "acme-preview",
          "adapter.json",
        ),
        "utf8",
      ),
    ).resolves.toContain('"kind": "component-preview"');
  });

  it("emits one post-write JSON result for a successful create", async () => {
    const projectRoot = await projectFixture();
    const lines: string[] = [];

    await runAdapterCommand(
      "create",
      projectRoot,
      [
        "--kind",
        "framework",
        "--id",
        "acme.remix",
        "--name",
        "Remix",
        "--json",
      ],
      (line) => lines.push(line),
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      schemaVersion: 1,
      status: "created",
      dryRun: false,
      outputDirectory: "topo/adapters/acme-remix",
      createdPaths: [
        "topo/adapters/acme-remix/adapter.json",
        "topo/adapters/acme-remix/index.mjs",
        "topo/adapters/acme-remix/index.test.mjs",
        "topo/adapters/acme-remix/README.md",
      ],
    });
  });

  it("checks one generated adapter through the versioned conformance report", async () => {
    const projectRoot = await projectFixture();
    await runAdapterCommand(
      "create",
      projectRoot,
      ["--kind", "framework", "--id", "acme.remix", "--name", "Remix"],
      () => undefined,
    );
    const lines: string[] = [];

    await runAdapterCommand(
      "check",
      projectRoot,
      ["--id", "acme.remix", "--json"],
      (line) => lines.push(line),
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      schemaVersion: 1,
      status: "pass",
      selectedId: "acme.remix",
      summary: {
        checked: 1,
        passed: 1,
        failed: 0,
        issues: 0,
        malformed: 0,
      },
      adapters: [
        {
          id: "acme.remix",
          kind: "framework",
          status: "pass",
        },
      ],
    });
  });

  it("returns parseable failure evidence when adapter identity drifts", async () => {
    const projectRoot = await projectFixture();
    await runAdapterCommand(
      "create",
      projectRoot,
      [
        "--kind",
        "application-runtime",
        "--id",
        "acme.runtime",
        "--name",
        "Acme runtime",
      ],
      () => undefined,
    );
    await writeFile(
      path.join(projectRoot, "topo", "adapters", "acme-runtime", "index.mjs"),
      `export default {
  apiVersion: 1,
  id: "acme.drifted",
  displayName: "Acme runtime",
  resolve: () => undefined,
};
`,
      "utf8",
    );
    const lines: string[] = [];

    await expect(
      runAdapterCommand(
        "check",
        projectRoot,
        ["--id", "acme.runtime", "--json"],
        (line) => lines.push(line),
      ),
    ).rejects.toThrow("Adapter conformance failed");

    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines[0] ?? "{}") as {
      status: string;
      adapters: Array<{ checks: Array<{ id: string; status: string }> }>;
    };
    expect(report.status).toBe("fail");
    expect(report.adapters[0]?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "identity", status: "fail" }),
      ]),
    );
  });

  it("requires explicit kind, id, and display name", async () => {
    const projectRoot = await projectFixture();

    await expect(
      runAdapterCommand("create", projectRoot, ["--kind", "framework"]),
    ).rejects.toThrow("adapters create requires --kind, --id, and --name");
  });

  it("rejects missing values, duplicate flags, unknown options, and extra positionals", async () => {
    const projectRoot = await projectFixture();
    const invalidCases: Array<{ args: string[]; message: string }> = [
      {
        args: ["--kind", "framework", "--id", "acme.remix", "--name", "--json"],
        message: "--name requires a value",
      },
      {
        args: [
          "--kind",
          "framework",
          "--kind",
          "framework",
          "--id",
          "acme.remix",
          "--name",
          "Remix",
        ],
        message: "Duplicate option --kind",
      },
      {
        args: [
          "--kind",
          "framework",
          "--id",
          "acme.remix",
          "--name",
          "Remix",
          "--surprise",
        ],
        message: "Unknown option --surprise",
      },
      {
        args: [
          "first",
          "second",
          "--kind",
          "framework",
          "--id",
          "acme.remix",
          "--name",
          "Remix",
        ],
        message: "Unexpected positional argument second",
      },
    ];

    for (const invalid of invalidCases) {
      await expect(
        runAdapterCommand("create", projectRoot, invalid.args),
      ).rejects.toThrow(invalid.message);
    }
    await expect(
      readFile(
        path.join(
          projectRoot,
          "topo",
          "adapters",
          "acme-remix",
          "adapter.json",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
