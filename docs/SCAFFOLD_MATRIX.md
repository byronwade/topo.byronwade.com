---
title: "Scaffold matrix"
description: "Implementation ledger separating executable Topo surfaces from intentionally scaffolded seams."
public: false
order: 100
updated: 2026-08-02
---

# Topo scaffold matrix

The repository is intentionally split between executable MVP modules and named future seams. A scaffold-only directory has a README but no runtime behavior yet; it exists so later work has an owned home and a visible dependency direction.

## Executable in the MVP

| Surface                | Location                          | Responsibility                                                     |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| CLI                    | `packages/cli`                    | setup, scan, Doctor, capture, review, context, and MCP             |
| Config                 | `packages/config`                 | local configuration defaults, Studio manifest, and loading         |
| Schema                 | `packages/schema`                 | versioned graph contract                                           |
| Framework adapter SDK  | `packages/framework-adapter`      | versioned adapter contract, validation, and registry               |
| Adapter scaffolder     | `packages/adapter-scaffold`       | safe local templates, manifests, inspection, and atomic creation   |
| Preview scaffolder     | `packages/preview-scaffold`       | safe colocated preview planning and atomic no-overwrite creation   |
| Preview adapter SDK    | `packages/preview-adapter`        | component preview discovery and runtime URL resolution             |
| Workspace              | `packages/workspace`              | built-in and project adapter composition by extension family       |
| Scanner                | `packages/scanner`                | source snapshots, Oxc module reachability, and graph normalization |
| Next adapter           | `packages/adapter-next`           | App Router and Pages Router discovery                              |
| TanStack adapter       | `packages/adapter-tanstack`       | Router and Start route discovery                                   |
| Storybook adapter      | `packages/adapter-storybook`      | colocated story discovery and live index resolution                |
| Topo preview adapter   | `packages/adapter-topo`           | colocated, configured, accepted, and safe preview discovery        |
| Preview runtime        | `packages/preview-runtime`        | capability-scoped loopback Vite/React component renderer           |
| Application runtime    | `packages/application-runtime`    | native server adapter selection and owned process lifecycle        |
| Complete local runtime | `packages/local-runtime`          | transactional app, gateway, daemon, and Studio composition         |
| Browser                | `packages/browser`                | isolated Playwright sessions, readiness, and image capture         |
| Doctor                 | `packages/doctor`                 | canonical sanitized readiness checks and bounded probes            |
| Cache                  | `packages/cache`                  | contained derived-cache inspection and cleanup                     |
| Daemon                 | `packages/daemon`                 | loopback graph, context, artifacts, actions, SSE, and review       |
| Storage                | `packages/storage`                | atomic captures, baselines, comparisons, and bounded jobs          |
| Snapshots              | `packages/snapshots`              | capture, baseline acceptance, and hash-fast pixel comparison       |
| Notes                  | `packages/notes`                  | versioned Markdown note persistence                                |
| Flows                  | `packages/flows`                  | atomic versioned JSON flow CRUD and identity safety                |
| LLM context            | `packages/llm-context`            | canonical records, bounded query, Markdown/JSONL export            |
| MCP                    | `packages/mcp`                    | official SDK resources, tools, prompts, and artifact reads         |
| Exporter               | `packages/exporter`               | Markdown, SARIF, and standalone HTML review artifacts              |
| Canvas engine          | `packages/canvas-engine`          | serializable camera, zoom, pan, and fit math                       |
| Layout                 | `packages/layout`                 | versioned route, component, and directed-flow scenes               |
| Pixi renderer          | `packages/renderer-pixi`          | shared application lifecycle, GPU grid, and snapshot textures      |
| React canvas bindings  | `packages/react`                  | reusable selection and camera interaction hooks                    |
| Live frame host        | `packages/live-frame-host`        | isolated iframe descriptor and sandbox contract                    |
| Graph                  | `packages/graph`                  | graph reconciliation and finding merge                             |
| Source parser          | `packages/parser-oxc`             | native Oxc metadata, export safety, caching, and diagnostics       |
| Resolver               | `packages/resolver`               | source links into normalized navigation edges                      |
| Runtime bridge         | `packages/runtime-bridge`         | preview instrumentation events and bootstrap                       |
| Playwright adapter     | `packages/adapter-playwright`     | capture and isolated probe capability boundary                     |
| Shared UI              | `packages/ui`                     | framework-neutral class and keyboard helpers                       |
| Protocol               | `packages/protocol`               | health, Studio, visual, graph, and resource event contracts        |
| Studio                 | `apps/studio`                     | Pixi atlas, live preview, project search, review, and composition  |
| Studio API             | `packages/studio-api`             | typed composition, selection links, lazy search, and board data    |
| Studio host            | `packages/studio-host`            | loopback assets plus machine-readable build inspection             |
| Public website         | `apps/web`                        | Home, canonical docs, interactive demo, pricing, download          |
| Showcase builder       | `apps/showcase-builder`           | validated, hashed, same-origin production Studio demo              |
| Docs governance        | `packages/docs-governance`        | product manifest, change ledger, links, freshness, drift           |
| Benchmark              | `apps/benchmark`                  | CPU, GPU, visual, runtime, profile, and 23-board evidence          |
| Playground             | `apps/playground-next-app`        | real Next.js target for the MVP                                    |
| Next Pages playground  | `apps/playground-next-pages`      | Pages scan, native runtime, browser, flow, and build fixture       |
| TanStack playground    | `apps/playground-tanstack-router` | generated-tree scan, browser, flow, and build fixture              |
| Start playground       | `apps/playground-tanstack-start`  | SSR, server function, scan, browser, flow, and build fixture       |
| Storybook playground   | `apps/playground-storybook`       | real CSF index, Chromium capture, and artifact fixture             |

## Reserved application seams

Every package listed in the repository now has executable behavior; none is represented here as a README-only package seam. Some remain deliberately narrow MVP implementations, and their feature status is governed by `docs/product.json` rather than inferred from directory presence.

The only later application surface still reserved under `apps/` is `desktop`.

The graph schema remains the cross-process seam. Framework adapters use `@topo/framework-adapter`; component preview systems use the independent `@topo/preview-adapter` seam. Either family can grow without scanner changes. Every new durable concept must also enter the canonical LLM read model. See [ADAPTERS.md](./ADAPTERS.md) and [LLM_INTERFACE.md](./LLM_INTERFACE.md).
