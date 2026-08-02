import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeStaticWorkspace,
  createStaticAnalysisSession,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("static analyzer", () => {
  it("keeps the permanent TanStack compatibility fixture free of diagnostic noise", async () => {
    const playgroundRoot = path.resolve(
      process.cwd(),
      "../../apps/playground-tanstack-router",
    );

    const result = await analyzeStaticWorkspace(playgroundRoot);

    expect(result.findings).toEqual([]);
  });

  it("recognizes a JSX boolean disabled button as an explicit state", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-static-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "page.tsx"),
      `<button disabled type="button">Saved locally</button>\n`,
    );

    const result = await analyzeStaticWorkspace(directory);

    expect(result.findings).toEqual([]);
  });

  it("analyzes Vue and Svelte templates without flagging native event syntax", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-static-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "Action.vue"),
      `<template><button @click="save">Save</button><form @submit="submit"></form></template>\n`,
    );
    await fs.writeFile(
      path.join(directory, "Action.svelte"),
      `<button onclick={save}>Save</button><form on:submit={submit}></form>\n`,
    );

    const result = await analyzeStaticWorkspace(directory);

    expect(result.filesScanned).toBe(2);
    expect(result.findings).toEqual([]);
  });

  it("reports evidence-based candidates without declaring controls broken", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-static-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "page.tsx"),
      `<main>\n  <button>Open</button>\n  <a href="#">Placeholder</a>\n  <div onClick={() => open()}>Clickable</div>\n</main>\n`,
    );

    const result = await analyzeStaticWorkspace(directory);
    expect(result.filesScanned).toBe(1);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((finding) => finding.status === "open")).toBe(
      true,
    );
    expect(
      result.findings.every((finding) => finding.evidence.length > 0),
    ).toBe(true);
    expect(
      result.findings.find((finding) => finding.title === "Button may be inert")
        ?.confidence,
    ).toBeGreaterThan(0.5);
  });

  it("updates only reported source records in a persistent session", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-static-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, "a.tsx"), "<button>A</button>\n");
    await fs.writeFile(path.join(directory, "b.tsx"), '<a href="#">B</a>\n');
    const session = createStaticAnalysisSession(directory);

    await expect(session.scan()).resolves.toMatchObject({
      filesScanned: 2,
      findings: [
        { title: "Button may be inert" },
        { title: "Link has a placeholder destination" },
      ],
    });
    await fs.writeFile(
      path.join(directory, "a.tsx"),
      "<button onClick={() => open()}>A</button>\n",
    );
    await fs.rm(path.join(directory, "b.tsx"));

    await expect(session.scan(["a.tsx", "b.tsx"])).resolves.toEqual({
      filesScanned: 1,
      findings: [],
    });
  });
});
