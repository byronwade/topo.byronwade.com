import Link from "next/link";
import { useRouter } from "next/router";

import { FixtureShell } from "../../components/FixtureShell";

export default function CustomerDetailPage() {
  const router = useRouter();
  const rawId = router.query.customerId;
  const customerId = Array.isArray(rawId) ? rawId[0] : rawId;
  const title = customerId
    ? customerId
        .split("-")
        .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
        .join(" ")
    : "Loading customer";

  return (
    <FixtureShell screen="pages-customer-detail" title={title}>
      <section className="fixture-content">
        <p className="fixture-kicker">Dynamic route evidence</p>
        <h1>{title}</h1>
        <p className="fixture-lede">
          Route parameter: <code>{customerId ?? "pending"}</code>
        </p>
        <dl className="detail-grid">
          <div>
            <dt>Profile</dt>
            <dd>Owner</dd>
          </div>
          <div>
            <dt>Atlas status</dt>
            <dd>Captured</dd>
          </div>
          <div>
            <dt>Review state</dt>
            <dd>Ready</dd>
          </div>
        </dl>
        <Link className="fixture-button" href="/customers">
          Back to customers
        </Link>
      </section>
    </FixtureShell>
  );
}
