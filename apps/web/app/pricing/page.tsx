import type { Metadata } from "next";
import Link from "next/link";

import { featuresForPlan, product, statusLabel } from "../../lib/product";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Topo Community is free and local. Hosted collaboration and enterprise boundaries are being explored without invented prices.",
};

export default function PricingPage() {
  return (
    <main id="main-content">
      <section className="page-hero shell pricing-hero">
        <span className="eyebrow">Pricing / an honest boundary</span>
        <h1>
          Local understanding
          <br />
          belongs to everyone.
        </h1>
        <p>
          Topo Community is free. The possible paid boundary is shared
          coordination and retained history—not access to your own application
          map.
        </p>
      </section>

      <section className="shell pricing-ledger">
        {product.plans.map((plan, index) => {
          const features = featuresForPlan(plan);
          const current = plan.availability === "available";
          return (
            <article
              className={current ? "plan plan-current" : "plan"}
              key={plan.id}
            >
              <header>
                <span className="plan-index">0{index + 1}</span>
                <span
                  className={`status ${current ? "status-available" : "status-considering"}`}
                >
                  {current ? "Available now" : "Exploring"}
                </span>
              </header>
              <div className="plan-title">
                <h2>{plan.name}</h2>
                <strong>{plan.priceLabel}</strong>
              </div>
              <p>{plan.summary}</p>
              <ul>
                {features.map((feature) => (
                  <li key={feature.id}>
                    <span aria-hidden="true">{current ? "✓" : "○"}</span>
                    <div>
                      <b>{feature.title}</b>
                      <small>{statusLabel(feature.status)}</small>
                    </div>
                  </li>
                ))}
              </ul>
              {current ? (
                <Link className="button button-ink" href="/download">
                  Run Community <span>↗</span>
                </Link>
              ) : (
                <Link
                  className="button button-outline"
                  href="/docs/hosted-roadmap"
                >
                  Read the product direction <span>→</span>
                </Link>
              )}
            </article>
          );
        })}
      </section>

      <section className="shell pricing-note">
        <span className="eyebrow">What is decided</span>
        <div>
          <h2>
            The repository will not pretend an undecided business model is a
            finished offer.
          </h2>
          <p>
            Hosted workspaces, GitHub connection, organization MCP,
            self-hosting, identity, and audit controls are currently marked{" "}
            <strong>considering</strong>. Their scope and prices are not set.
          </p>
          <Link className="text-link" href="/docs/hosted-roadmap">
            See the open decisions <span>→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
