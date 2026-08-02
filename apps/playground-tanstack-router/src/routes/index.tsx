import { createFileRoute, Link } from "@tanstack/react-router";

function Overview() {
  return (
    <main className="fixture-page fixture-overview" data-topo-screen="overview">
      <section className="fixture-hero">
        <p className="fixture-kicker">Executable compatibility project</p>
        <h1>Generated routes, visible to everyone.</h1>
        <p>
          This real TanStack Router application gives Topo a permanent route
          tree, dynamic segment, nested page, and browser capture target.
        </p>
        <div className="fixture-actions">
          <Link className="fixture-button is-primary" to="/jobs">
            Explore jobs
          </Link>
          <Link className="fixture-button" to="/settings/profile">
            Open profile
          </Link>
        </div>
      </section>
      <section className="fixture-metrics" aria-label="Fixture coverage">
        <article>
          <strong>4</strong>
          <span>normalized routes</span>
        </article>
        <article>
          <strong>1</strong>
          <span>dynamic segment</span>
        </article>
        <article>
          <strong>100%</strong>
          <span>generated-tree source</span>
        </article>
      </section>
    </main>
  );
}

export const Route = createFileRoute("/")({ component: Overview });
