import Link from "next/link";

import { product } from "../lib/product";
import { TopoMark } from "./TopoMark";

const links = [
  { href: "/docs", label: "Docs" },
  { href: "/demo", label: "Demo" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner shell">
        <Link href="/" className="brand-link" aria-label="Topo home">
          <TopoMark />
          <span className="version-tag">v{product.productVersion}</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
          <a href={product.repository} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="header-actions">
          <Link className="header-search" href="/docs">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.7-3.7" />
            </svg>
            <span>Search documentation...</span>
            <kbd>/</kbd>
          </Link>
          <Link className="button button-small button-ink" href="/download">
            Try Topo <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
