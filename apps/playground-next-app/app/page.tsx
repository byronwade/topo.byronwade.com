import Link from "next/link";

import { HealthBadge } from "../components/HealthBadge";
import { StatusCard } from "../components/StatusCard";

export default function HomePage() {
  return (
    <main className="playground-shell" data-topo-screen="home">
      <nav className="playground-nav">
        <Link className="playground-brand" href="/">
          Topo / Playground
        </Link>
        <div className="playground-links">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/dashboard/customers">Customers</Link>
          <Link href="/settings">Settings</Link>
        </div>
      </nav>
      <section className="playground-hero">
        <div className="playground-eyebrow">
          <p className="playground-kicker">Local application atlas fixture</p>
          <HealthBadge />
        </div>
        <h1>Every route, unfolded.</h1>
        <p className="playground-lede">
          This deliberately small app gives Topo real Next.js pages, loading
          states, components, and navigation to scan and preview.
        </p>
        <div className="playground-actions">
          <Link className="playground-button primary" href="/dashboard">
            Open dashboard
          </Link>
          <Link className="playground-button" href="/settings">
            View settings
          </Link>
        </div>
      </section>
      <section className="playground-grid">
        <StatusCard label="Routes" value="5" detail="App Router screens" />
        <StatusCard
          label="States"
          value="3"
          detail="default, loading, not-found"
        />
        <StatusCard label="Mode" value="Local" detail="No account required" />
      </section>
    </main>
  );
}
