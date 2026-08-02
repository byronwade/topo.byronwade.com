import { useState } from "react";

export function ReadyPreview() {
  const [label] = useState("Standalone Topo preview");
  return <main data-testid="ready-preview">{label}</main>;
}

export function BrokenPreview() {
  throw new Error("Preview fixture exploded");
}
