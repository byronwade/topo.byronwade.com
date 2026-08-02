import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownArticle } from "../../../components/MarkdownArticle";
import { getAllDocs, getDoc } from "../../../lib/docs";

interface DocPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return (await getAllDocs()).map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: DocPageProps): Promise<Metadata> {
  const doc = await getDoc((await params).slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocPage({ params }: DocPageProps) {
  const [doc, docs] = await Promise.all([
    getDoc((await params).slug),
    getAllDocs(),
  ]);
  if (!doc) notFound();

  return (
    <main id="main-content" className="doc-page shell">
      <aside className="docs-sidebar">
        <Link className="sidebar-home" href="/docs">
          <span>←</span> Documentation
        </Link>
        <nav aria-label="Documentation pages">
          {docs.map((entry) => (
            <Link
              className={entry.slug === doc.slug ? "is-active" : ""}
              href={`/docs/${entry.slug}`}
              key={entry.slug}
            >
              {entry.title}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="doc-content">
        <div className="doc-provenance">
          <span>Repository source</span>
          <span>Updated {doc.updated}</span>
        </div>
        <MarkdownArticle content={doc.content} />
        <div className="doc-footer-note">
          <strong>Found documentation drift?</strong>
          <p>
            Update the product manifest, implementation evidence, and canonical
            Markdown together. The quality gate will verify the change record.
          </p>
          <Link href="/docs/documentation-standard">
            Read the documentation standard →
          </Link>
        </div>
      </div>
      <aside className="doc-margin" aria-label="Document metadata">
        <span className="eyebrow">On this page</span>
        <p>{doc.description}</p>
        <a href="#main-content">Back to top ↑</a>
      </aside>
    </main>
  );
}
