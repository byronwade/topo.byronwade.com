import Link from "next/link";

export default function SettingsPage() {
  return (
    <main className="playground-shell" data-topo-screen="settings">
      <nav className="playground-nav"><Link className="playground-brand" href="/">Topo / Playground</Link><Link href="/">← Home</Link></nav>
      <section className="playground-content">
        <p className="playground-kicker">Screen / settings</p>
        <h1>Preview settings</h1>
        <div className="settings-card"><label><span>Profile</span><select defaultValue="anonymous"><option value="anonymous">Anonymous</option><option value="owner">Owner</option></select></label><label><span>Reduced motion</span><input type="checkbox" defaultChecked /></label></div>
      </section>
    </main>
  );
}
