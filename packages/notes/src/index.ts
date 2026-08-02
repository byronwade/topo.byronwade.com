import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  NOTE_ANCHOR_STATUSES,
  NOTE_STATUSES,
  NOTE_TARGET_KINDS,
  NOTE_TYPES,
  NOTE_VERSION,
  NoteAnchorSchema,
  NoteAnchorStatusSchema,
  NoteIdSchema,
  NoteRecordSchema,
  NoteStatusSchema,
  NoteTargetKindSchema,
  NoteTypeSchema,
  UpdateNoteInputSchema,
  WriteNoteInputSchema,
  type NoteAnchor,
  type NoteAnchorStatus,
  type NoteRecord,
  type NoteStatus,
  type NoteTargetKind,
  type NoteType,
  type UpdateNoteInput,
  type WriteNoteInput,
} from "@topo/schema";
import { z } from "zod";

export {
  NOTE_ANCHOR_STATUSES,
  NOTE_STATUSES,
  NOTE_TARGET_KINDS,
  NOTE_TYPES,
  NOTE_VERSION,
  NoteAnchorSchema,
  NoteAnchorStatusSchema,
  NoteIdSchema,
  NoteRecordSchema,
  NoteStatusSchema,
  NoteTargetKindSchema,
  NoteTypeSchema,
  UpdateNoteInputSchema,
  WriteNoteInputSchema,
};
export type {
  NoteAnchor,
  NoteAnchorStatus,
  NoteRecord,
  NoteStatus,
  NoteTargetKind,
  NoteType,
  UpdateNoteInput,
  WriteNoteInput,
};

export interface NoteReadIssue {
  filePath: string;
  message: string;
}

export interface NoteInspection {
  notes: NoteRecord[];
  issues: NoteReadIssue[];
}

export interface NoteStore {
  list(): Promise<NoteRecord[]>;
  inspect(): Promise<NoteInspection>;
  get(id: string): Promise<NoteRecord | undefined>;
  write(input: WriteNoteInput): Promise<NoteRecord>;
  update(id: string, input: UpdateNoteInput): Promise<NoteRecord | undefined>;
  remove(id: string): Promise<boolean>;
}

function notesDirectory(rootDir: string): string {
  return path.join(path.resolve(rootDir), ".topo", "notes");
}

function fileNameFor(id: string): string {
  return `${encodeURIComponent(NoteIdSchema.parse(id))}.md`;
}

function legacyFileNameFor(id: string): string {
  return `${NoteIdSchema.parse(id).replace(/[^a-zA-Z0-9_-]/g, "-")}.md`;
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return z.string().parse(JSON.parse(trimmed) as unknown);
    } catch {
      throw new Error("Note frontmatter contains an invalid quoted string");
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function optionalJsonAnchor(value: string | undefined): NoteAnchor | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Note anchor is not valid JSON");
  }
  return NoteAnchorSchema.parse(parsed);
}

export function countNoteAnchorSignals(anchor: NoteAnchor | undefined): number {
  if (!anchor) return 0;
  return [
    anchor.source,
    anchor.componentSymbol,
    anchor.role || anchor.accessibleName,
    anchor.testLocator,
    anchor.domFingerprint,
    anchor.coordinates,
  ].filter(Boolean).length;
}

export function renderNoteMarkdown(noteInput: NoteRecord): string {
  const note = NoteRecordSchema.parse(noteInput);
  const frontmatter = [
    "---",
    `version: ${note.version}`,
    `id: ${note.id}`,
    `type: ${note.type}`,
    `title: ${JSON.stringify(note.title)}`,
    ...(note.targetKind ? [`targetKind: ${note.targetKind}`] : []),
    ...(note.targetId ? [`targetId: ${note.targetId}`] : []),
    ...(note.targetRoute ? [`targetRoute: ${note.targetRoute}`] : []),
    `status: ${note.status}`,
    ...(note.author ? [`author: ${JSON.stringify(note.author)}`] : []),
    ...(note.anchor ? [`anchor: ${JSON.stringify(note.anchor)}`] : []),
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    "---",
    "",
    note.body.trim(),
    "",
  ];
  return frontmatter.join("\n");
}

export function parseNoteMarkdown(markdown: string): NoteRecord {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("Note is missing YAML frontmatter");
  }
  const closing = normalized.indexOf("\n---", 4);
  if (closing === -1) throw new Error("Note has unterminated YAML frontmatter");

  const values = new Map<string, string>();
  for (const line of normalized.slice(4, closing).split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    values.set(
      line.slice(0, separator).trim(),
      parseScalar(line.slice(separator + 1)),
    );
  }

  const id = values.get("id");
  const title = values.get("title");
  const createdAt = values.get("createdAt");
  const updatedAt = values.get("updatedAt");
  if (!id || !title || !createdAt || !updatedAt) {
    throw new Error("Note frontmatter is missing required fields");
  }

  const versionValue = values.get("version");
  if (versionValue && versionValue !== String(NOTE_VERSION)) {
    throw new Error(`Unsupported note version "${versionValue}"`);
  }
  const typeValue = values.get("type") ?? "screen";
  if (!NOTE_TYPES.includes(typeValue as NoteType)) {
    throw new Error(`Unsupported note type "${typeValue}"`);
  }
  const targetKindValue = values.get("targetKind");
  if (
    targetKindValue &&
    !NOTE_TARGET_KINDS.includes(targetKindValue as NoteTargetKind)
  ) {
    throw new Error(`Unsupported note target kind "${targetKindValue}"`);
  }

  return NoteRecordSchema.parse({
    version: NOTE_VERSION,
    id,
    type: typeValue,
    title,
    body: normalized.slice(closing + 4).trim(),
    targetKind: targetKindValue,
    targetId: values.get("targetId"),
    targetRoute: values.get("targetRoute"),
    status: values.get("status") ?? "open",
    author: values.get("author"),
    anchor: optionalJsonAnchor(values.get("anchor")),
    createdAt,
    updatedAt,
  });
}

async function writeNoteFile(
  directory: string,
  note: NoteRecord,
): Promise<void> {
  const outputPath = path.join(directory, fileNameFor(note.id));
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, renderNoteMarkdown(note), "utf8");
    await rename(temporaryPath, outputPath);
    const legacyPath = path.join(directory, legacyFileNameFor(note.id));
    if (legacyPath !== outputPath) {
      await unlink(legacyPath).catch(() => undefined);
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function clearable<T>(value: T | null | undefined, fallback: T | undefined) {
  return value === null ? undefined : (value ?? fallback);
}

function assertExplicitTarget(note: NoteRecord): void {
  if (note.targetId && !note.targetKind) {
    throw new Error("targetId requires targetKind");
  }
}

export function createNoteStore(rootDir: string): NoteStore {
  const directory = notesDirectory(rootDir);

  const inspect = async (): Promise<NoteInspection> => {
    await mkdir(directory, { recursive: true });
    const names = (await readdir(directory))
      .filter((name) => name.endsWith(".md"))
      .sort();
    const notes: NoteRecord[] = [];
    const issues: NoteReadIssue[] = [];
    for (const name of names) {
      try {
        notes.push(
          parseNoteMarkdown(await readFile(path.join(directory, name), "utf8")),
        );
      } catch (error) {
        issues.push({
          filePath: `.topo/notes/${name}`,
          message:
            error instanceof Error ? error.message : "Unable to parse note",
        });
      }
    }
    return {
      notes: notes.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
      issues,
    };
  };

  return {
    list: async () => (await inspect()).notes,
    inspect,
    async get(id) {
      const names = [...new Set([fileNameFor(id), legacyFileNameFor(id)])];
      for (const name of names) {
        try {
          return parseNoteMarkdown(
            await readFile(path.join(directory, name), "utf8"),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
      }
      return undefined;
    },
    async write(inputValue) {
      await mkdir(directory, { recursive: true });
      const input = WriteNoteInputSchema.parse(inputValue);
      const now = new Date().toISOString();
      const id = input.id ?? randomUUID();
      const existing = input.id ? await this.get(id) : undefined;
      const note = NoteRecordSchema.parse({
        version: NOTE_VERSION,
        id,
        type: input.type ?? existing?.type ?? "screen",
        title: input.title,
        body: input.body ?? existing?.body ?? "",
        targetKind: input.targetKind ?? existing?.targetKind,
        targetId: input.targetId ?? existing?.targetId,
        targetRoute: input.targetRoute ?? existing?.targetRoute,
        status: input.status ?? existing?.status ?? "open",
        author: input.author ?? existing?.author,
        anchor: input.anchor ?? existing?.anchor,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      assertExplicitTarget(note);
      await writeNoteFile(directory, note);
      return note;
    },
    async update(id, inputValue) {
      const input = UpdateNoteInputSchema.parse(inputValue);
      const existing = await this.get(id);
      if (!existing) return undefined;
      const note = NoteRecordSchema.parse({
        ...existing,
        type: input.type ?? existing.type,
        title: input.title ?? existing.title,
        body: input.body ?? existing.body,
        targetKind: clearable(input.targetKind, existing.targetKind),
        targetId: clearable(input.targetId, existing.targetId),
        targetRoute: clearable(input.targetRoute, existing.targetRoute),
        status: input.status ?? existing.status,
        author: clearable(input.author, existing.author),
        anchor: clearable(input.anchor, existing.anchor),
        updatedAt: new Date().toISOString(),
      });
      assertExplicitTarget(note);
      await writeNoteFile(directory, note);
      return note;
    },
    async remove(id) {
      let removed = false;
      const names = [...new Set([fileNameFor(id), legacyFileNameFor(id)])];
      for (const name of names) {
        try {
          await unlink(path.join(directory, name));
          removed = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      return removed;
    },
  };
}
