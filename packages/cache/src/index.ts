import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  CacheCleanResultSchema,
  CacheReportSchema,
  type CacheCleanResult,
  type CacheEntryKind,
  type CacheEntrySummary,
  type CacheReport,
  type CacheTotals,
} from "@topo/protocol";

const EMPTY_TOTALS: CacheTotals = {
  bytes: 0,
  files: 0,
  directories: 0,
  symlinks: 0,
};

function emptyTotals(): CacheTotals {
  return { ...EMPTY_TOTALS };
}

function addTotals(left: CacheTotals, right: CacheTotals): CacheTotals {
  return {
    bytes: left.bytes + right.bytes,
    files: left.files + right.files,
    directories: left.directories + right.directories,
    symlinks: left.symlinks + right.symlinks,
  };
}

function portablePath(value: string): string {
  return value.split(path.sep).join("/");
}

async function summarizeEntry(
  absolutePath: string,
  relativePath: string,
): Promise<CacheEntrySummary | undefined> {
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let kind: CacheEntryKind;
  let totals = emptyTotals();
  if (stats.isSymbolicLink()) {
    kind = "symlink";
    totals.symlinks = 1;
  } else if (stats.isDirectory()) {
    kind = "directory";
    totals.directories = 1;
    const names = (await readdir(absolutePath)).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const name of names) {
      const child = await summarizeEntry(
        path.join(absolutePath, name),
        path.join(relativePath, name),
      );
      if (child) totals = addTotals(totals, child.totals);
    }
  } else {
    kind = "file";
    totals.files = 1;
    totals.bytes = stats.size;
  }

  return {
    path: portablePath(relativePath),
    kind,
    totals,
  };
}

function assertOwnedChild(cacheRoot: string, targetPath: string): void {
  const relative = path.relative(cacheRoot, targetPath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to clean path outside ${cacheRoot}`);
  }
}

export function resolveProjectCacheRoot(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".topo", "cache");
}

export async function inspectProjectCache(
  projectRootInput: string,
): Promise<CacheReport> {
  const projectRoot = path.resolve(projectRootInput);
  const cacheRoot = resolveProjectCacheRoot(projectRoot);
  let rootStats;
  try {
    rootStats = await lstat(cacheRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return CacheReportSchema.parse({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      projectRoot,
      cacheRoot,
      exists: false,
      totals: emptyTotals(),
      entries: [],
    });
  }

  let entries: CacheEntrySummary[] = [];
  if (rootStats.isDirectory() && !rootStats.isSymbolicLink()) {
    const names = (await readdir(cacheRoot)).sort((a, b) =>
      a.localeCompare(b),
    );
    entries = (
      await Promise.all(
        names.map((name) =>
          summarizeEntry(path.join(cacheRoot, name), name),
        ),
      )
    ).filter((entry): entry is CacheEntrySummary => Boolean(entry));
  } else {
    const root = await summarizeEntry(cacheRoot, ".");
    if (root) entries = [root];
  }

  const totals = entries.reduce(
    (current, entry) => addTotals(current, entry.totals),
    emptyTotals(),
  );
  return CacheReportSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    cacheRoot,
    exists: true,
    totals,
    entries,
  });
}

export async function cleanProjectCache(
  projectRootInput: string,
  options: { dryRun?: boolean } = {},
): Promise<CacheCleanResult> {
  const projectRoot = path.resolve(projectRootInput);
  const cacheRoot = resolveProjectCacheRoot(projectRoot);
  const before = await inspectProjectCache(projectRoot);
  const dryRun = options.dryRun ?? false;

  if (!dryRun && before.exists) {
    const rootStats = await lstat(cacheRoot).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (rootStats?.isDirectory() && !rootStats.isSymbolicLink()) {
      const names = await readdir(cacheRoot);
      for (const name of names) {
        const target = path.join(cacheRoot, name);
        assertOwnedChild(cacheRoot, target);
        await rm(target, { recursive: true, force: true });
      }
    } else if (rootStats) {
      await rm(cacheRoot, { force: true });
    }
  }

  if (!dryRun) await mkdir(cacheRoot, { recursive: true });
  const after = dryRun
    ? CacheReportSchema.parse({
        ...before,
        generatedAt: new Date().toISOString(),
        exists: true,
        totals: emptyTotals(),
        entries: [],
      })
    : await inspectProjectCache(projectRoot);

  return CacheCleanResultSchema.parse({
    schemaVersion: 1,
    dryRun,
    before,
    after,
    removed: before.totals,
  });
}
