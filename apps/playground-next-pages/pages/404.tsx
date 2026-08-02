import Link from "next/link";

import { FixtureShell } from "../components/FixtureShell";

export default function NotFoundPage() {
  return (
    <FixtureShell screen="pages-not-found" title="Not found">
      <section className="fixture-content fixture-not-found">
        <p className="fixture-kicker">Custom 404 state</p>
        <h1>That route is off the map.</h1>
        <p className="fixture-lede">
          Topo records this file as an explicit not-found screen state.
        </p>
        <Link className="fixture-button is-primary" href="/">
          Return to overview
        </Link>
      </section>
    </FixtureShell>
  );
}
