import path from "node:path";

import {
  NOTE_STATUSES,
  NOTE_TARGET_KINDS,
  NOTE_TYPES,
  type NoteRecord,
  type NoteStatus,
  type NoteStore,
  type NoteTargetKind,
  type NoteType,
  type UpdateNoteInput,
  type WriteNoteInput,
} from "@topo/notes";

type NoteCommand = "list" | "add" | "show" | "update" | "remove";
type WriteLine = (line: string) => void;

const NOTE_COMMANDS: readonly NoteCommand[] = [
  "list",
  "add",
  "show",
  "update",
  "remove",
];

export interface NoteCommandDependencies {
  readonly projectRoot: string;
  readonly store: NoteStore;
  readonly syncContext: () => Promise<void>;
  readonly write?: WriteLine;
}

interface ParsedNoteArgs {
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
}

const BOOLEAN_OPTIONS = new Set([
  "--json",
  "--clear-target",
  "--clear-route",
  "--clear-author",
]);

const VALUE_OPTIONS = new Set([
  "--id",
  "--title",
  "--body",
  "--type",
  "--route",
  "--target-id",
  "--target-kind",
  "--status",
  "--author",
]);

const ALLOWED_OPTIONS: Record<NoteCommand, ReadonlySet<string>> = {
  list: new Set(["--json"]),
  add: new Set([
    "--json",
    "--id",
    "--title",
    "--body",
    "--type",
    "--route",
    "--target-id",
    "--target-kind",
    "--status",
    "--author",
  ]),
  show: new Set(["--json", "--id"]),
  update: new Set([
    "--json",
    "--id",
    "--title",
    "--body",
    "--type",
    "--route",
    "--target-id",
    "--target-kind",
    "--status",
    "--author",
    "--clear-target",
    "--clear-route",
    "--clear-author",
  ]),
  remove: new Set(["--json", "--id"]),
};

function parseNoteArgs(
  command: NoteCommand,
  args: readonly string[],
  projectRoot: string,
): ParsedNoteArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  let sawProjectPath = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;

    if (BOOLEAN_OPTIONS.has(argument)) {
      if (flags.has(argument)) throw new Error(`Duplicate option ${argument}`);
      flags.add(argument);
      continue;
    }

    if (VALUE_OPTIONS.has(argument)) {
      if (values.has(argument)) throw new Error(`Duplicate option ${argument}`);
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      values.set(argument, value);
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown option ${argument}`);
    }

    if (
      !sawProjectPath &&
      path.resolve(argument) === path.resolve(projectRoot)
    ) {
      sawProjectPath = true;
      continue;
    }

    throw new Error(`Unexpected positional argument ${argument}`);
  }

  for (const option of [...flags, ...values.keys()]) {
    if (!ALLOWED_OPTIONS[command].has(option)) {
      throw new Error(`Unknown option ${option} for notes ${command}`);
    }
  }

  return { flags, values };
}

function enumValue<T extends string>(
  value: string | undefined,
  option: string,
  values: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) {
    throw new Error(`${option} must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

function requiredValue(
  parsed: ParsedNoteArgs,
  command: NoteCommand,
  option: string,
): string {
  const value = parsed.values.get(option);
  if (!value) throw new Error(`notes ${command} requires ${option} <value>`);
  return value;
}

function writeNoteHuman(note: NoteRecord, write: WriteLine): void {
  write(`${note.title} · ${note.id}`);
  write(`${note.type} · ${note.status}`);
  if (note.targetId) {
    write(`Target · ${note.targetKind ?? "unknown"}:${note.targetId}`);
  }
  if (note.targetRoute) write(`Route · ${note.targetRoute}`);
  if (note.author) write(`Author · ${note.author}`);
  if (note.body) write(note.body);
}

function writeMutation(
  verb: "Created" | "Updated",
  note: NoteRecord,
  json: boolean,
  write: WriteLine,
): void {
  if (json) write(JSON.stringify(note, null, 2));
  else write(`${verb} note ${note.id}: ${note.title}`);
}

export async function runNoteCommand(
  commandValue: string,
  args: readonly string[],
  dependencies: NoteCommandDependencies,
): Promise<void> {
  if (!NOTE_COMMANDS.includes(commandValue as NoteCommand)) {
    throw new Error(`Unknown notes command: ${commandValue}`);
  }
  const command = commandValue as NoteCommand;
  const parsed = parseNoteArgs(command, args, dependencies.projectRoot);
  const write = dependencies.write ?? console.log;
  const json = parsed.flags.has("--json");

  if (command === "list") {
    const notes = await dependencies.store.list();
    if (json) {
      write(JSON.stringify(notes, null, 2));
      return;
    }
    write(`Topo notes · ${dependencies.projectRoot}`);
    if (notes.length === 0) write("No notes yet.");
    for (const note of notes) {
      write(
        `  ${note.id}  ${note.title}${note.targetRoute ? `  ${note.targetRoute}` : ""}`,
      );
    }
    return;
  }

  if (command === "add") {
    const title = requiredValue(parsed, command, "--title");
    const type = enumValue<NoteType>(
      parsed.values.get("--type"),
      "--type",
      NOTE_TYPES,
    );
    const targetKind = enumValue<NoteTargetKind>(
      parsed.values.get("--target-kind"),
      "--target-kind",
      NOTE_TARGET_KINDS,
    );
    const status = enumValue<NoteStatus>(
      parsed.values.get("--status"),
      "--status",
      NOTE_STATUSES,
    );
    const targetId = parsed.values.get("--target-id");
    if (targetId && !targetKind) {
      throw new Error("notes add --target-id requires --target-kind");
    }
    const input: WriteNoteInput = {
      id: parsed.values.get("--id"),
      title,
      body: parsed.values.get("--body") ?? "",
      type,
      targetKind,
      targetId,
      targetRoute: parsed.values.get("--route"),
      status,
      author: parsed.values.get("--author"),
    };
    const note = await dependencies.store.write(input);
    await dependencies.syncContext();
    writeMutation("Created", note, json, write);
    return;
  }

  const id = requiredValue(parsed, command, "--id");

  if (command === "show") {
    const note = await dependencies.store.get(id);
    if (!note) throw new Error(`Note not found: ${id}`);
    if (json) write(JSON.stringify(note, null, 2));
    else writeNoteHuman(note, write);
    return;
  }

  if (command === "update") {
    const input: UpdateNoteInput = {};
    const title = parsed.values.get("--title");
    const body = parsed.values.get("--body");
    const type = enumValue<NoteType>(
      parsed.values.get("--type"),
      "--type",
      NOTE_TYPES,
    );
    const status = enumValue<NoteStatus>(
      parsed.values.get("--status"),
      "--status",
      NOTE_STATUSES,
    );
    const targetKind = enumValue<NoteTargetKind>(
      parsed.values.get("--target-kind"),
      "--target-kind",
      NOTE_TARGET_KINDS,
    );
    const targetId = parsed.values.get("--target-id");
    const targetRoute = parsed.values.get("--route");
    const author = parsed.values.get("--author");

    if (
      parsed.flags.has("--clear-target") &&
      (targetKind !== undefined || targetId !== undefined)
    ) {
      throw new Error(
        "--clear-target cannot be combined with --target-kind or --target-id",
      );
    }
    if (parsed.flags.has("--clear-route") && targetRoute !== undefined) {
      throw new Error("--clear-route cannot be combined with --route");
    }
    if (parsed.flags.has("--clear-author") && author !== undefined) {
      throw new Error("--clear-author cannot be combined with --author");
    }

    if (title !== undefined) input.title = title;
    if (body !== undefined) input.body = body;
    if (type !== undefined) input.type = type;
    if (status !== undefined) input.status = status;
    if (targetKind !== undefined) input.targetKind = targetKind;
    if (targetId !== undefined) input.targetId = targetId;
    if (targetRoute !== undefined) input.targetRoute = targetRoute;
    if (author !== undefined) input.author = author;
    if (parsed.flags.has("--clear-target")) {
      input.targetKind = null;
      input.targetId = null;
    }
    if (parsed.flags.has("--clear-route")) input.targetRoute = null;
    if (parsed.flags.has("--clear-author")) input.author = null;

    if (Object.keys(input).length === 0) {
      throw new Error("notes update requires at least one change option");
    }

    const note = await dependencies.store.update(id, input);
    if (!note) throw new Error(`Note not found: ${id}`);
    await dependencies.syncContext();
    writeMutation("Updated", note, json, write);
    return;
  }

  const removed = await dependencies.store.remove(id);
  if (!removed) throw new Error(`Note not found: ${id}`);
  await dependencies.syncContext();
  if (json) write(JSON.stringify({ id, removed: true }, null, 2));
  else write(`Removed note ${id}`);
}
