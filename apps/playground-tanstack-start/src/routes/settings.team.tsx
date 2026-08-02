import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/team")({
  component: TeamSettings,
});

function TeamSettings() {
  return (
    <main
      className="fixture-page fixture-settings"
      data-topo-screen="start-team-settings"
    >
      <p className="fixture-kicker">Nested settings route</p>
      <h1>Dispatch team</h1>
      <p>
        Deterministic local settings give capture workers a stable SSR page
        without production authentication or remote data.
      </p>
      <section className="fixture-form" aria-label="Local team settings">
        <label>
          Active queue
          <input readOnly value="Field operations" />
        </label>
        <label>
          Preview profile
          <input readOnly value="Dispatcher" />
        </label>
        <button disabled type="button">
          Saved locally
        </button>
      </section>
    </main>
  );
}
