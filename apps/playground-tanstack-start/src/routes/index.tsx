import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { StartRuntimeBadge } from "../components/StartRuntimeBadge";

const readRuntimeContract = createServerFn({ method: "GET" }).handler(() => ({
  framework: "TanStack Start",
  mode: "server-rendered",
  source: "server-function",
}));

export const Route = createFileRoute("/")({
  loader: () => readRuntimeContract(),
  component: Overview,
});

function Overview() {
  const runtime = Route.useLoaderData();
  return (
    <main
      className="fixture-page fixture-overview"
      data-topo-screen="start-overview"
    >
      <section className="fixture-hero">
        <p className="fixture-kicker">Executable full-stack fixture</p>
        <h1>Routes and server behavior, visible in one graph.</h1>
        <p>
          This project proves that Topo can discover, start, inspect, and stop a
          real TanStack Start application through public extension seams.
        </p>
        <div className="fixture-actions">
          <Link className="fixture-button is-primary" to="/work-orders">
            Review work orders
          </Link>
          <Link className="fixture-button" to="/settings/team">
            Open team settings
          </Link>
        </div>
      </section>
      <section
        className="runtime-contract"
        aria-label="Server runtime evidence"
      >
        <StartRuntimeBadge />
        <dl>
          <div>
            <dt>Framework</dt>
            <dd>{runtime.framework}</dd>
          </div>
          <div>
            <dt>Render mode</dt>
            <dd>{runtime.mode}</dd>
          </div>
          <div>
            <dt>Evidence source</dt>
            <dd>{runtime.source}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
