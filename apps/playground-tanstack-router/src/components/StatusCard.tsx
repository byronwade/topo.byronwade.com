export interface StatusCardProps {
  label: string;
  value: string;
  tone: "healthy" | "warning";
}

export function StatusCard({ label, tone, value }: StatusCardProps) {
  const accent = tone === "healthy" ? "#67e8a6" : "#f5be6b";
  return (
    <article
      data-topo-fixture="configured-status-card"
      style={{
        width: 360,
        padding: 24,
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: 10,
        color: "#f1f4ef",
        background: "#151918",
        boxShadow: "0 22px 60px rgba(0,0,0,.35)",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <span style={{ color: "#8c9691", fontSize: 12 }}>{label}</span>
        <span
          aria-label={`${tone} status`}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: accent,
            boxShadow: `0 0 18px ${accent}`,
          }}
        />
      </div>
      <strong style={{ display: "block", marginTop: 16, fontSize: 30 }}>
        {value}
      </strong>
    </article>
  );
}
