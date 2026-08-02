interface MetricCardProps {
  detail: string;
  label: string;
  value: string;
}

export function MetricCard({ detail, label, value }: MetricCardProps) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
