import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useParams,
} from "react-router-dom";

import "./styles.css";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <header>
        <span className="eyebrow">React + React Router</span>
        <nav>
          <Link to="/">Overview</Link>
          <Link to="/customers">Customers</Link>
        </nav>
      </header>
      {children}
    </main>
  );
}

function Overview() {
  return (
    <Shell>
      <section data-topo-screen="react-overview">
        <h1>React workspace</h1>
        <p>Discovered through static router declarations.</p>
      </section>
    </Shell>
  );
}

function Customers() {
  return (
    <Shell>
      <section data-topo-screen="react-customers">
        <h1>Customers</h1>
        <Link to="/customers/acme-plumbing">Open Acme Plumbing</Link>
      </section>
    </Shell>
  );
}

function Customer() {
  const { customerId } = useParams();
  return (
    <Shell>
      <section data-topo-screen="react-customer">
        <h1>Customer detail</h1>
        <p>{customerId}</p>
      </section>
    </Shell>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/customers/:customerId" element={<Customer />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
