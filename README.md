# Topo

Topo (short for Topography) is a local-first, code-native application atlas. It scans normal Next.js, TanStack, React, Vue, Nuxt, and Svelte source files into a normalized application graph of routes, API endpoints, screens, components, flows, notes, and evidence, then presents that graph in GPU-backed Studio views and complete machine-readable records.

## Public website

`apps/web` is the install, documentation, demo, and pricing surface for Topo. It renders feature and plan status from `docs/product.json` and long-form documentation from canonical Markdown under `docs/`, so public claims cannot become an independent copy of product truth.

```powershell
pnpm web
```

Open `http://localhost:3100`. The command first builds the real Studio and packages it into the website as a verified same-origin showcase. The Demo link opens that production bundle with the deterministic Fieldbase project. Run `pnpm mvp` when you want the same Studio connected to the live playground, daemon, capture workers, and local project records.

The website production build generates the same-origin Studio artifact automatically, so a separate Studio deployment is not required. `TOPO_DEMO_STUDIO_URL` remains an optional escape hatch for a deployment that intentionally hosts Studio on another HTTPS origin. The handoff always opens `/welcome?demo=1`; demo mode uses fixture records and never attempts to connect to a visitor's local daemon. See [`.env.example`](./.env.example).

## Runnable MVP

The repository now includes a working local-first vertical slice:

- `@topo/schema` — versioned graph and finding contracts.
- `@topo/scanner` — route/component discovery for Next App Router, Next Pages Router, and TanStack Router.
- `@topo/endpoint-adapter` — the versioned, snapshot-sharing API endpoint extension contract.
- `@topo/adapter-api-source` and `@topo/adapter-openapi` — source-convention, router, controller, OpenAPI, and Swagger endpoint discovery with merged evidence.
- `@topo/config` — typed `topo.config.ts` loading with safe defaults.
- `@topo/daemon` — loopback HTTP/SSE graph gateway with durable state, jobs, Doctor evidence, capture, diagnostics, notes, and review endpoints.
- `@topo/cli` — a self-contained, tarball-tested CLI and compiled Studio with `init`, `uninstall`, `scan`, `check`, `doctor`, `dev`, `gateway`, `capture`, `mcp`, context, flow, and notes commands.
- `@topo/initializer` — read-only project detection, exact plans, transactional apply, and hash-verified uninstall.
- `@topo/flows` — versioned, branching user-flow records stored as readable JSON.
- `@topo/exporter` — deterministic Markdown, SARIF 2.1.0, and self-contained HTML review artifacts shared by Studio, daemon, CLI, and MCP.
- `@topo/doctor` — one sanitized, evidence-bearing environment and application-readiness report shared by CLI, daemon, Studio, and LLM context.
- `@topo/llm-context` — one canonical agent read model, deterministic JSONL/Markdown exports, and bounded queries.
- `@topo/canvas-engine` — deterministic layout and serializable pan, zoom, and fit camera math independent of rendering.
- `apps/benchmark` — deterministic CPU/filesystem and real Chromium/Pixi smoke, standard, and stress workloads with machine-readable p95 budgets and explicit runtime context.
- `@topo/browser` and `@topo/snapshots` — Playwright preview sessions and persisted PNG captures.
- `@topo/analyzer-static` and `@topo/analyzer-runtime` — evidence-based interaction findings with destructive-action safety skips.
- `@topo/adapter-next`, `@topo/adapter-tanstack`, `@topo/adapter-react`, `@topo/adapter-vue`, `@topo/adapter-nuxt`, and `@topo/adapter-svelte` — isolated framework route contracts.
- `@topo/adapter-storybook` — exact exported-state discovery and live Storybook index resolution with browser-captured evidence.
- `@topo/framework-adapter` — publishable adapter SDK with API-version, detection, route, and source-snapshot validation.
- `@topo/workspace` — composition root for built-in and project-installed framework adapters.
- `@topo/storage`, `@topo/jobs`, `@topo/gateway`, and `@topo/mcp` — durable state, serialized work, signed preview proxying, and local agent access.
- `apps/studio` — full-bleed PixiJS scenes with synchronized semantic DOM and live-frame overlays, inspector chrome, filtering, review views, notes, and camera controls.
- `@topo/studio-api` — immutable keyed composition for adding, replacing, or removing Studio destinations and commands.

The source repository remains authoritative. Topo reads it and never rewrites application screens as part of scanning.

While the daemon is watching, source changes are batched into one serialized refresh. Topo uses exact route and component source evidence for narrow recaptures and falls back to a conservative visual refresh when a shared dependency cannot be attributed safely. Unaffected capture state is preserved, affected routes are recaptured by default, versioned artifact URLs prevent stale textures, and typed graph/resource events rehydrate Studio. Set `preview.autoCapture: false` only when a project needs scan-only watching.

## LLM-readable by contract

The canvas is never the only representation of Topo knowledge. Routes, API endpoints, screen states, components, graph edges, findings, Doctor readiness checks, interaction-probe observations, Markdown notes, user flows and steps, captures, jobs, profiles, and malformed-record issues are normalized into versioned records with stable IDs, source locations, relationships, searchable text, and complete structured data.

```powershell
pnpm run topo -- context export apps/playground-next-app
pnpm run topo -- context query apps/playground-next-app --kind route,api-endpoint,flow,flow-step --limit 25 --json
```

The same canonical model is available as deterministic Markdown/JSONL files, loopback daemon endpoints, and read-only MCP resources and tools. Watched graph and capture changes refresh that model in the same serialized lifecycle, so agents and the canvas observe the same durable state. Preview credentials and environment values are always excluded. See [the LLM interface contract](./docs/LLM_INTERFACE.md).

## Run it

```powershell
pnpm install
pnpm build
pnpm run topo -- init --dry-run --no-package
pnpm run topo -- init --no-package
pnpm run topo -- scan --json
pnpm run topo -- check
pnpm run topo -- dev
```

`topo check` is an executable local/CI gate. It defaults to static diagnostics and fails on open `low`-severity or higher findings; use `--fail-on info|low|medium|high|none` to make policy explicit. Add `--runtime` to probe every default route through the configured preview server, or pair it with `--route /path` and `--profile Name` for one isolated route. `--json` returns a bounded schema-version-1 report with findings, probe evidence, summary counts, policy, and pass/fail status without repeating the complete application graph.

`topo dev` reuses a healthy application server or starts the detected native `dev` script, waits for it to become reachable, then starts one cookie-isolated signed gateway origin per preview profile, the loopback daemon, and compiled production Studio. It prints authoritative runtime state without logging launch capabilities. The Studio receives the daemon and exact profile origins at startup, including ephemeral ports, and Settings selects the profile used by live frames, captures, and diagnostics. Use `--no-app` when another process owns application startup, `--no-studio` to omit production Studio, or run `pnpm --filter @topo/studio dev` separately while developing Studio source. Opening Studio with `?demo=1` selects the deterministic Fieldbase demo project, skips daemon and runtime-probe requests, and preserves demo mode while moving among the designed views. Routes still execute through their real Next.js, TanStack, React, Vue, Nuxt, or Svelte runtime; Topo manages lifecycle, not framework behavior.

The repository build also produces a consumer-tested `@topo/cli` tarball contract with the compiled Studio and bundled internal implementation. CI installs that artifact into an isolated project, while the guarded release workflow requires an exact `v<package-version>` tag and publishes that same verified tarball through npm OIDC provenance. It is not published to npm yet. `--no-package` is used above because the CLI is already running from this source workspace; installed package builds can stage their own dependency and `topo` script, then print the package-manager install command.

In a monorepo, pass the repository root to every command and set `rootDir: "apps/web"` in `topo.config.ts`. The repository owns the single `.topo` tree and installed adapters; framework scanning and native commands use only the resolved application source root.

For the working MVP fixture, run one command:

```powershell
pnpm run mvp
```

This starts the Next.js playground on port 3000, the Topo daemon on port 4599, and Studio on port 4173. Select a route in Studio, open its live preview, add notes through the local daemon, and export the same review as Markdown, SARIF, or standalone HTML with `pnpm run topo -- export apps/playground-next-app --format html --snapshots`.

To verify the rendering path independently, run `pnpm benchmark --browser --profile smoke --check`. The browser report records the exact Chromium, WebGL renderer, GPU adapter, heap change, raw samples, viewport-culling work, and four-frame promotion workload; one machine's report is evidence, not a universal performance claim. Native GPU adapters retain the profile texture-upload budget and enforce the 25 ms pacing budget. SwiftShader keeps pacing misses visible but informational and uses an explicit 1.5× texture-upload allowance while still enforcing that adjusted budget; every report records the native target and renderer classification. Run `pnpm verify:local-runtime` for the complete native app → signed gateway → daemon → compiled Pixi Studio → Markdown/LLM lifecycle proof, `pnpm verify:studio-runtime` to prove DOM-only destinations do not load Pixi before Atlas needs it, `pnpm verify:studio-boards` to exercise all 23 shipped states at the exact Paper viewport with machine-readable geometry and screenshots, `pnpm verify:studio-profiles` to prove two live profile origins, browser state, HMR WebSockets, clean redirects, and LLM capability exclusion, and `pnpm verify:storybook` to build Storybook 10 and capture its real indexed component states in Chromium.

## Package boundaries

The first slice keeps the seam between source understanding, normalized graph data, and rendering explicit:

```text
source files + API contracts -> scanner -> schema graph -> daemon protocol -> Studio
                                                   \-> LLM / MCP / CLI
```

Browser capture, durable snapshots, notes, diagnostics, jobs, MCP, and framework adapters plug into the graph seam without making the daemon a source parser or making the canvas a router. `@topo/local-runtime` keeps native-app, gateway, daemon, and Studio startup behind one transactional start/close interface. The gateway is loopback-only, gives every profile a distinct host, requires a signed expiring session, and forwards the native application's HTTP and HMR behavior without changing production authentication.

## Add another framework

Framework packages implement `FrameworkAdapter` from `@topo/framework-adapter` and export one adapter object. Install the package in the application workspace, then register its module in `topo.config.ts`:

```ts
export default {
  extensions: {
    frameworkAdapters: ["@acme/topo-adapter-remix"],
  },
};
```

Topo loads it beside the built-in Next.js, TanStack, React, Vue, Nuxt, and Svelte adapters. The scanner and graph pipeline do not need to change. See [the adapter authoring guide](./docs/ADAPTERS.md) for the complete contract and test pattern.

API discovery is independently extensible. Implement `ApiEndpointAdapter` from `@topo/endpoint-adapter`, then register the package under `extensions.apiEndpointAdapters`. Endpoint adapters receive the scanner's existing immutable source snapshot, so adding a protocol or framework convention does not require another filesystem traversal.

For a local scaffold, run `pnpm run topo -- adapters check . --id <adapter-id> --json` before exercising it against a real application. The check produces bounded manifest, module, identity, and empty-context contract evidence without starting a server. It imports the local module, so run it only for code you trust.

## Useful workflows

```powershell
pnpm run topo -- capture apps/playground-next-app
pnpm run topo -- doctor apps/playground-next-app --json
pnpm run topo -- notes add apps/playground-next-app --id review:dashboard --title "Review dashboard" --route /dashboard --json
pnpm run topo -- notes show apps/playground-next-app --id review:dashboard --json
pnpm run topo -- notes update apps/playground-next-app --id review:dashboard --status resolved --json
pnpm run topo -- export apps/playground-next-app --format markdown
pnpm run topo -- flows add apps/playground-next-app --title "Create customer" --route /dashboard/customers
pnpm run topo -- context export apps/playground-next-app
pnpm run topo -- adapters check apps/playground-next-app --json
pnpm run topo -- gateway apps/playground-next-app
pnpm run topo -- export apps/playground-next-app --format sarif --snapshots --output artifacts/topo-review.sarif
```

For MCP clients, configure the command as `node packages/cli/dist/index.js mcp <project-path>` after `pnpm build`.

## Verification

```powershell
pnpm docs:check
pnpm typecheck
pnpm test
pnpm build
pnpm verify:local-runtime
```

The root dev, typecheck, test, and build commands run the documentation contract first. Product changes must update implementation evidence, `docs/product.json`, referenced Markdown, and a fingerprinted `docs:record` entry together. See [the documentation standard](./docs/documentation-standard.md).

The Vercel CLI is not part of this local-first slice. Install it separately with `npm i -g vercel` before using Vercel environment, deployment, or log workflows.
