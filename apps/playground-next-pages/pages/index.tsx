import Link from "next/link";

import { FixtureShell } from "../components/FixtureShell";
import { MetricCard } from "../components/MetricCard";

export default function OverviewPage() {
  return (
    <FixtureShell screen="pages-overview" title="Overview">
      <section className="fixture-hero">
        <p className="fixture-kicker">Executable compatibility project</p>
        <h1>Old router. Same atlas.</h1>
        <p className="fixture-lede">
          Topo reads Pages Router conventions without rebuilding Next.js. This
          project keeps static, nested, dynamic, API, and 404 behavior in one
          permanent native-runtime fixture.
        </p>
        <div className="fixture-actions">
          <Link className="fixture-button is-primary" href="/customers">
            Explore customers
          </Link>
          <Link className="fixture-button" href="/settings">
            Open settings
          </Link>
        </div>
      </section>
      <section className="fixture-metrics" aria-label="Compatibility coverage">
        <MetricCard
          detail="index, nested, dynamic, settings, and not-found"
          label="Screen states"
          value="5"
        />
        <MetricCard
          detail="translated to /customers/:customerId"
          label="Dynamic segments"
          value="1"
        />
        <MetricCard
          detail="API routes stay outside the application atlas"
          label="False routes"
          value="0"
        />
      </section>
    </FixtureShell>
  );
}
