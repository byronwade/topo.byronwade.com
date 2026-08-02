import Link from "next/link";

const customers = ["Northstar Plumbing", "Juniper Works", "Morrow Labs"];

export default function CustomersPage() {
  return (
    <main className="playground-shell" data-topo-screen="customers">
      <nav className="playground-nav"><Link className="playground-brand" href="/">Topo / Playground</Link><Link href="/dashboard">← Dashboard</Link></nav>
      <section className="playground-content">
        <p className="playground-kicker">Screen / customers</p>
        <h1>Customers</h1>
        <div className="customer-list">{customers.map((customer) => <div className="customer-row" key={customer}><span className="customer-avatar">{customer[0]}</span><span>{customer}</span><span className="customer-arrow">↗</span></div>)}</div>
      </section>
    </main>
  );
}
