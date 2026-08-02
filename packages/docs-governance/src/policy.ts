export const DOCUMENTATION_POLICY = {
  schemaVersion: 1,
  requiredDocuments: [
    "docs/README.md",
    "docs/getting-started.md",
    "docs/features.md",
    "docs/cli-reference.md",
    "docs/hosted-roadmap.md",
    "docs/documentation-standard.md",
    "docs/CHANGELOG.md",
    "docs/ADAPTERS.md",
    "docs/ARCHITECTURE.md",
    "docs/LLM_INTERFACE.md",
    "docs/SCAFFOLD_MATRIX.md",
    "docs/verification.md",
  ],
  requiredPublicRoutes: [
    "apps/web/app/page.tsx",
    "apps/web/app/docs/page.tsx",
    "apps/web/app/docs/[slug]/page.tsx",
    "apps/web/app/demo/page.tsx",
    "apps/web/app/pricing/page.tsx",
    "apps/web/app/download/page.tsx",
  ],
  featureStatuses: [
    "available",
    "preview",
    "planned",
    "considering",
    "removed",
  ],
  planAvailability: ["available", "considering", "planned"],
  trackedMarkdownRoots: ["README.md", "AGENTS.md", "docs"],
} as const;

export type FeatureStatus =
  (typeof DOCUMENTATION_POLICY.featureStatuses)[number];

export type ChangeType = "added" | "changed" | "removed";
