import { FixtureShell } from "../components/FixtureShell";

export default function SettingsPage() {
  return (
    <FixtureShell screen="pages-settings" title="Settings">
      <section className="fixture-content">
        <p className="fixture-kicker">Ordinary page route</p>
        <h1>Preview settings</h1>
        <p className="fixture-lede">
          The fixture exposes Anonymous and Owner profiles through Topo's signed
          local preview gateway.
        </p>
        <div className="settings-panel">
          <span>Runtime</span>
          <strong>Next.js Pages Router</strong>
          <span>Reserved origin</span>
          <code>http://localhost:3020</code>
        </div>
      </section>
    </FixtureShell>
  );
}
