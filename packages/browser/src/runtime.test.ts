import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectBrowserRuntime } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("inspectBrowserRuntime", () => {
  it("checks the exact configured executable without launching it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "topo-browser-"));
    temporaryDirectories.push(directory);
    const executablePath = path.join(directory, "chromium.exe");
    await writeFile(executablePath, "fixture");

    await expect(inspectBrowserRuntime(executablePath)).resolves.toEqual({
      available: true,
      executablePath,
    });

    await expect(
      inspectBrowserRuntime(path.join(directory, "missing.exe")),
    ).resolves.toMatchObject({ available: false });
  });
});
