import "server-only";

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  order: number;
  updated: string;
  content: string;
}

async function workspaceRoot(): Promise<string> {
  const candidates = [process.cwd(), path.resolve(process.cwd(), "../..")];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "docs", "product.json"));
      return candidate;
    } catch {
      // Continue until the monorepo root is found.
    }
  }
  throw new Error("Could not locate the Topo documentation root");
}

export async function getAllDocs(): Promise<DocEntry[]> {
  const root = await workspaceRoot();
  const docsDirectory = path.join(root, "docs");
  const names = await readdir(docsDirectory);
  const docs = await Promise.all(
    names
      .filter((name) => name.endsWith(".md"))
      .map(async (name) => {
        const source = await readFile(path.join(docsDirectory, name), "utf8");
        const parsed = matter(source);
        if (parsed.data.public !== true) return undefined;
        return {
          slug: name.replace(/\.md$/i, "").toLowerCase(),
          title: String(parsed.data.title),
          description: String(parsed.data.description),
          order: Number(parsed.data.order ?? 999),
          updated: String(parsed.data.updated),
          content: parsed.content.trim(),
        } satisfies DocEntry;
      }),
  );

  return docs
    .filter((doc): doc is DocEntry => doc !== undefined)
    .sort(
      (left, right) =>
        left.order - right.order || left.title.localeCompare(right.title),
    );
}

export async function getDoc(slug: string): Promise<DocEntry | undefined> {
  return (await getAllDocs()).find((doc) => doc.slug === slug.toLowerCase());
}
