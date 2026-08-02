import { createFileRoute } from "@tanstack/react-router";

function Profile() {
  return (
    <main className="fixture-page fixture-profile" data-topo-screen="profile">
      <p className="fixture-kicker">Nested flat route</p>
      <h1>Capture profile</h1>
      <p>
        Deterministic local settings give the capture worker a stable screen
        without authentication or remote data.
      </p>
      <section aria-label="Local capture settings" className="fixture-form">
        <label>
          Viewport
          <input readOnly value="1440 × 900" />
        </label>
        <label>
          Preview profile
          <input readOnly value="Anonymous" />
        </label>
        <button disabled type="button">
          Saved locally
        </button>
      </section>
    </main>
  );
}

export const Route = createFileRoute("/settings/profile")({
  component: Profile,
});
