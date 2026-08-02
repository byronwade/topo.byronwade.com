import type { ApplicationGraph } from "@topo/schema";

import type { TopoDataMode } from "./useTopoData";

const frameworkLabels: Readonly<Record<string, string>> = {
  "next-app": "Next.js App Router",
  "next-pages": "Next.js Pages Router",
  "tanstack-router": "TanStack Router",
  "tanstack-start": "TanStack Start",
  mixed: "Mixed frameworks",
  unknown: "No framework loaded",
};

export function hasProjectEvidence(graph: ApplicationGraph): boolean {
  return (
    graph.framework !== "unknown" ||
    graph.screens.length > 0 ||
    graph.components.length > 0 ||
    graph.edges.length > 0 ||
    graph.findings.length > 0
  );
}

export function presentFramework(framework: string): string {
  return (
    frameworkLabels[framework] ??
    framework
      .split(/[.-]/g)
      .filter(Boolean)
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(" ")
  );
}

export function presentProject(graph: ApplicationGraph): string {
  if (!hasProjectEvidence(graph)) return "No project";
  const segments = graph.rootDir.split(/[\\/]/g).filter(Boolean);
  return segments.at(-1) ?? graph.rootDir;
}

export function presentConnection(
  mode: TopoDataMode,
  graph: ApplicationGraph,
): string {
  if (mode === "daemon") return "Daemon connected";
  if (mode === "demo") return "Fieldbase demo project";
  if (mode === "connecting") return "Connecting to daemon";
  return hasProjectEvidence(graph)
    ? "Daemon offline · last known data"
    : "Daemon offline · no project loaded";
}

export function presentScanState(
  mode: TopoDataMode,
  graph: ApplicationGraph,
  lastScannedAt?: string,
): string {
  if (mode === "demo") return "deterministic demo data";
  if (mode === "connecting") return "waiting for project data";
  if (mode === "offline") {
    return hasProjectEvidence(graph)
      ? "last validated local data"
      : "no project data";
  }
  if (!lastScannedAt) return "scan connected";
  const timestamp = new Date(lastScannedAt);
  return Number.isNaN(timestamp.valueOf())
    ? "scan connected"
    : `scanned ${timestamp.toISOString().slice(11, 19)} UTC`;
}

export interface WelcomePresentation {
  adapterStatus: string;
  footer: string;
  introduction: string;
  primaryPath: string;
  primaryLabel: string;
}

export function presentWelcome(
  mode: TopoDataMode,
  graph: ApplicationGraph,
): WelcomePresentation {
  if (mode === "demo") {
    return {
      adapterStatus: "deterministic Fieldbase demo",
      introduction:
        "Fieldbase is loaded with safe, deterministic routes, flows, notes, and findings.",
      footer: "Explore the complete Studio with a safe demo project.",
      primaryPath: "/atlas/routes",
      primaryLabel: "Explore the atlas",
    };
  }

  if (mode === "daemon") {
    return {
      adapterStatus: "detected · daemon connected",
      introduction: `${presentProject(graph)} is scanned and loaded. Application source remains authoritative.`,
      footer: "Topo watches your code and keeps the canvas current.",
      primaryPath: "/atlas/routes",
      primaryLabel: "Explore the atlas",
    };
  }

  if (mode === "connecting") {
    return {
      adapterStatus: "waiting for validated project evidence",
      introduction:
        "Topo is connecting to the local daemon. Routes and project records will appear only after validation.",
      footer: "No demo or cached project has been substituted.",
      primaryPath: "/settings/adapters",
      primaryLabel: "View setup",
    };
  }

  if (hasProjectEvidence(graph)) {
    return {
      adapterStatus: "daemon offline · last known evidence",
      introduction: `${presentProject(graph)} is disconnected. The canvas shows only the last graph validated during this Studio session.`,
      footer:
        "Reconnect before changing notes, flows, captures, or diagnostics.",
      primaryPath: "/atlas/routes",
      primaryLabel: "Review last data",
    };
  }

  return {
    adapterStatus: "daemon offline · no project evidence",
    introduction:
      "No project is loaded. Start Topo from an application workspace to connect this Studio.",
    footer:
      "Production Studio never substitutes the Fieldbase demo automatically.",
    primaryPath: "/settings/adapters",
    primaryLabel: "View setup",
  };
}
