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
  FlowIdSchema,
  FlowSchema,
  UpdateFlowInputSchema,
  WriteFlowInputSchema,
  type Flow,
  type UpdateFlowInput,
  type WriteFlowInput,
} from "@topo/schema";

export type { UpdateFlowInput, WriteFlowInput } from "@topo/schema";

export interface FlowReadIssue {
  filePath: string;
  message: string;
}

export interface FlowInspection {
  flows: Flow[];
  issues: FlowReadIssue[];
}

export interface FlowStore {
  list(): Promise<Flow[]>;
  inspect(): Promise<FlowInspection>;
  get(id: string): Promise<Flow | undefined>;
  write(input: WriteFlowInput): Promise<Flow>;
  update(id: string, input: UpdateFlowInput): Promise<Flow | undefined>;
  remove(id: string): Promise<boolean>;
}

function flowDirectory(rootDir: string): string {
  return path.join(path.resolve(rootDir), ".topo", "flows");
}

function fileNameFor(id: string): string {
  return `${encodeURIComponent(FlowIdSchema.parse(id))}.json`;
}

function legacyFileNameFor(id: string): string {
  return `${FlowIdSchema.parse(id).replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
}

const flowOperationQueues = new Map<string, Promise<void>>();

function operationKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function enqueueFlowOperation<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = operationKey(filePath);
  const previous = flowOperationQueues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  flowOperationQueues.set(key, settled);
  void settled.then(() => {
    if (flowOperationQueues.get(key) === settled) {
      flowOperationQueues.delete(key);
    }
  });
  return result;
}

export function renderFlowJson(flow: Flow): string {
  return `${JSON.stringify(FlowSchema.parse(flow), null, 2)}\n`;
}

export function parseFlowJson(json: string): Flow {
  return FlowSchema.parse(JSON.parse(json) as unknown);
}

export function createFlowStore(rootDir: string): FlowStore {
  const directory = flowDirectory(rootDir);

  const get = async (idValue: string): Promise<Flow | undefined> => {
    const id = FlowIdSchema.parse(idValue);
    const names = [...new Set([fileNameFor(id), legacyFileNameFor(id)])];
    for (const name of names) {
      try {
        const flow = parseFlowJson(
          await readFile(path.join(directory, name), "utf8"),
        );
        if (flow.id === id) return flow;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
    return undefined;
  };

  const writeFlow = async (flow: Flow): Promise<void> => {
    await mkdir(directory, { recursive: true });
    const outputPath = path.join(directory, fileNameFor(flow.id));
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, renderFlowJson(flow), "utf8");
      await rename(temporaryPath, outputPath);
      const legacyPath = path.join(directory, legacyFileNameFor(flow.id));
      if (legacyPath !== outputPath) {
        try {
          const legacyFlow = parseFlowJson(await readFile(legacyPath, "utf8"));
          if (legacyFlow.id === flow.id) await unlink(legacyPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            // Preserve malformed source records for inspect() and LLM issue
            // projection instead of deleting evidence during migration.
          }
        }
      }
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  };

  const inspect = async (): Promise<FlowInspection> => {
    await mkdir(directory, { recursive: true });
    const names = (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const flows: Flow[] = [];
    const issues: FlowReadIssue[] = [];
    for (const name of names) {
      try {
        flows.push(
          parseFlowJson(await readFile(path.join(directory, name), "utf8")),
        );
      } catch (error) {
        issues.push({
          filePath: `.topo/flows/${name}`,
          message:
            error instanceof Error ? error.message : "Unable to parse flow",
        });
      }
    }
    return {
      flows: flows.sort(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.id.localeCompare(right.id),
      ),
      issues,
    };
  };

  return {
    list: async () => (await inspect()).flows,
    inspect,
    get,
    async write(inputValue) {
      const input = WriteFlowInputSchema.parse(inputValue);
      const id = input.id ?? `flow-${randomUUID()}`;
      const outputPath = path.join(directory, fileNameFor(id));
      return enqueueFlowOperation(outputPath, async () => {
        const now = new Date().toISOString();
        const existing = input.id ? await get(id) : undefined;
        const flow = FlowSchema.parse({
          version: 1,
          id,
          title: input.title,
          description: input.description ?? existing?.description ?? "",
          status: input.status ?? existing?.status ?? "draft",
          entryStepId: input.entryStepId ?? existing?.entryStepId,
          tags: input.tags ?? existing?.tags ?? [],
          steps: input.steps ?? existing?.steps ?? [],
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        await writeFlow(flow);
        return flow;
      });
    },
    async update(idValue, inputValue) {
      const id = FlowIdSchema.parse(idValue);
      const input = UpdateFlowInputSchema.parse(inputValue);
      const outputPath = path.join(directory, fileNameFor(id));
      return enqueueFlowOperation(outputPath, async () => {
        const existing = await get(id);
        if (!existing) return undefined;
        const flow = FlowSchema.parse({
          ...existing,
          title: input.title ?? existing.title,
          description: input.description ?? existing.description,
          status: input.status ?? existing.status,
          entryStepId:
            input.entryStepId === null
              ? undefined
              : (input.entryStepId ?? existing.entryStepId),
          tags: input.tags ?? existing.tags,
          steps: input.steps ?? existing.steps,
          updatedAt: new Date().toISOString(),
        });
        await writeFlow(flow);
        return flow;
      });
    },
    async remove(idValue) {
      const id = FlowIdSchema.parse(idValue);
      const names = [...new Set([fileNameFor(id), legacyFileNameFor(id)])];
      let removed = false;
      for (const name of names) {
        const filePath = path.join(directory, name);
        await enqueueFlowOperation(filePath, async () => {
          try {
            const candidate = parseFlowJson(await readFile(filePath, "utf8"));
            if (candidate.id !== id) return;
            await unlink(filePath);
            removed = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
        });
      }
      return removed;
    },
  };
}
