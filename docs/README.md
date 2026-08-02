---
title: "Topo documentation"
description: "The discovery index for using, extending, and governing Topo."
public: false
order: 0
updated: 2026-08-01
---

# Topo documentation

Use this directory as the durable source for product behavior, setup, architecture, and future direction. The public website renders documents marked `public: true` directly from these files.

## Start here

- [Getting started](./getting-started.md) — run the source-preview MVP.
- [Feature status](./features.md) — what is available, preview, planned, or only being considered.
- [CLI reference](./cli-reference.md) — current command surface.
- [LLM interface](./LLM_INTERFACE.md) — files, query records, daemon reads, and MCP.
- [Framework adapters](./ADAPTERS.md) — extension contract.
- [Studio extensions](./STUDIO_EXTENSIONS.md) — add, replace, or remove destinations and commands.

## Product and operations

- [Hosted roadmap](./hosted-roadmap.md) — possible commercial direction without availability promises.
- [Product changelog](./CHANGELOG.md) — generated added, changed, and removed feature history.
- [Documentation standard](./documentation-standard.md) — required update workflow and drift gates.
- [Public website design references](./design-references.md) — transferable visual and layout principles.
- [Studio Paper contract](./studio-paper-contract.md) — the 23-board visual, route, state, and data contract.
- [Verification](./verification.md) — evidence levels and commands.

## Architecture

- [Architecture](./ARCHITECTURE.md)
- [Scaffold matrix](./SCAFFOLD_MATRIX.md)

`docs/product.json` is the structured product-status source. `docs/product-changes.json` is its append-only change ledger. Run `pnpm docs:check` before handing off any feature work.
