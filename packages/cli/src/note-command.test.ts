import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNoteStore } from "@topo/notes";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runNoteCommand } from "./note-command.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function noteCommandFixture() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "topo-cli-notes-"));
  temporaryDirectories.push(projectRoot);
  const store = createNoteStore(projectRoot);
  const lines: string[] = [];
  const syncContext = vi.fn(async () => undefined);
  return {
    projectRoot,
    store,
    lines,
    syncContext,
    dependencies: {
      projectRoot,
      store,
      syncContext,
      write: (line: string) => lines.push(line),
    },
  };
}

describe("note CLI commands", () => {
  it("adds, shows, updates, clears, and removes one durable note", async () => {
    const fixture = await noteCommandFixture();

    await runNoteCommand(
      "add",
      [
        "--id",
        "note:cli-review",
        "--title",
        "Review assignment flow",
        "--body",
        "Confirm the final state.",
        "--type",
        "decision",
        "--status",
        "resolved",
        "--author",
        "Topo CLI",
        "--json",
      ],
      fixture.dependencies,
    );

    expect(JSON.parse(fixture.lines.pop() ?? "{}")).toMatchObject({
      id: "note:cli-review",
      title: "Review assignment flow",
      type: "decision",
      status: "resolved",
      author: "Topo CLI",
    });
    expect(fixture.syncContext).toHaveBeenCalledTimes(1);

    await runNoteCommand(
      "show",
      ["--id", "note:cli-review", "--json"],
      fixture.dependencies,
    );
    expect(JSON.parse(fixture.lines.pop() ?? "{}")).toMatchObject({
      id: "note:cli-review",
      body: "Confirm the final state.",
    });
    expect(fixture.syncContext).toHaveBeenCalledTimes(1);

    await runNoteCommand(
      "update",
      [
        "--id",
        "note:cli-review",
        "--title",
        "Review assignment completion",
        "--status",
        "open",
        "--target-kind",
        "screen",
        "--target-id",
        "screen:next-app:/jobs",
        "--route",
        "/jobs",
        "--json",
      ],
      fixture.dependencies,
    );

    expect(JSON.parse(fixture.lines.pop() ?? "{}")).toMatchObject({
      id: "note:cli-review",
      title: "Review assignment completion",
      status: "open",
      targetKind: "screen",
      targetId: "screen:next-app:/jobs",
      targetRoute: "/jobs",
    });
    expect(fixture.syncContext).toHaveBeenCalledTimes(2);

    await runNoteCommand(
      "update",
      [
        "--id",
        "note:cli-review",
        "--clear-target",
        "--clear-route",
        "--clear-author",
        "--json",
      ],
      fixture.dependencies,
    );
    expect(JSON.parse(fixture.lines.pop() ?? "{}")).not.toHaveProperty(
      "targetId",
    );
    expect(await fixture.store.get("note:cli-review")).toMatchObject({
      id: "note:cli-review",
      title: "Review assignment completion",
      targetKind: undefined,
      targetId: undefined,
      targetRoute: undefined,
      author: undefined,
    });
    expect(fixture.syncContext).toHaveBeenCalledTimes(3);

    await runNoteCommand(
      "remove",
      ["--id", "note:cli-review", "--json"],
      fixture.dependencies,
    );
    expect(JSON.parse(fixture.lines.pop() ?? "{}")).toEqual({
      id: "note:cli-review",
      removed: true,
    });
    expect(await fixture.store.get("note:cli-review")).toBeUndefined();
    expect(fixture.syncContext).toHaveBeenCalledTimes(4);
  });

  it("rejects invalid mutations before touching the store", async () => {
    const fixture = await noteCommandFixture();

    await expect(
      runNoteCommand(
        "add",
        ["--title", "Invalid", "--type", "mystery"],
        fixture.dependencies,
      ),
    ).rejects.toThrow(
      "--type must be one of: element, screen, region, flow, checklist, decision, canvas",
    );
    await expect(
      runNoteCommand(
        "add",
        ["--title", "Invalid", "--target-id", "screen:missing-kind"],
        fixture.dependencies,
      ),
    ).rejects.toThrow("--target-id requires --target-kind");
    await expect(
      runNoteCommand("update", ["--id", "note:missing"], fixture.dependencies),
    ).rejects.toThrow("notes update requires at least one change option");
    await expect(
      runNoteCommand("remove", ["--id", "note:missing"], fixture.dependencies),
    ).rejects.toThrow("Note not found: note:missing");

    expect(await fixture.store.list()).toEqual([]);
    expect(fixture.syncContext).not.toHaveBeenCalled();
  });
});
