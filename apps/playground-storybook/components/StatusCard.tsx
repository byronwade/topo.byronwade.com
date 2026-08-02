import type { CSSProperties } from "react";

export interface StatusCardProps {
  title: string;
  detail: string;
  tone?: "healthy" | "warning" | "loading";
}

const tones = {
  healthy: { accent: "#9de08c", label: "Healthy" },
  warning: { accent: "#f3bd68", label: "Needs attention" },
  loading: { accent: "#8fb8ff", label: "Checking" },
} as const;

export function StatusCard({
  title,
  detail,
  tone = "healthy",
}: StatusCardProps) {
  const selected = tones[tone];
  const style = {
    "--status-accent": selected.accent,
    width: 360,
    border: "1px solid color-mix(in srgb, var(--status-accent) 42%, #343631)",
    borderRadius: 14,
    padding: 20,
    color: "#f4f5ef",
    background:
      "linear-gradient(145deg, color-mix(in srgb, var(--status-accent) 9%, #181a17), #11120f)",
    boxShadow: "0 24px 70px rgba(0, 0, 0, 0.35)",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  } as CSSProperties;

  return (
    <article style={style} data-tone={tone}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 8,
          color: selected.accent,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: selected.accent,
            boxShadow: `0 0 18px ${selected.accent}`,
          }}
        />
        {selected.label}
      </div>
      <h2 style={{ margin: "18px 0 6px", fontSize: 22 }}>{title}</h2>
      <p style={{ margin: 0, color: "#aeb2a8", lineHeight: 1.55 }}>{detail}</p>
    </article>
  );
}
