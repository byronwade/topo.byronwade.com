import Link from "next/link";

import { FixtureShell } from "../../components/FixtureShell";

const customers = [
  { id: "acme-plumbing", name: "Acme Plumbing", status: "Ready" },
  { id: "northstar-hvac", name: "Northstar HVAC", status: "Review" },
];

export default function CustomersPage() {
  return (
    <FixtureShell screen="pages-customers" title="Customers">
      <section className="fixture-content">
        <p className="fixture-kicker">Nested index route</p>
        <h1>Customer review queue</h1>
        <p className="fixture-lede">
          Each row navigates through the native dynamic Pages Router segment.
        </p>
        <div className="customer-list">
          {customers.map((customer) => (
            <Link href={`/customers/${customer.id}`} key={customer.id}>
              <span>
                <strong>{customer.name}</strong>
                <small>{customer.id}</small>
              </span>
              <em>{customer.status}</em>
            </Link>
          ))}
        </div>
      </section>
    </FixtureShell>
  );
}
