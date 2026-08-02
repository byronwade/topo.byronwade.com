export function StatusCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="status-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
