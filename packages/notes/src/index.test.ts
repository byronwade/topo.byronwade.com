import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countNoteAnchorSignals,
  createNoteStore,
  parseNoteMarkdown,
  renderNoteMarkdown,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("markdown note store", () => {
  it("round trips a note through frontmatter", () => {
    const note = {
      version: 1 as const,
      id: "note-1",
      type: "screen" as const,
      title: "Check empty state",
      body: "The empty state should explain the next action.",
      targetKind: "screen" as const,
      targetId: "screen-customers",
      targetRoute: "/customers",
      status: "open" as const,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:01.000Z",
    };
    expect(parseNoteMarkdown(renderNoteMarkdown(note))).toEqual(note);
  });

  it("reads pre-versioned notes as version 1", () => {
    const markdown = `---\nid: legacy\ntype: screen\ntitle: "Legacy"\ncreatedAt: 2026-07-31T00:00:00.000Z\nupdatedAt: 2026-07-31T00:00:00.000Z\n---\n\nStill readable.\n`;

    expect(parseNoteMarkdown(markdown)).toMatchObject({
      version: 1,
      id: "legacy",
      status: "open",
    });
  });

  it("round trips lifecycle and complete anchor evidence without hiding signals", () => {
    const note = {
      version: 1 as const,
      id: "note-anchored",
      type: "element" as const,
      title: "Check the hero",
      body: "The title must use approved wording.",
      targetKind: "screen" as const,
      targetId: "screen-home",
      targetRoute: "/",
      status: "resolved" as const,
      author: "byron",
      anchor: {
        status: "drifted" as const,
        source: { filePath: "app/page.tsx", line: 41, column: 3 },
        componentSymbol: "MarketingHero",
        role: "heading",
        accessibleName: "Welcome to Topo",
        testLocator: "hero-headline",
        domFingerprint: "a91c7f",
        coordinates: { x: 0.12, y: 0.2, width: 0.4, height: 0.1 },
        driftPixels: 14,
        verifiedAt: "2026-08-01T00:00:00.000Z",
      },
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const parsed = parseNoteMarkdown(renderNoteMarkdown(note));

    expect(parsed).toEqual(note);
    expect(countNoteAnchorSignals(parsed.anchor)).toBe(6);
  });

  it("rejects malformed inline anchor evidence", () => {
    const markdown = `---\nversion: 1\nid: invalid-anchor\ntype: element\ntitle: "Invalid anchor"\nstatus: open\nanchor: {not-json}\ncreatedAt: 2026-07-31T00:00:00.000Z\nupdatedAt: 2026-07-31T00:00:00.000Z\n---\n`;

    expect(() => parseNoteMarkdown(markdown)).toThrow(
      "Note anchor is not valid JSON",
    );
  });

  it("persists and lists notes under .topo", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-notes-"));
    temporaryDirectories.push(directory);
    const store = createNoteStore(directory);
    const created = await store.write({
      title: "First note",
      body: "Hello",
      targetRoute: "/",
    });

    expect(await store.get(created.id)).toMatchObject({
      title: "First note",
      body: "Hello",
    });
    expect(await store.list()).toHaveLength(1);
  });

  it("reports malformed notes instead of hiding them from readers", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-notes-"));
    temporaryDirectories.push(directory);
    const store = createNoteStore(directory);
    await fs.mkdir(path.join(directory, ".topo", "notes"), { recursive: true });
    await fs.writeFile(
      path.join(directory, ".topo", "notes", "broken.md"),
      "No frontmatter",
      "utf8",
    );

    const inspection = await store.inspect();

    expect(inspection.notes).toEqual([]);
    expect(inspection.issues[0]?.filePath).toBe(".topo/notes/broken.md");
  });

  it("reports unsupported note target kinds as read issues", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-notes-"));
    temporaryDirectories.push(directory);
    const store = createNoteStore(directory);
    await fs.mkdir(path.join(directory, ".topo", "notes"), { recursive: true });
    await fs.writeFile(
      path.join(directory, ".topo", "notes", "invalid-target.md"),
      `---\nversion: 1\nid: invalid-target\ntype: screen\ntitle: "Invalid target"\ntargetKind: mystery\ntargetId: unknown\ncreatedAt: 2026-07-31T00:00:00.000Z\nupdatedAt: 2026-07-31T00:00:00.000Z\n---\n`,
      "utf8",
    );

    expect((await store.inspect()).issues[0]?.message).toContain(
      "Unsupported note target kind",
    );
  });

  it("updates lifecycle and anchors atomically while preserving creation identity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T01:00:00.000Z"));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-notes-"));
    temporaryDirectories.push(directory);
    const store = createNoteStore(directory);
    const created = await store.write({
      id: "review-home",
      title: "Review home",
      body: "Initial copy",
      targetKind: "screen",
      targetRoute: "/",
    });

    vi.setSystemTime(new Date("2026-08-01T02:00:00.000Z"));
    const updated = await store.update(created.id, {
      title: "Review the home hero",
      status: "resolved",
      author: "local",
      anchor: {
        status: "attached",
        source: { filePath: "app/page.tsx", line: 1 },
        verifiedAt: "2026-08-01T02:00:00.000Z",
      },
    });

    expect(updated).toMatchObject({
      id: created.id,
      title: "Review the home hero",
      body: "Initial copy",
      status: "resolved",
      author: "local",
      createdAt: "2026-08-01T01:00:00.000Z",
      updatedAt: "2026-08-01T02:00:00.000Z",
      anchor: {
        status: "attached",
        source: { filePath: "app/page.tsx", line: 1 },
      },
    });
    expect(await store.update("missing", { status: "resolved" })).toBeUndefined();
    expect(
      (await fs.readdir(path.join(directory, ".topo", "notes"))).filter(
        (name) => name.endsWith(".tmp"),
      ),
    ).toEqual([]);
    expect(await store.remove(created.id)).toBe(true);
    expect(await store.remove(created.id)).toBe(false);
  });

  it("rejects note ids that cannot be used as stable file identities", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-notes-"));
    temporaryDirectories.push(directory);
    const store = createNoteStore(directory);

    await expect(
      store.write({ id: "../outside", title: "No escape" }),
    ).rejects.toThrow("Note id");
  });

  it("preserves colon-delimited canonical ids in Windows-safe filenames", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "topo-notes-"));
    temporaryDirectories.push(directory);
    const store = createNoteStore(directory);

    const created = await store.write({
      id: "note:customer-table-fixture",
      title: "Customer table fixture",
    });

    expect(created.id).toBe("note:customer-table-fixture");
    expect(await store.get(created.id)).toMatchObject({ id: created.id });
    expect(await fs.readdir(path.join(directory, ".topo", "notes"))).toContain(
      "note%3Acustomer-table-fixture.md",
    );
  });
});
