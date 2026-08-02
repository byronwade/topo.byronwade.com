"use client";

import { useEffect, useState } from "react";

function displayRole(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function HealthBadge() {
  const [previewRole, setPreviewRole] = useState("anonymous");

  useEffect(() => {
    setPreviewRole(localStorage.getItem("topo:preview-role") ?? "anonymous");
  }, []);

  return (
    <span
      className="health-badge"
      aria-label={`Preview runtime healthy as ${displayRole(previewRole)}`}
      data-preview-role={previewRole}
    >
      <span className="health-badge-dot" aria-hidden="true" />
      Runtime healthy · {displayRole(previewRole)}
    </span>
  );
}
