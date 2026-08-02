import Link from "next/link";

import { product } from "../lib/product";
import { TopoMark } from "./TopoMark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-statement">
          <TopoMark />
          <p>Your application is already a landscape. Topo makes it legible.</p>
        </div>
        <div className="footer-links">
          <div>
            <span className="eyebrow">Explore</span>
            <Link href="/docs">Documentation</Link>
            <Link href="/demo">Product demo</Link>
            <Link href="/pricing">Pricing direction</Link>
          </div>
          <div>
            <span className="eyebrow">Build</span>
            <Link href="/download">Run from source</Link>
            <a href={product.repository} target="_blank" rel="noreferrer">
              GitHub repository
            </a>
            <Link href="/docs/llm_interface">LLM interface</Link>
          </div>
        </div>
      </div>
      <div className="shell footer-base">
        <span>Apache-2.0 · Local-first · No account required</span>
        <span>Source preview {product.productVersion}</span>
      </div>
    </footer>
  );
}
