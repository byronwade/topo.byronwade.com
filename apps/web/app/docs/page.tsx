import type { Metadata } from "next";
import Link from "next/link";

import { getAllDocs } from "../../lib/docs";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Install, understand, extend, and query Topo from its canonical repository documentation.",
};

export default async function DocsPage() {
  const docs = await getAllDocs();
  const start = docs.filter((doc) => doc.order < 40);
  const deeper = docs.filter((doc) => doc.order >= 40);

  return (
    <main id="main-content" className="docs-home">
      <section className="page-hero shell docs-hero">
        <span className="eyebrow">Documentation / source of truth</span>
        <h1>Read the field notes.</h1>
        <p>
          Everything published here is rendered from the same Markdown and
          product manifest checked by the repository quality gates.
        </p>
        <div className="docs-search" aria-label="Documentation quick links">
          <span aria-hidden="true">⌘</span>
          <p>Start with installation, features, or the LLM interface</p>
          <kbd>canonical</kbd>
        </div>
      </section>

      <section className="shell docs-index">
        <div className="docs-group">
          <div className="docs-group-label">
            <span>01</span>
            <h2>Start here</h2>
          </div>
          <div className="docs-link-list">
            {start.map((doc) => (
              <Link href={`/docs/${doc.slug}`} key={doc.slug}>
                <div>
                  <h3>{doc.title}</h3>
                  <p>{doc.description}</p>
                </div>
                <span>
                  Read <i>→</i>
                </span>
              </Link>
            ))}
          </div>
        </div>
        <div className="docs-group">
          <div className="docs-group-label">
            <span>02</span>
            <h2>Go deeper</h2>
          </div>
          <div className="docs-link-list">
            {deeper.map((doc) => (
              <Link href={`/docs/${doc.slug}`} key={doc.slug}>
                <div>
                  <h3>{doc.title}</h3>
                  <p>{doc.description}</p>
                </div>
                <span>
                  Read <i>→</i>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
