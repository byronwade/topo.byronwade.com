import Link from "next/link";

import { CopyCommand } from "../components/CopyCommand";
import { RouteField } from "../components/RouteField";
import { product, statusLabel } from "../lib/product";

const available = product.features.filter(
  (feature) => feature.status === "available",
);
const preview = product.features.filter(
  (feature) => feature.status === "preview",
);

export default function HomePage() {
  return (
    <main id="main-content">
      <section className="hero shell">
        <div className="hero-copy">
          <span className="eyebrow">
            <i className="pulse-dot" /> Local-first application intelligence
          </span>
          <h1>
            Your application,
            <br />
            <em>unfolded.</em>
          </h1>
          <p className="hero-lede">
            See every route, screen state, component preview, flow, note, and
            suspicious interaction hidden inside your codebase—on one living
            field.
          </p>
          <div className="hero-actions">
            <Link className="button button-ink" href="/download">
              Run Topo locally <span>↗</span>
            </Link>
            <Link className="text-link" href="/demo">
              Explore the demo <span>→</span>
            </Link>
          </div>
          <CopyCommand command="pnpm mvp" />
          <p className="release-note">
            Source preview · Apache-2.0 · no Topo account
          </p>
        </div>
        <div className="hero-field">
          <RouteField />
          <p className="field-caption">
            <span>Fig. 01</span> Five routes rendered from one application graph
          </p>
        </div>
      </section>

      <section className="evidence-strip" aria-label="Topo principles">
        <div className="shell evidence-row">
          <span>
            <b>01</b> Code stays authoritative
          </span>
          <span>
            <b>02</b> Screens stay real
          </span>
          <span>
            <b>03</b> Evidence stays local
          </span>
          <span>
            <b>04</b> Context stays readable
          </span>
        </div>
      </section>

      <section className="section shell atlas-thesis">
        <div className="section-intro">
          <span className="eyebrow">One field, not more tabs</span>
          <h2>The shape of the product becomes visible.</h2>
        </div>
        <div className="thesis-copy">
          <p className="large-copy">
            Routes usually live in files, states live in stories, flows live in
            heads, and findings live in forgotten tickets. Topo projects them
            into one connected graph without becoming another source of truth.
          </p>
          <Link className="text-link" href="/docs/features">
            Read the feature model <span>→</span>
          </Link>
        </div>
        <div className="map-legend" aria-label="Application atlas layers">
          {[
            ["Routes", "Discovered from framework contracts", "01"],
            ["Screens", "Captured from the real dev server", "02"],
            ["States", "Stories, fixtures, and preview profiles", "03"],
            ["Flows", "Branching paths through the product", "04"],
            ["Review", "Notes and evidence-backed findings", "05"],
            ["Agents", "Bounded JSON, JSONL, and MCP reads", "06"],
          ].map(([title, detail, number]) => (
            <div className="legend-row" key={title}>
              <span>{number}</span>
              <strong>{title}</strong>
              <p>{detail}</p>
              <i aria-hidden="true">↗</i>
            </div>
          ))}
        </div>
      </section>

      <section className="section field-process">
        <div className="shell">
          <div className="section-intro process-heading">
            <span className="eyebrow">Follow the evidence</span>
            <h2>From source to shared understanding.</h2>
          </div>
          <div className="process-track">
            <article>
              <span className="process-number">01 / Source</span>
              <h3>Keep building normally.</h3>
              <p>
                Your Next.js, TanStack, React, Vue, Nuxt, or Svelte source
                remains authoritative. Topo reads it; it never asks you to
                rebuild the app in a visual editor.
              </p>
              <code>app/customers/[id]/page.tsx</code>
            </article>
            <article>
              <span className="process-number">02 / Observe</span>
              <h3>Capture what actually runs.</h3>
              <p>
                Your native development server continues to own layouts,
                loaders, authentication, CSS, middleware, and router behavior.
              </p>
              <code>route → profile → snapshot</code>
            </article>
            <article>
              <span className="process-number">03 / Connect</span>
              <h3>Turn fragments into a field.</h3>
              <p>
                Stable IDs connect files, routes, screens, controls, flows,
                notes, and findings into a graph both people and agents can
                query.
              </p>
              <code>sourceRef → entity → relation</code>
            </article>
          </div>
        </div>
      </section>

      <section className="section shell product-state">
        <div className="state-lede">
          <span className="eyebrow">Product state · {product.updatedAt}</span>
          <h2>Useful now. Explicit about what comes next.</h2>
          <p>
            These labels come directly from the repository product manifest. A
            feature cannot change without a matching documentation record.
          </p>
          <Link
            className="button button-outline"
            href="/docs/documentation-standard"
          >
            See the docs contract
          </Link>
        </div>
        <div className="feature-ledger">
          <div className="ledger-group">
            <div className="ledger-heading">
              <span className="status status-available">Available now</span>
              <b>{available.length}</b>
            </div>
            {available.map((feature) => (
              <article key={feature.id}>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.summary}</p>
                </div>
                <span>{feature.category}</span>
              </article>
            ))}
          </div>
          <div className="ledger-group ledger-preview">
            <div className="ledger-heading">
              <span className="status status-preview">Preview</span>
              <b>{preview.length}</b>
            </div>
            {preview.map((feature) => (
              <article key={feature.id}>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.summary}</p>
                </div>
                <span>{statusLabel(feature.status)}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section llm-section">
        <div className="shell llm-grid">
          <div>
            <span className="eyebrow eyebrow-light">
              Built for people and their agents
            </span>
            <h2>The map is not trapped in pixels.</h2>
            <p>
              Every durable concept has a versioned schema, stable identity,
              source references, relationships, and a bounded query
              representation.
            </p>
            <div className="llm-actions">
              <Link className="button button-paper" href="/docs/llm_interface">
                Read the LLM contract
              </Link>
              <span>JSON · JSONL · Markdown · MCP</span>
            </div>
          </div>
          <pre
            className="record-sample"
            aria-label="Example Topo context record"
          >
            <code>{`{
  "kind": "route",
  "id": "route:customers/:id",
  "label": "/customers/:id",
  "source": {
    "path": "app/customers/[id]/page.tsx"
  },
  "relationships": [
    { "type": "navigates-to", "target": "route:jobs" }
  ]
}`}</code>
          </pre>
        </div>
      </section>

      <section className="final-cta shell">
        <span className="eyebrow">Start from source</span>
        <h2>
          Walk the application
          <br />
          you have already built.
        </h2>
        <p>
          Clone the preview, run one command, and open the complete local atlas.
        </p>
        <div>
          <Link className="button button-orange" href="/download">
            Try Topo <span>↗</span>
          </Link>
          <a
            className="text-link"
            href={product.repository}
            target="_blank"
            rel="noreferrer"
          >
            View the repository <span>→</span>
          </a>
        </div>
      </section>
    </main>
  );
}
