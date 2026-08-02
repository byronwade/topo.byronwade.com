import { CreditCard, MapPin, Zap } from "lucide-react";

export function PreviewMock({
  compact = false,
  decorative = false,
}: {
  compact?: boolean;
  decorative?: boolean;
}) {
  const features = [
    [
      Zap,
      "Live dispatch",
      "Assign and re-route jobs while crews are still on the road.",
    ],
    [
      MapPin,
      "Smart routing",
      "Drive time is calculated from real traffic, not straight lines.",
    ],
    [
      CreditCard,
      "Invoice on site",
      "Collect payment before the truck leaves the driveway.",
    ],
  ];
  return (
    <div
      aria-hidden={decorative || undefined}
      className={`preview-app preview-fieldbase ${compact ? "is-compact" : ""}`}
    >
      <div className="preview-app-nav">
        <div className="preview-brand">
          <span />
          <strong>Fieldbase</strong>
        </div>
        <div className="preview-links">
          <span>Product</span>
          <span>Pricing</span>
          <span>Docs</span>
        </div>
        <button tabIndex={decorative ? -1 : undefined} type="button">
          Get started
        </button>
      </div>
      <div className="preview-hero">
        <span className="preview-beta">• Now in public beta</span>
        <h2>Every job, every tech, one dispatch board</h2>
        <p>
          Schedule, route and invoice field work without leaving the browser.
        </p>
        <div className="preview-actions">
          <button tabIndex={decorative ? -1 : undefined} type="button">
            Book a demo
          </button>
          <button
            className="preview-secondary"
            tabIndex={decorative ? -1 : undefined}
            type="button"
          >
            Watch the tour
          </button>
        </div>
      </div>
      <div className="preview-feature-row">
        {features.map(([Icon, title, copy]) => {
          const FeatureIcon = Icon as typeof Zap;
          return (
            <article key={String(title)}>
              <span className="preview-feature-icon">
                <FeatureIcon size={14} />
              </span>
              <strong>{String(title)}</strong>
              <p>{String(copy)}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
