import type { Metadata } from "next";
import Link from "next/link";

import { CopyCommand } from "../../components/CopyCommand";
import { product } from "../../lib/product";

export const metadata: Metadata = {
  title: "Try Topo",
  description:
    "Clone and run the Topo source preview, or inspect its consumer-tested CLI package artifact.",
};

const steps: ReadonlyArray<readonly [string, string, string]> = [
  ["01", "Clone the repository", `git clone ${product.repository}.git`],
  ["02", "Install the workspace", "pnpm install"],
  ["03", "Install Chromium", "pnpm exec playwright install chromium"],
  ["04", "Launch the complete MVP", "pnpm mvp"],
];

export default function DownloadPage() {
  return (
    <main id="main-content">
      <section className="page-hero shell download-hero">
        <div>
          <span className="eyebrow">
            <i className="pulse-dot" /> Source preview {product.productVersion}
          </span>
          <h1>
            Start on
            <br />
            your machine.
          </h1>
        </div>
        <div className="download-summary">
          <p>
            Topo is not published to npm yet. Clone the source preview to run
            the Studio, daemon, framework adapter, browser capture, and included
            playground together.
          </p>
          <div className="requirement-row">
            <span>Node.js 24</span>
            <span>pnpm 10</span>
            <span>Chromium</span>
          </div>
        </div>
      </section>

      <section className="shell install-sheet">
        <div className="install-heading">
          <span className="eyebrow">Four commands</span>
          <h2>From clone to atlas.</h2>
        </div>
        <div className="install-steps">
          {steps.map(([number, title, command]) => (
            <article key={number}>
              <span>{number}</span>
              <div>
                <h3>{title}</h3>
                <CopyCommand command={command} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="shell after-install">
        <div>
          <span className="eyebrow">What opens</span>
          <h2>Three local processes, one product loop.</h2>
        </div>
        <ol>
          <li>
            <b>Playground · :3000</b>
            <span>The real Next.js application Topo observes.</span>
          </li>
          <li>
            <b>Daemon · :4599</b>
            <span>Scanning, graph, capture, context, notes, and jobs.</span>
          </li>
          <li>
            <b>Studio · :4173</b>
            <span>The interactive application atlas.</span>
          </li>
        </ol>
      </section>

      <section className="shell source-boundary">
        <span className="eyebrow">Distribution status</span>
        <p>
          <strong>{product.distribution.packageName}</strong> is built as a
          self-contained package and verified in a clean consumer fixture. It is
          not published to npm yet, so the supported public trial path remains
          the source preview above.
        </p>
        <div>
          <a
            className="button button-outline"
            href={product.repository}
            target="_blank"
            rel="noreferrer"
          >
            Open GitHub <span>↗</span>
          </a>
          <Link className="text-link" href="/docs/getting-started">
            Full setup guide <span>→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
