export function TopoMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="topo-mark" aria-label={compact ? "Topo" : undefined}>
      <svg viewBox="0 0 42 42" aria-hidden="true">
        <path d="M7 13.5c4.3-7.4 14.6-10 22-5.7 7.5 4.3 10 13.9 5.8 21.4-4.3 7.4-14 10-21.5 5.7C5.9 30.6 2.7 21 7 13.5Z" />
        <path d="M12 16.4c3-5 9.5-6.8 14.5-3.9 5 2.9 6.7 9.1 3.8 14.1-3 5-9.2 6.9-14.2 4-5-2.9-7-9.2-4.1-14.2Z" />
        <path d="M17.2 18.8c1.6-2.8 5.2-3.7 8-2.1 2.7 1.6 3.7 5.1 2 7.9-1.5 2.7-5 3.7-7.8 2.1-2.8-1.6-3.8-5.2-2.2-8Z" />
        <circle cx="22.2" cy="21.8" r="1.9" />
      </svg>
      {!compact && <span>Topo</span>}
    </span>
  );
}
