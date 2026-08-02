import { randomUUID } from "node:crypto";

import type {
  JobHistoryRetention,
  ProjectStateStore,
  StoredJob,
} from "@topo/storage";

export type JobKind = StoredJob["kind"];

export interface JobHandle<T> {
  id: string;
  completion: Promise<T>;
}

export interface JobSubmitOptions {
  /** Fast local work may remain observable while active without retaining history. */
  retainTerminal?: boolean;
}

export interface JobQueue {
  submit<T>(
    kind: JobKind,
    task: () => Promise<T>,
    options?: JobSubmitOptions,
  ): JobHandle<T>;
  list(): Promise<StoredJob[]>;
  inspect(): Promise<JobQueueInspection>;
}

export interface JobQueueInspection {
  jobs: StoredJob[];
  retention: JobHistoryRetention;
}

function makeJob(
  id: string,
  kind: JobKind,
  status: StoredJob["status"],
  now: string,
): StoredJob {
  return {
    id,
    kind,
    status,
    createdAt: now,
    updatedAt: now,
    progress: status === "completed" ? 1 : 0,
  };
}

export function createJobQueue(store: ProjectStateStore): JobQueue {
  let tail = Promise.resolve();
  const activeJobs = new Map<string, StoredJob>();

  const activeFirst = (left: StoredJob, right: StoredJob): number =>
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.id.localeCompare(right.id);

  const inspect = async (): Promise<JobQueueInspection> => {
    const state = await store.read();
    const activeIds = new Set(activeJobs.keys());
    const jobs = [
      ...activeJobs.values(),
      ...state.jobs.filter((job) => !activeIds.has(job.id)),
    ].sort(activeFirst);
    return {
      jobs,
      retention: { ...state.jobHistory, retained: jobs.length },
    };
  };

  return {
    submit: <T>(
      kind: JobKind,
      task: () => Promise<T>,
      options: JobSubmitOptions = {},
    ): JobHandle<T> => {
      const id = `job-${randomUUID()}`;
      const createdAt = new Date().toISOString();
      activeJobs.set(id, makeJob(id, kind, "queued", createdAt));
      const completion = tail.then(async () => {
        activeJobs.set(
          id,
          makeJob(id, kind, "running", new Date().toISOString()),
        );
        try {
          const result = await task();
          if (options.retainTerminal !== false) {
            await store.saveJob({
              ...makeJob(id, kind, "completed", new Date().toISOString()),
              progress: 1,
            });
          }
          activeJobs.delete(id);
          return result;
        } catch (error: unknown) {
          if (options.retainTerminal !== false) {
            await store.saveJob({
              ...makeJob(id, kind, "failed", new Date().toISOString()),
              error: error instanceof Error ? error.message : "Job failed",
            });
          }
          activeJobs.delete(id);
          throw error;
        }
      });
      tail = completion.then(
        () => undefined,
        () => undefined,
      );
      return { id, completion };
    },
    list: async () => (await inspect()).jobs,
    inspect,
  };
}
