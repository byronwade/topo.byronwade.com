import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="playground-shell" data-topo-screen="dashboard">
      <nav className="playground-nav"><Link className="playground-brand" href="/">Topo / Playground</Link><Link href="/dashboard/customers">Customers →</Link></nav>
      <section className="playground-content">
        <p className="playground-kicker">Screen / dashboard</p>
        <h1>Quietly useful signals.</h1>
        <p className="playground-lede">A real page that can be promoted into Topo&apos;s live preview pane.</p>
        <div className="dashboard-panel"><span className="metric-label">Open work</span><strong>12</strong><span className="metric-change">+3 this week</span></div>
      </section>
    </main>
  );
}
