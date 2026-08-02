---
title: "Documentation standard"
description: "The required source-of-truth, feature-change, and drift-prevention workflow for Topo."
public: true
order: 95
updated: 2026-08-01
---

# Documentation standard

Documentation is part of the feature interface. A product change is incomplete until its public status, durable documentation, implementation evidence, and change record agree.

## Sources of truth

| Concern                                    | Authority                                |
| ------------------------------------------ | ---------------------------------------- |
| Product status and pricing language        | `docs/product.json`                      |
| Added, changed, and removed history        | `docs/product-changes.json`              |
| Human guides and architecture              | Markdown under `docs/`                   |
| Generated human changelog                  | `docs/CHANGELOG.md`                      |
| Public website copy for features and plans | Rendered from `docs/product.json`        |
| Public long-form documentation             | Rendered from Markdown under `docs/`     |
| Validation policy                          | `packages/docs-governance/src/policy.ts` |

## Required feature workflow

1. Add or change the implementation and focused tests.
2. Add or update the feature in `docs/product.json` with truthful status, canonical docs, evidence paths, and `updatedAt`.
3. Update every referenced Markdown document and its `updated` frontmatter date.
4. Record the change:

   ```powershell
   pnpm docs:record -- --id 2026-08-01-short-name --feature feature-id --type changed --summary "What changed"
   ```

5. Run `pnpm docs:check`.

`docs:check` runs automatically before root typecheck, test, and build commands.

## Adding a feature

Use `available` only when implementation evidence exists. Use `preview` for implemented but experimental behavior. Use `planned` for an adopted direction without implementation. Use `considering` for a hypothesis that may not ship.

## Removing a feature

Do not delete its record. Change its status to `removed`, add `removedIn` and `migration`, update the canonical guide, and record a `removed` change. This preserves a searchable product history.

## What the gate checks

- required public routes and documentation files;
- product version and supported statuses;
- unique feature IDs and valid plan references;
- implementation evidence for available and preview features;
- Markdown files, headings, links, and freshness dates;
- a matching fingerprinted change record for every current feature definition;
- an exactly generated `docs/CHANGELOG.md`;
- explicit migration information for removed capabilities.
- executable CI coverage for the packed CLI, smoke benchmark, Studio boards and loading, signed profiles, native framework fixtures, Storybook, complete local runtime, and browser performance;
- a parseable release workflow with release-only triggering, least-privilege OIDC permissions, exact version-tag and verified-tarball binding, retained evidence, and no long-lived npm token.

Passing the gate proves source consistency. It does not by itself prove browser behavior, deployment, package publication, or hosted availability.
