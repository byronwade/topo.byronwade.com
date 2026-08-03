---
title: "Verification"
description: "Evidence levels and quality gates for Topo source, runtime, browser, and product documentation."
public: true
order: 70
updated: 2026-08-02
---

# Topo verification

The local verification contract is deliberately layered:

```text
pnpm docs:check -> feature status, evidence, canonical docs, links, and changelog agree
pnpm typecheck  -> package contracts and application types
pnpm test       -> unit, adapter, storage, daemon, gateway, MCP, and fixture tests
pnpm build      -> every workspace package, Studio production bundle, and framework fixtures
```

## Adapter scaffold contract

```powershell
pnpm --filter @topo/adapter-scaffold test
pnpm --filter @topo/cli test -- adapter-command.test.ts
pnpm --filter @topo/llm-context test -- index.test.ts
pnpm --filter @topo/cli build
pnpm --filter @topo/cli pack:check
```

The scaffold suite plans and applies all five independent adapter families, dynamically imports each zero-dependency ESM result, and validates it through the real framework, API-endpoint, flow-discovery, component-preview, or process-free application-runtime contract. Its schema-version-1 conformance report requires four checks per adapter: `manifest`, `module`, `identity`, and `empty-context`. The suite proves all-family success, exact-ID selection, identity drift, contract rejection, explicit no-manifest issues, deterministic filenames, project containment, no-write planning, malformed-manifest inspection, existing-target refusal, and temporary-directory cleanup. The runtime package separately proves validation and deterministic adapter selection without process startup. The CLI test requires explicit creation inputs, bounded JSON that omits generated source bodies, exact human registration guidance, parseable conformance success, and parseable failure evidence.

The packed-consumer gate is the distribution proof. It installs the produced CLI tarball into an isolated project, runs an adapter dry-run, creates a framework adapter, executes its generated Node test, runs the installed `adapters check` command and requires all four checks, registers the relative module in `topo.config.ts`, loads it through the actual workspace scanner, and queries the resulting schema-version-7 `adapter` context record. This proves the bundled command and public process boundary; it does not mean the package has been published to npm. Conformance imports trusted local modules but never starts an application or development server, and it is not evidence that project-specific semantics work against a real repository.

## Adapter inventory contract

Run the inventory, transport, context, and Studio presentation checks:

```powershell
pnpm --filter @topo/adapter-inventory test
pnpm --filter @topo/protocol test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio test
```

The pure inventory fixture requires all sixteen built-in capability entries, registered and unregistered local scaffolds, configured-only modules, graph-observed framework, endpoint, flow, and preview contributors, deterministic ordering, independent active and registered summary counts, exact `screenIds`, `endpointIds`, `flowTransitionIds`, `inferredFlowIds`, and `componentIds` behind their counts, and visible malformed-manifest issues. Protocol tests require schema-version-1 validation plus the typed `adapters` resource invalidation. Context tests require the same statuses as searchable adapter records while preserving stable identities, exact sources and memberships, project relationships, malformed source issues, and reciprocal adapter ownership relationships.

The daemon integration starts a real watched Next.js fixture with a registered local framework module. `GET /adapters` must report the built-in `topo.next` capability as active and the local module as registered. A separate third-party fixture loads an executable `acme.routes` adapter, requires its ID on the normalized screen, checks its exact inventory membership, and queries reciprocal adapter, route, and screen context relationships through HTTP. Writing a malformed manifest under `topo/adapters/` must emit `resource.updated` for `adapters`, refresh the response issue count, and avoid an application-source graph event. Studio tests require stable family ordering and evidence-specific status labels; type checking requires every destination to receive the versioned response. Demo evidence uses the schema-valid 16-entry, 6-active inventory with source and OpenAPI endpoint adapters plus source-flow alongside route, preview, and runtime families.

These checks establish contract, loopback runtime, third-party identity propagation, watcher behavior, and deterministic demo presentation. They do not prove every arbitrary third-party adapter implementation is correct or that an available runtime adapter has started a native process.

## API endpoint contract

Run the endpoint SDK, built-in discovery, scanner, context, and Studio checks:

```powershell
pnpm --filter @topo/endpoint-adapter test
pnpm --filter @topo/adapter-api-source test
pnpm --filter @topo/adapter-openapi test
pnpm --filter @topo/scanner test
pnpm --filter @topo/workspace test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/studio test
pnpm verify:framework-fixtures
pnpm --filter @topo/benchmark system:performance -- --output artifacts/benchmarks/performance-api-endpoints-system.json
```

Contract tests reject unsupported methods, query-bearing paths, out-of-snapshot sources, malformed parameters or responses, invalid adapter identity, and adapter execution failures. Source-adapter tests cover Next.js handlers, methodless and method-suffixed Nuxt handlers, nested and root SvelteKit server routes, literal Express/Hono/Fastify routes, Nest controllers, Next Pages request-variable conventions, and computed-path issues. OpenAPI tests cover JSON/YAML operation metadata and visible malformed-contract issues.

The scanner/workspace integration uses one source snapshot for framework, endpoint, and preview adapters; merges equal `method:path` operations while preserving both source and contract discoveries; tracks conventional contract files incrementally; and emits stable graph issues for malformed evidence. LLM tests require complete schema-version-7 `api-endpoint` records, exact adapter/project relationships, bounded endpoint queries, and malformed-source `issue` records without credentials. Studio tests require the APIs destination, stable endpoint URL selection, complete search text, method/query and evidence-origin filtering, source-screen and inferred-journey usage derived from transitions, honest empty states, evidence detail, and disclosed 200-operation/80-row visual bounds.

Every Next.js, TanStack, React, Vue, Nuxt, and Svelte compatibility fixture must expose expected endpoint IDs in both the normalized graph and LLM projection. The system-performance report uses 10,000 source operations and 10,000 OpenAPI operations as separate hot workloads; each must remain at or below 50 ms p95. These are static discovery and local projection proofs. They do not prove that a development server currently serves the endpoint, that an OpenAPI declaration matches production behavior, or that protected requests are authorized.

## Automatic project understanding contract

Run the adapter, scanner, workspace, daemon, context, Studio, and permanent framework checks:

```powershell
pnpm --filter @topo/flow-adapter test
pnpm --filter @topo/adapter-flow-source test
pnpm --filter @topo/scanner test
pnpm --filter @topo/workspace test
pnpm --filter @topo/daemon test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/studio test
pnpm verify:framework-fixtures
```

The flow-adapter contract rejects unsupported versions, duplicate IDs, unknown source screens, escaping or out-of-snapshot sources, query-bearing targets, invalid methods, confidence outside zero to one, and adapter execution failures. The source adapter proves literal links across HTML and framework components, router navigation and redirects, forms, `fetch`, Axios, source line evidence, deduplication, and visible computed-target issues without project-code execution.

Workspace integration proves Next.js recognition and routing/API/testing/TypeScript capabilities, follows an imported component back to its owning route, resolves literal route and API transitions, emits a bounded inferred journey, and updates dynamic-route resolution after one reported component change. A project-owned `flowAdapters` module runs through the public one-method registry without scanner changes. Daemon integration removes stale graph transitions, inferred journeys, and `flow-transition` context records after one `refreshChanged()` path, proving snapshot, graph, durability, and agent reads move together.

Schema and LLM tests require version-one recognition, transition, inferred-flow, and inferred-step payloads; stable source references; complete project, screen, endpoint, adapter, transition, flow, and next-step relationships; independent bounded queries; relationship integrity; filesystem JSONL; and visible malformed-source issues. Studio uses a schema-valid demo, separates recorded and inferred rails, labels inferred provenance, exposes confidence and traversal bounds, selects inferred steps, and does not mount recorded-flow mutation controls for a candidate.

Framework-fixture report version 2 adds `project-recognition`, `graph-inferred-flows`, and `llm-inferred-flows` checks for all eight permanent projects. Every fixture must recognize its exact framework and routing capability, produce at least one source transition and inferred journey, and expose exactly matching transition, inferred-flow, and inferred-step record counts before its native runtime and browser routes are accepted. This proves static understanding and local runtime compatibility; it does not prove inferred intent is the product's desired journey or authorize automatic source or `.topo/flows` writes.

## Performance benchmark

The benchmark uses real Topo module interfaces and emits the complete evidence envelope in either JSON or Markdown:

```powershell
pnpm benchmark --profile smoke --check
pnpm benchmark --profile standard --format json --output artifacts/benchmarks/standard.json --check
pnpm benchmark --profile stress --iterations 3 --warmup 1 --format json --output artifacts/benchmarks/stress.json --check
pnpm benchmark --profile standard --format json --output artifacts/benchmarks/candidate.json --baseline artifacts/benchmarks/baseline.json --comparison-output artifacts/benchmarks/candidate.comparison.json --check
pnpm benchmark --browser --profile smoke --format json --output artifacts/benchmarks/browser-smoke.json --check
pnpm benchmark --browser --profile standard --format json --output artifacts/benchmarks/browser-standard.json --check
pnpm benchmark --browser --profile stress --format json --output artifacts/benchmarks/browser-stress.json --check
pnpm benchmark:web -- --url http://127.0.0.1:3100 --output artifacts/benchmarks/website.json --iterations 5 --check
pnpm --filter @topo/benchmark studio:loading -- --output artifacts/benchmarks/studio-loading.json
pnpm --filter @topo/benchmark capture:performance -- --output artifacts/benchmarks/capture.json
pnpm --filter @topo/benchmark system:performance -- --output artifacts/benchmarks/system.json
```

A valid CPU/filesystem report has `version: 2`; browser and Studio-loading reports use `version: 3`; capture uses `version: 1`; system uses `version: 5`; a website report has `schemaVersion: 1`; and a before/after report has `schemaVersion: 1`. Every report preserves raw samples plus median, p95, maximum, latency class, budget, exact workload, and runtime context where applicable. A comparison rejects any profile, runtime, renderer, hardware, workload, sample-count, budget, enforcement, or result-identity drift. It calls a result improved or regressed only when both median and p95 cross the 7.5% or 1 ms tolerance, but every hot p95 must remain at or below 50 ms regardless of trend. Browser evidence names seven workloads because product-controlled camera work is separate from external display cadence; it also proves the shared Pixi ticker is stopped and retains baseline, active, and post-teardown heap phases. Website evidence retains all five navigation samples, CLS, and DOM size and fails a main-thread task above 50 ms.

The accepted standard CPU candidate on 2026-08-02 used Node 24.14.0 on an AMD Ryzen 9 5950X with 21 measured iterations. Against `performance-baseline-v2-cpu-standard.json`, `performance-candidate-v2-cpu-scanner-snapshot.json` passed the strict comparison with no regressions or over-target results: complete scan 46.106 ms p95, one-file refresh 15.586 ms, reconciliation 5.680 ms, validated LLM projection 25.116 ms, Atlas layout 21.481 ms, and camera math 3.041 ms. LLM projection improved 56.4% at p95; refresh and Atlas also crossed the two-distribution improvement threshold.

The accepted browser contract-v3 baseline and repeat ran on Chromium 151 through SwiftShader. Both reports and their comparison passed: shared Pixi initialization 38.7 ms, texture upload 18.4 ms p95, cache pressure 6.5 ms, Atlas sprite rendering 36.2 ms, camera frame work 1.1 ms, external cadence 33.4 ms, and four-frame promotion 38 ms. The active heap delta was about 8.0 MB and retained delta about 0.45 MB in the baseline; those are software-renderer, machine-specific values, not native-GPU or universal leak proof.

The production homepage report at `artifacts/benchmarks/performance-website-homepage.json` contains five isolated loads: 128 ms median and 132 ms p95 LCP, 11 ms p95 TTFB, 42.3 ms DOM readiness, 155.5 ms load, zero observed long tasks, zero CLS, and at most 438 DOM elements. A same-machine Chrome trace before the accepted source changes observed 192 ms LCP, a 184 ms CSS-to-font critical chain, and 136 ms layout across 648 nodes; the final trace observed 123 ms LCP and 54 ms layout across 241 nodes. Trace values are diagnostic evidence, while the repeatable JSON runner and its declared budgets are the enforceable contract.

The Studio-loading route-preload comparison passed with three improvements, one stable result, no regressions, and no hot target violations. Notes cold-ready p95 moved from 144.7 ms to 105.8 ms and Atlas cold-ready from 510.4 ms to 247.7 ms. Cached Notes switching remained 3.4 ms p95; cached Atlas switching improved from 40.4 ms to 33.0 ms. `performance-baseline-v3-studio-loading.json`, `performance-candidate-v3-studio-route-preloads.json`, and its comparison retain seven cold and nine hot samples from isolated production contexts. A Chrome critical-path trace attributed the prior Atlas delay to the entry-to-Atlas-to-Pixi-to-WebGL module waterfall; route-specific host preloads remove that serial dependency without exposing Pixi to Notes.

The capture comparison passed both workloads with no regression. Batching graph, snapshot, visual-comparison, and component-preview transitions reduced 20-screen local orchestration p95 from 221.517 ms to 24.486 ms. Reusing one Chromium process while preserving a fresh context per screen reduced the real three-screen external browser batch from 825.256 ms to 479.017 ms. `performance-baseline-v1-capture.json`, `performance-candidate-v1-capture-batched.json`, and its comparison preserve the distinction between product-controlled orchestration and browser work that cannot meet a 50 ms end-to-end budget.

The final system contract-v3 comparison used Node 24.14.0 on the same AMD Ryzen 9 5950X and passed all seven workloads with zero regressions or target violations. Against a real semantic add/remove-route baseline, the 1,000-route daemon refresh moved from 412.620 ms to 40.976 ms p95, a 90.1% reduction. Complete manual rescan improved from 356.346 ms to 295.236 ms p95; daemon graph HTTP was 9.982 ms; Next.js and TanStack 10,000-route discovery were 9.384 ms and 5.792 ms; cold startup was 638.807 ms. The packaged 5 KB help bootstrap measured 68.767 ms p95 and defers the 615 KB command bundle until a real command. `performance-baseline-v3-system-semantic-refresh.json`, `performance-final-v3-system.json`, and its comparison are the accepted semantic evidence. Focused tests additionally require no-op edits to skip derived rewrites, real route changes to settle into JSONL before a context read returns, transient scans to leave terminal history empty, parsed-state cache invalidation after external replacement, and active queue visibility before terminal persistence.

System contract v4 extends that workload with four new 10,000-route adapter paths. The final Node 24.14.0 report passed all eleven workloads and every 50 ms hot ceiling: Next.js 9.144 ms, TanStack 5.806 ms, React 5.663 ms, Vue 5.235 ms, Nuxt 21.961 ms, and Svelte 43.000 ms p95. Graph HTTP measured 17.283 ms. Removing duplicate full-graph schema cloning from the already contract-checked scanner handoff reduced the one-file daemon refresh from a failing 50.327 ms observation to 32.514 ms p95, a 35.4% improvement; the default graph reconciliation path remains validating and parity-tested. Cold daemon startup measured 955.059 ms, manual rescan 350.340 ms, and packaged CLI help 80.788 ms under their explicit cold budgets. `artifacts/benchmarks/performance-system.json` retains all 21 hot samples, five cold samples, workload dimensions, runtime fingerprint, and budgets. These values are evidence for this machine; the versioned workload and 50 ms p95 checks are the portable contract.

System contract v5 adds the two 10,000-operation endpoint paths and passed all thirteen workloads on Node 24.14.0. Source API discovery measured 12.689 ms p95 and OpenAPI discovery 40.540 ms. The six framework discovery paths measured 9.940 ms for Next.js, 6.528 ms for TanStack, 5.080 ms for React, 5.887 ms for Vue, 21.994 ms for Nuxt, and 19.043 ms for Svelte. Daemon graph HTTP was 11.541 ms and one-file source refresh 28.822 ms; cold daemon startup was 724.784 ms, complete manual rescan 264.749 ms, and packaged CLI help 69.257 ms under their separate cold budgets. A compact-JSON locator fast path reduced OpenAPI p95 from the retained initial 45.173 ms candidate to 40.540 ms, while direct string-based Next route parsing reduced the subsequent candidate from 12.508 ms to 9.940 ms. Against `performance-api-baseline-system.json`, every overlapping result is improved or remains inside the project's 7.5%/1 ms stability tolerance. `performance-api-endpoints-system.json` retains 21 hot samples, five cold samples, exact 10,000-operation workload dimensions, runtime fingerprint, and budgets; the two intermediate reports preserve the optimization audit. These measurements are machine-specific evidence, while complete operation counts and the 50 ms hot p95 ceilings are the portable gate.

A paired standard-profile run on 2026-08-02 used Node 24.14.0 and an AMD Ryzen 9 5950X with seven measured iterations after two warmups. Reusing the canvas engine's immutable natural-text collator reduced the 3,553-record LLM projection median from 131.081 ms to 63.675 ms and the 1,000-route Atlas scene median from 55.886 ms to 19.098 ms; p95 changed from 135.430 ms to 71.726 ms and 69.084 ms to 23.750 ms respectively. `artifacts/performance/daemon-baseline.json` and `artifacts/performance/daemon-final.json` retain the raw paired samples. These values are evidence for that runtime and machine only; the checked profile, raw samples, budgets, and semantic ordering tests remain the portable contract.

A later standard-profile run on the same date, runtime, and machine measured the new persistent scanner session. One reported source refresh over the 1,000-route fixture completed in 20.770 ms median and 22.884 ms p95, compared with the preceding complete-scan evidence of 67.820 ms median and 90.761 ms p95: a 69.4% median and 74.8% p95 reduction. The complete scan in the new run remained healthy at 62.412 ms median and 73.554 ms p95. `artifacts/performance/daemon-session.json` retains report-contract-version-2 raw samples and the exact six workload results. These values are evidence for that runtime and machine only; the 50 ms standard-profile refresh p95 budget and source-session correctness tests are the portable contract.

A 15-iteration paired standard-profile run on the same date, runtime, and machine measured the indexed LLM projector over 3,553 canonical records after three warmups. Pre-indexing screen relationships and replacing per-record Zod payload cloning with an equivalent fixed-envelope assertion reduced projection median from 83.920 ms to 50.186 ms and p95 from 123.073 ms to 64.609 ms: improvements of 40.2% and 47.5%. `artifacts/performance/llm-projection-baseline.json` and `artifacts/performance/llm-projection-final.json` retain every raw sample. The runner separately parses the resulting manifest and all records with the exported Zod schemas outside the timed interval, while focused tests compare projected values with those parsers. These timings remain machine-specific evidence; complete schema equivalence, relationship integrity, record counts, and the profile budget are the portable contract.

All three browser commands are executable gates. A native GPU adapter enforces each profile's texture-upload target and camera pacing at 25 ms p95. When the adapter contains `SwiftShader`, texture upload remains enforced against 1.5× the native target; the workload records `nativeGpuBudgetMs` and `softwareRenderer` so an agent cannot confuse that result with native-GPU proof. A SwiftShader pacing miss remains a `fail` result with `enforced: false`, increments `summary.informationalFailures`, and renders as `FAIL (INFO)` in Markdown without failing `--check`. The workload still records full scene size, visible range, visibility mutation count, and maximum product-controlled frame work. This makes software scheduler instability visible without claiming it is native-GPU performance or making the portable integration gate random.

## Source intelligence contract

The workspace-scan benchmark parses every JavaScript or TypeScript route file through the same native Oxc module used by local scans. Standard and stress reports therefore measure filesystem traversal, source reads, compiler metadata, adapter execution, graph normalization, and unchanged-file reuse together rather than timing filename discovery while bypassing parsing.

Focused contracts run with:

```powershell
pnpm --filter @topo/parser-oxc test
pnpm --filter @topo/adapter-topo test
pnpm --filter @topo/preview-scaffold test
pnpm --filter @topo/scanner test
pnpm --filter @topo/protocol test
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio test
pnpm benchmark --profile standard --iterations 7 --warmup 2 --format json --check
pnpm benchmark --profile stress --iterations 3 --warmup 1 --format json --check
pnpm --filter @topo/cli pack:check
```

A passing parser contract proves aliases, type-only imports, value re-exports, callable and non-callable export classification, conservative prop requirements, false-positive resistance, and source-located diagnostics. Preview-scaffold tests prove no-write planning, exact named/default export selection, immediate zero-prop wrappers, inactive required-prop fixture drafts, source and template hashes, existing-target refusal, path containment, and linked-outside-root rejection. Scanner proof adds transitive component coverage, type-only exclusion, blocked preview state, and source-located preview-draft finding evidence. Protocol and Studio tests reject malformed mutation envelopes; the daemon integration rejects a non-loopback browser origin without writing, then performs the authorized write, synchronized graph refresh, bounded finding query, and second-write conflict. The packed CLI proof installs the produced tarball offline and executes a real scan through the external native Oxc runtime dependency.

## Studio loading contract

The production Studio enforces its initial dependency graph during every source and packaged-CLI build:

```powershell
pnpm --filter @topo/studio build
pnpm verify:studio-runtime
```

The build writes `apps/studio/dist/studio-build-report.json`. A passing schema-version-3 report requires no more than 300,000 raw and 95,000 gzip bytes of transitive initial JavaScript, five entry-reachable lazy destination chunks, no Pixi/GPU module in the static entry graph, and entry-reachable review-export and strict-validation chunks that are not statically reachable. The report retains exact files and byte counts for deferred Pixi, review-export, and validation evidence. `@topo/studio-host` tests mutate each dependency graph independently, so eager validation, an eager exporter, an eager Pixi module, a missing destination, an unreachable labeled chunk, or an oversized shell fails a named check. The equivalent six-check report is required inside the CLI tarball and inspected by `pack:check`.

The runtime command rebuilds the relevant packages, launches the production bundle through the loopback Studio host, and writes schema-version-2 `apps/studio/dist/studio-runtime-report.json`. Its daemon seam returns a structurally plausible graph with an invalid timestamp; production `/welcome` must reject it, settle to `offline` with exactly zero routes and components, display a valid-graph error, and render none of the forbidden Fieldbase fixture phrases. A real Canvas-note submission must then produce the explicit daemon-offline error while `data-topo-note-count` remains zero. The same run observes the demo Notes destination chunk with zero Pixi assets, then the demo Atlas destination and deferred Pixi assets after a real GPU canvas becomes visible. All nine checks must pass with no uncaught page errors. The report retains every cold and warm readiness measurement; cold readiness is marked `enforced: false` because process startup, filesystem, browser startup, and scheduler variance are machine-specific, while warm destination switching remains an enforced target. Focused schema, protocol, daemon, and Studio tests additionally reject malformed nested notes, flows, snapshots, component previews, interaction probes, and mutation responses. Readiness milliseconds and the Chromium version remain machine-specific evidence; data authority, fail-closed writes, asset isolation, and error-free initialization are portable pass/fail checks.

`apps/studio/src/async-coordination.test.ts` protects the client-side concurrency seam independently of browser timing. Starting a second hydration must invalidate the first lease, explicit invalidation must block every outstanding commit, a second action must be rejected while one lease is active, and release must be idempotent before a subsequent action can start. The hook uses those primitives for every full resource hydrate and every Studio action, so React render timing is never the locking mechanism.

Focused `@topo/renderer-pixi` tests require every GPU surface's shared host to coalesce resize bursts, cancel queued work before teardown, release partially initialized applications without masking their original error, and keep destruction idempotent. This lifecycle evidence complements the production runtime's visible initialization checks.

## Studio board contract

The Components contract proves all three evidence paths. A source-less coverage gap must retain the selected component identity, resolve one exact consuming-screen identity through `usedBy`, and mount that same screen in the shared `pixi-hybrid` evidence stage. A renderable component must resolve its exact selected preview source to the newest matching artifact, display non-empty image pixels, update the `preview=<stable-id>` address when a variant is selected, and retain both component and preview identity through reload. Failed, unavailable, and uncaptured artifacts remain explicit states rather than silently falling back to unrelated pixels. The addressable `?canvas=map` surface must expose component-scene version 2, at least eight source-domain groups, an exact selected-group identity, and complete-scene width, height, and aspect telemetry with an aspect of at least `1.4`. Focused layout tests additionally require a large catalog to place multiple groups per row, center every narrower row on a common atlas center, and preserve every component identity.

The Flows contract rejects the same failure for variable-width lanes. Its production Pixi surface must expose flow-scene version 1, at least five source flows, exactly two focused lanes, an exact selected-flow identity, and complete-scene geometry with an aspect of at least `1.4`. Focused layout tests require a twelve-flow catalog to occupy multiple centered rows, preserve every explicit edge and endpoint, retain selected-step world-origin anchoring, keep the selected flow in the two-lane focus set, and bound normal camera width to the selected lane plus 24px per side while retaining 280px of trailing stage space. The production board also requires compact definition and selected-step evidence before either editor opens, an ordered route-resolution step navigator, browser-addressable disclosure controls, and the Paper **Trace flow** action. The board verifier starts a seeded recording on the exact selected entry route and cancels it, requiring the ephemeral HUD to disappear without creating a flow.

Run the complete Paper-derived production contract:

```powershell
pnpm verify:studio-boards
```

The command consumes the same React-independent `studioBoards` and `studioFrame` exports used by Studio, so there is no duplicated test route list. It serves the production bundle with the normal loopback host, opens all 23 boards in Chromium at 1440 × 900, and writes `apps/studio/dist/studio-board-report.json` plus `apps/studio/dist/studio-board-screenshots/*.png`.

A passing schema-version-1 report requires HTTP 200, exact board identity, a board-specific ready selector, zero page, console, or visible Studio errors, and the declared theme. Every visible input, textarea, and select must also expose a native label association and stable name, while every visible label element must resolve to an actual form control; the report retains exact visible-control, unlabeled-control, unnamed-control, and orphaned-label evidence per board. It resolves the active theme's actual CSS values and requires `--color-text-faint` on both `--color-surface` and `--color-well`, plus `--color-error` on `--color-surface-active`, to meet `4.5:1`. Standard boards must retain the 52px topbar, 818px body, and 30px statusbar; Settings keeps the 52px topbar and 848px body without a statusbar; the Live and Probe support states are explicitly immersive at 1440 × 900. Three-pane boards must remain 248 / 928 / 264px, and two-pane report/index boards must remain 248 / 1192px. Structural panes, canvas titlebars, status surfaces, and rounded renderer viewports must remain borderless; the only full-shell rule is the header's 1px theme-correct bottom divider. GPU boards must mount exactly one declared Pixi renderer with no renderer error; DOM-only boards must mount none. Atlas Routes must open on selected-screen evidence, expose the complete organized atlas at `?canvas=map`, retain map mode through reload, and return to the same selected screen when Screen removes that query. The focused layout suite fixes a 33-route area at six columns and 2344 × 1672 world pixels so large-map balance cannot silently regress. A separate multi-region fixture requires the complete route map to remain landscape, preserves vertical region reading order, and centers the narrower region against the widest section. Focused Studio tests keep region-first focus and semantic label visibility deterministic, while renderer tests retain the exact major/minor dot-field classification. Screenshots remain review evidence, not an automated claim of pixel identity with Paper.

Focused schema, protocol, daemon, LLM-context, and Studio tests additionally prove Settings authority: the version-one capture policy accepts only bounded non-secret values; `GET /project` returns package identity, roots, config path, and the exact sanitized policy; bounded project queries contain the same policy and no preview secrets; legacy local fields are discarded; live-frame limits clamp to one through eight; and About metadata resolves from the canonical product manifest rather than stale copy.

The Components board adds three explicit deep-module checks. Its default coverage-gap renderer must prove the selected component and its consuming screen agree with the shared hybrid evidence stage; a direct renderable selection must prove exact captured variant pixels plus address and reload retention; the verifier then switches to Map and requires component scene version 2, at least eight fixture source-domain groups, a landscape aspect, and one exact selected-group identity. The Studio fixture suite additionally requires exactly 128 unique, human-readable component names across forms, navigation, feedback, data, customers, jobs, billing, scheduling, dispatch, and UI; rejects `Component<number>` filler; proves the first missing preview is the source-backed `AssignmentDrawer`; and requires all 11 demo notes to have distinct titles and route targets. Focused screen-evidence tests prove component consumers resolve by exact screen, route, or source identity without copy heuristics. Focused component-preview-evidence tests prove source-order defaults, exact variant selection, newest-artifact choice, and explicit failed, uncaptured, and unavailable states. Focused canvas-engine tests prove automatic source-root classification, gap-first component ordering, configured longest-prefix ownership, complete membership, and aggregate preview/route-usage counts. Layout tests prove stable bounded rows and selected-group bounds. LLM tests prove that context schema version 7 repeats the same group on a bounded `component` record and adds configured project relationships; MCP and daemon tests validate the same scene through their public read interfaces.

The Components and Flows boards also exercise addressable selection through the production host. The verifier opens an exact component, preview variant, or flow-step query, compares it with stable DOM selection evidence, performs a real selection, requires the URL to adopt the new canonical identity, reloads, and requires the same selected identity to return. Focused `@topo/studio-api` tests cover all eight query fields, unrelated query and hash preservation, deletion, and the 512-character bound; Studio reconciliation tests cover valid, stale, cross-component preview, cross-flow, and not-yet-hydrated identities.

The Interaction Probe board direct-loads one exact route observation, requires all three canonical fixture controls to appear in the labeled target selector, switches to a skipped destructive observation, and verifies its status, URL identity, and reload retention. Focused Studio API, selection, model, and search tests prove `probe=<stable-id>` parsing and patching, canonical owning-screen reconciliation, deterministic stale fallback, exact search targets, and screen-then-probe activation. These checks prove addressable Studio consumption of existing probe artifacts; they do not create or mutate diagnostic evidence.

## Signed preview profile contract

Run the focused transport tests and complete browser seam:

```powershell
pnpm --filter @topo/gateway test
pnpm --filter @topo/runtime-bridge test
pnpm --filter @topo/protocol test
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio-host test
pnpm --filter @topo/studio test
pnpm verify:studio-profiles
```

The focused tests prove opaque expiring sessions, loopback-only targets, reserved-header rejection, bounded HTTP forwarding, signed HTML bridge injection, exact CSP hashing, partitioned response cookies, cross-profile token rejection, authenticated WebSockets, runtime protocol validation, bounded secret-filtered bridge events, exact-source and exact-origin event subscription, snapshot/live deduplication inputs, exact-origin anchor correlation, and LLM exclusion. The browser command builds the runtime bridge and gateway before writing `apps/studio/dist/studio-profile-report.json`. A passing schema-version-1 report uses a real gateway, daemon, production Studio, and Chromium context; selects Owner and Customer in Settings; verifies distinct loopback hosts; observes matching header, configured-cookie, local-storage, and `vite-hmr` WebSocket evidence in each iframe; confirms bridge version 1; requests one real button by normalized coordinates and receives its role, accessible name, test locator, and 16-hex DOM fingerprint from both origins; confirms clean post-bootstrap URLs; finds no capability in bounded context queries; and records zero page errors.

`docs:check` is also a prerequisite of root dev, typecheck, test, and build commands. It proves that public product claims are synchronized with repository evidence and a fingerprinted change record. It does not prove runtime behavior, deployment, package publication, or hosted availability.

## Studio source-evidence workspaces

The shared Editor, Doctor, and Notes evidence joins, finding-to-screen and note-to-screen resolvers, configured preview-path handling, and pointer-mode policy have focused coverage:

```powershell
pnpm --filter @topo/react test
pnpm --filter @topo/studio test
```

`apps/studio/src/note-composer.test.ts` verifies all eight Paper presets against the seven canonical note types, exact selected-screen and selected-flow-step targeting, flow fallback only within the explicitly selected flow, target-free free-standing notes, missing-selection behavior, title validation, and the absence of fabricated anchor data. Studio typechecking also proves the popover, runtime action, offline demo writer, and daemon writer share `WriteNoteInput` rather than maintaining separate quick-create payloads.

For browser evidence, open `/editor/canvas?demo=1` at 1440 × 900. The stage must be `(248, 92, 928 × 778)`, the default camera `(74, 36, 1)`, and the selected artboard `(322, 128, 780 × 706)`. The selected screen must expose `data-screen-id`, `data-snapshot-id`, `data-preview-kind`, and its concrete `data-preview-path`; its panes must show the same source, component, finding, note, and capture identities. Select and Pan must report mutually exclusive pressed states, Zoom then Fit must restore the default camera, and selecting another screen must replace the stable evidence IDs. `/editor/insert?demo=1` must identify itself as a discovered component-preview catalog and open the selected component in Atlas. No fake page layers, typography controls, fills, or visual insertion actions may appear.

Open `/doctor/findings?demo=1` at the same viewport. It must retain the 248 / 928 / 264 Paper composition, mount exactly one `pixi-hybrid` renderer, expose the selected finding and screen IDs, and show the same live, snapshot, unresolved-preview, or unseen state as the shared evidence module. Choosing a finding with exact screen source or component `usedBy` evidence must select that screen. The board must not contain `PreviewMock` or a coordinate pin inferred from source text.

Open `/notes?demo=1` at the same viewport. It must retain the 248px filter rail, flexible content pane, and stable source order. Searching **technician** returns only matching Markdown or structured anchor records; choosing **Drifted** composes with that query instead of replacing it. Open `/notes/detail?demo=1`. It must retain the 248 / 928 / 264 Paper composition, canonical hierarchy-ordered routes, one `pixi-hybrid` renderer, and the stable note, screen, snapshot, preview-kind, and anchor-status identities. Source, note body, anchor health, and previous/next navigation must be present before any editor. Edit must disclose title/body controls and deletion; Cancel must restore read mode without a mutation. A screen-target, canonical route, anchor source, or component-target note must open only its explicitly related screen. An unbound note must not silently fall back to the first graph screen. Selecting another route changes the visible candidate without mutating the Markdown note; Re-anchor persists that source relationship. A point or region overlay may exist only when the note contains normalized coordinates.

Open `/atlas/routes?demo=1&overlay=annotate` to verify the Paper palette at 416px wide with four aligned choices per row. Choosing a type must replace the palette with a title/body composer, expose `data-note-preset` and `data-target-kind`, and show the exact durable target disclosure. Creating an element, region, or screen note may include the selected screen ID and route but no anchor. Choosing Flow marker must report **No durable target** and create a target-free note whose canonical type is `flow`.

## Project-owned Studio customization

Run the schema, composition, transport, context, host, and installed-consumer checks:

```powershell
pnpm --filter @topo/protocol test
pnpm --filter @topo/config test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio test
pnpm --filter @topo/studio-host test
pnpm --filter @topo/cli build
pnpm --filter @topo/cli pack:check
```

Protocol and config tests accept compact project manifests—including one-field patches to built-in destinations and commands—and reject remote frame URLs, malformed IDs, and query-bearing destination paths. Studio tests add, edit, and remove entries, preserve inherited components and command behavior, derive new-entry defaults, execute declarative navigation, require runtime fields on new entries, and preserve the complete base Studio with a visible issue for an ambiguous route or missing command target. Daemon tests require the exact schema-version-1 object from `GET /studio`; LLM tests require the same object in the context manifest and canonical project record. Host tests allow loopback IPv4, localhost, and IPv6 frame origins while rejecting remote origins.

The package gate installs the actual CLI tarball into an isolated project, writes a Reviews destination and command into `topo.config.ts`, and requires installed `topo context query --kind project --json` to return that normalized composition before the fixture restores its generated config and proves clean uninstall. Passing establishes a usable installed-project seam; it does not claim that the configured web view itself is healthy or that source-only React extension packages are published.

## Reversible initializer and packaged CLI

The initializer and package artifact have separate focused gates:

```powershell
pnpm --filter @topo/initializer test
pnpm --filter @topo/project-lifecycle test
pnpm --filter @topo/cli typecheck
pnpm --filter @topo/cli build
pnpm --filter @topo/cli pack:check
```

Initializer tests cover single-app and monorepo detection, explicit application selection, exact dry-run plans, transactional apply, drift-blocked uninstall, and preservation of user-authored records. Lifecycle tests require a no-write v2-to-v3 migration plan, current and unsupported-version evidence, stale-plan rejection, package-only update ownership, unrelated-field preservation, rollback-ready uninstall baselines, and refusal to overwrite a project-owned script. CLI tests require bounded JSON with no raw package or manifest contents. LLM-context tests require the sanitized v3 lifecycle block in both the context manifest and project record, while unsupported metadata becomes a source-located issue.

The package gate inspects the actual tarball, rejects private, internal, or workspace-bound runtime dependencies and test/spec declaration artifacts, requires public access, npm provenance, the executable, runtime declarations, license, build manifest, and compiled Studio, then installs it into an isolated fixture under Node.js 24. Its focused Studio validator requires report schema version 2, all five named checks, five destinations, deferred Pixi, and deferred review rendering; the final JSON summary repeats that evidence instead of silently collapsing the new check. Declaration emission uses a packaging-only TypeScript project so repository tests remain typechecked locally without entering the consumer artifact. The pure release contract requires the packed package and `build.json` identities to agree; when `TOPO_RELEASE_TAG` is present, it must exactly equal `v<package-version>`. `TOPO_PACK_OUTPUT` retains the already tested tarball with fail-if-present semantics so publishing cannot silently rebuild or replace it. The ESM bundle keeps CommonJS image decoding behind the explicit `pngjs` runtime dependency so Node owns built-in-module interop instead of an inlined dynamic-require shim. The fixture must expose help including `migrate` and `update`, produce a no-write plan, detect and initialize a Next.js app with manifest schema v3, prove the packaged migration command reports that manifest as current, project one temporary Studio customization into canonical context, restore the generated config, and uninstall back to the original managed files. Passing this gate proves a consumable local tarball; it does not prove npm publication or registry ownership.

## CI and npm release contract

`docs:check` parses `.github/workflows/ci.yml` and `.github/workflows/publish.yml` as behavior-bearing product evidence. The CI verify job must run documentation, type, unit, build, packed-consumer, and CPU smoke-benchmark gates. Its fail-independent browser matrix must run production Studio loading, all 23 boards, signed profiles, complete local runtime, all eight native framework fixtures, Storybook capture, and a browser smoke benchmark after installing Chromium. Every lane uploads available JSON, PNG, and board screenshot evidence even after failure.

Publishing remains a separate, deliberate boundary. A published GitHub release triggers the `npm` environment on a GitHub-hosted Linux runner with `contents: read` and `id-token: write`. The workflow reruns documentation plus the CLI dependency graph's type, test, and build tasks; requires the GitHub release tag to equal the packed version; consumer-tests and retains one tarball; upgrades to an OIDC-capable npm 11 CLI; and passes that exact file to `npm publish --access public --provenance`. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` is accepted by the repository contract.

Before the first automated publication, the owner must establish the `@topo` npm scope/package and configure npm trusted publishing for `byronwade/topo.byronwade.com`, workflow `publish.yml`, environment `npm`, with `npm publish` allowed. GitHub environment protection and tag protection should be configured in provider settings. Until the registry package exists and an actual release succeeds, `docs/product.json` remains `packagePublished: false` and the public installation path remains the source preview.

## Public Studio showcase

Run the builder, ownership, rewrite, and production website contracts:

```powershell
pnpm turbo run build --filter=@topo/showcase-builder
pnpm --filter @topo/showcase-builder test
pnpm --filter @topo/web test
pnpm --filter @topo/web build
```

The builder test uses an isolated valid Vite fixture and proves deterministic file ordering and hashes, daemon-placeholder removal, root-asset rebasing, owned replacement, preservation of unowned output, source/output containment rejection, URL-path rejection, and refusal to publish a Studio artifact whose production checks fail. The website test requires the default relative Demo handoff plus rewrites for both `/demo-studio` and arbitrary Studio descendants, while retaining the validated HTTP(S) external override. A passing website production build must prepare the current Studio artifact before Next.js compilation; its ignored `public/_topo-studio/showcase-manifest.json` reports the copied file count, total bytes, source-build check identities, and hash of every emitted file. These gates prove artifact composition and route configuration, not a deployed-domain response.

## Production Studio host

The portable host and Studio daemon-origin selection have focused coverage:

```powershell
pnpm --filter @topo/studio-host test
pnpm --filter @topo/studio test
```

For the real process boundary, build first and run `node packages/cli/dist/index.js dev apps/playground-next-app --port 0 --studio-port 0 --no-watch`. The command must print application, daemon, profile-gateway, and Studio state without printing signed launch capabilities. The daemon `/health`, `/graph`, `/project`, and `/preview/sessions` endpoints must succeed; requesting `/atlas/routes` and `/notes` from the printed Studio origin must return the injected production application rather than JSON or a Vite client. In Chromium, Studio must report `Daemon connected`, render one Pixi canvas and the real project graph, expose the configured profile names, contain no `@vite/client`, and produce no CSP, console, or Pixi initialization errors. Terminating the CLI process must release application, gateway, daemon, and Studio listeners.

The browser layer additionally requires a Chromium installation:

```powershell
pnpm exec playwright install chromium
```

The real preview smoke path uses the fixture's native development server, captures routes with Playwright, and runs the isolated runtime probe. Those checks are kept separate from unit tests because they require a browser process and a live application server.

## Complete local runtime workflow

Run the permanent whole-stack contract:

```powershell
pnpm verify:local-runtime
```

The verifier allocates an unused native application port, creates a temporary durable project root, and points it at the real `apps/playground-tanstack-router` source root. It starts the exact `@topo/local-runtime` implementation used by `topo dev`; no benchmark-owned copy of the orchestration exists. A passing schema-version-4 runtime report requires all eleven checks: managed TanStack startup, the exact four-route daemon graph, one signed Anonymous gateway, and the compiled production Studio initially opening the exact signed-gateway `overview` screen in one Pixi canvas with one mounted and reported live frame while retaining the exact scene-version-4 regional atlas contract, no Vite client, and no browser errors. The fixture's version-one atlas policy must merge `/jobs` and `/settings` into one **Workspace** district, leaving **Entry** automatic; the daemon scene and rendered Studio must therefore agree on the exact two regions, two areas, route-node membership, and selected `Entry / Entry` location. Studio exposes those topology metrics and selected location through stable semantic attributes so the verifier does not treat visible copy or DOM order as a machine interface. The browser then opens the addressable Map presentation, requires zero mounted or reported live frames, reloads that exact presentation, and returns to Screen with the same selected identity and exactly one promoted signed-gateway iframe whose native identity is `overview`. The remaining checks require `/jobs/:jobId` to capture successfully through `/jobs/rf-1042` while retaining canonical identity; a real route capture accepted as a local baseline and recaptured through the hash-fast comparison path with Studio plus schema-version-7 LLM evidence; a configured required-prop component wrapper that becomes graph provenance, a real Chromium PNG, Studio state, and both component and preview LLM records; the checked-in three-step JSON flow plus a temporary create-update-branch-delete lifecycle observed through daemon writes, Studio SSE, and bounded `flow`/`flow-step` context; a signed-iframe trace that clicks `/`, `/jobs`, and concrete `/jobs/rf-1042`, saves canonical `/jobs/:jobId`, requires the resulting one `flow` and three `flow-step` records, and deletes the temporary JSON; one temporary note observed as Markdown, LLM context, and live Studio state before deletion; and release of application, daemon, Studio, and gateway origins through one idempotent close.

The verifier writes `artifacts/local-runtime/report.json` and `artifacts/local-runtime/studio-atlas.png`. The report retains the route-scene version, exact route paths, section identities and membership, configured group identities and membership, rendered route, region, and area counts, selected region/area location, initial Screen, addressable and reloaded Map, final Screen presentation, mounted and reported frame counts at each boundary, clean frame URL, exact selected-screen retention, and native screen identity. The same check queries bounded route context and requires `/jobs` and `/jobs/:jobId` to reference one another through canonical schema-v7 IDs in both hierarchy data and reciprocal `parent-route` / `child-route` relationships. Focused canvas tests additionally require one route family to remain intact when adapter states disagree on a group, require `/jobs/admin` to override `/jobs` without changing route identity, publish exact parent-child route ancestry, compose exact districts into deterministic regions, arrange nested families into hierarchy lanes, keep large flat domains in bounded grids, and split only qualifying oversized domains. Studio presentation tests measure both rows of region and area headers, keep provenance on its own row, and require trailing counts or layout-mode labels to become hidden before they can collide with leading identity. Studio tests also require bounded route-thumbnail candidates to retain the primary screen and capture identity. Its temporary project keeps note and generated-context mutations away from the checked-in fixture while exercising the real project-root/source-root split. The Studio contract forbids both speculative Map-mode iframes and event-stream frame activation before the initial resource hydrate supplies the signed profile descriptor; an early clean-origin request would surface as a 401 console/network failure and fail this gate.

## Visual baseline and comparison contract

Run the focused durable, pixel, transport, context, and Studio checks:

```powershell
pnpm --filter @topo/storage test
pnpm --filter @topo/snapshots test
pnpm --filter @topo/protocol test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/mcp test
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio typecheck
pnpm verify:local-runtime
```

The snapshot tests create real PNG buffers, accept the first capture, recapture changed pixels, require exact metrics and a root-contained diff file, and prove equal hashes do not touch missing image files. Storage tests require one replaceable authority and one latest comparison per screen while preserving version-one state compatibility; a 24-writer multi-store case also requires every concurrent record to survive one path-scoped atomic transaction queue. Daemon tests cover invalid IDs, acceptance, visual listing, baseline bytes, context synchronization, and context schema version 7. MCP tests expose discoverable baseline and comparison resource templates. The whole-stack verifier then accepts and recaptures a real TanStack route, observes the result in production Studio, reads its PNG over loopback, and queries both visual record kinds.

## Managed native application runtime

The lifecycle interface has focused process tests:

```powershell
pnpm --filter @topo/application-runtime test
pnpm --filter @topo/config test
pnpm --filter @topo/cli typecheck
```

The suite proves healthy-origin reuse without ownership, external and managed mode failures, loopback-only automatic startup, explicit tokenized commands, package-manager discovery, framework-specific argument forwarding, project-installed adapter loading, bounded startup output, early and unexpected exits, idempotent process-tree cleanup, and released ports. The package-script case runs a real child server through the platform package manager; it is not a mocked spawn.

For the complete managed TanStack path, leave port 3010 free and run:

```powershell
pnpm build
node packages/cli/dist/index.js dev apps/playground-tanstack-router --port 0 --studio-port 0 --no-watch
```

Output must show the Vite host and port arguments followed by `Topo app: http://localhost:3010/ (managed · tanstack)`, then distinct daemon and Studio origins. In Chromium, the printed Studio `/atlas/routes` deep link must report `Daemon connected`, expose four routes and one Pixi canvas, load a live iframe from `http://localhost:3010/`, inject the printed daemon URL, contain no `@vite/client`, and emit no console warnings, errors, CSP issues, or Pixi initialization failures. Shutdown must release the application, daemon, and Studio listeners. The Next.js runtime adapter's host and port plan is covered independently in the same focused suite; an already-running Next origin exercises the explicit reuse path rather than being misreported as Topo-owned.

The TanStack Router compatibility path is permanent and generated-tree-first:

```powershell
pnpm --filter @topo/playground-tanstack-router build
pnpm --filter @topo/adapter-tanstack test
pnpm --filter @topo/workspace test
pnpm run topo -- scan apps/playground-tanstack-router --json
pnpm run topo -- context export apps/playground-tanstack-router --json
```

The scan must report framework `tanstack-router`, exactly `/`, `/jobs`, `/jobs/:jobId`, and `/settings/profile`, `src/routeTree.gen.ts` source evidence, and no static findings. The context manifest must include four routes, four screens, three hierarchy edges, the checked-in `review-job` flow, and its three independently queryable steps. Browser smoke runs the Vite project on port 3010 and verifies overview, jobs, a concrete dynamic job, and profile with no page errors.

## Framework compatibility fixtures

The reusable native compatibility gate covers all eight permanent routing fixtures:

```powershell
pnpm verify:framework-fixtures
```

The command builds `apps/playground-next-app`, `apps/playground-next-pages`, `apps/playground-tanstack-router`, `apps/playground-tanstack-start`, `apps/playground-react`, `apps/playground-vue`, `apps/playground-nuxt`, and `apps/playground-svelte`, then writes `artifacts/framework-fixtures/report.json`. For each fixture, a passing schema-version-2 report requires the expected framework and routing capability recognition, exact normalized route or route-state set from `scanWorkspace()`, every parameterized canonical route to resolve to the fixture's project-owned concrete example, at least one source transition and inferred journey with equal graph/context counts, the checked-in flow and independently queryable steps from `loadLlmContext()`, the expected adapter and owned process from `startApplicationRuntime()`, every concrete route and expected status in Chromium, its stable `data-topo-screen` identity, no page or unexpected console errors, and a released origin after shutdown. The App Router contract proves six normalized screens including `default`, `loading`, and `not-found` states plus five concrete browser visits. The Pages contract includes a real custom 404, a dynamic customer route, and an API handler that must not enter the route graph. The TanStack contracts use generated route trees, including current Start SSR and Nitro/Vite serving. React and Vue prove static router declarations through native Vite servers; Nuxt and SvelteKit prove their public file conventions and native development lifecycles.

This gate proves the same public seams an installed framework adapter must use and produces retained machine-readable evidence. The built-in report covers 30 concrete browser routes across the eight fixtures.

## Diagnostic quality-gate contract

Run the shared report and installed-consumer checks:

```powershell
pnpm --filter @topo/protocol test
pnpm --filter @topo/diagnostics test
pnpm --filter @topo/cli pack:check
```

Protocol tests validate a complete schema-version-1 report without a duplicated graph. Diagnostics tests prove `low` versus `medium` thresholds, explicit advisory-only policy, and blocking route activation errors. The packed CLI fixture installs the real tarball, requires a clean project to exit `0`, writes an inert control, requires a bounded JSON report and exit `1`, then restores the fixture. Runtime-probe unit evidence uses an injected worker and does not prove a native preview server was available; real-browser interaction behavior remains covered by the local runtime and Studio probe contracts.

## Parameterized route preview contract

Run the schema, scanner, capture, diagnostic, live-frame, Doctor, LLM, and native browser checks:

```powershell
pnpm --filter @topo/schema test
pnpm --filter @topo/config test
pnpm --filter @topo/scanner test
pnpm --filter @topo/snapshots test
pnpm --filter @topo/diagnostics test
pnpm --filter @topo/live-frame-host test
pnpm --filter @topo/doctor test
pnpm --filter @topo/llm-context test
pnpm verify:framework-fixtures
pnpm verify:local-runtime
```

Focused tests reject origins, hashes, and still-parameterized destinations; preserve canonical route identity; invalidate capture evidence when a mapping changes; avoid launching a browser for unresolved patterns; and retain actual preview paths in snapshots, probes, live frames, Studio, Doctor, and context relationships. The framework report requires every dynamic route in Pages Router, TanStack Router, and TanStack Start to match its checked-in example before visiting that concrete page in Chromium. The local-runtime report independently requires a real `/jobs/:jobId` capture whose requested `previewPath` is `/jobs/rf-1042`.

## Nested application root contract

Run the focused ownership suites:

```powershell
pnpm --filter @topo/config test
pnpm --filter @topo/workspace test
pnpm --filter @topo/application-runtime test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/daemon test
```

Config tests require `.`, a nested `apps/web` source, platform-native paths, an adjacent parent path, one explicit absolute source root, and a linked source root; reject empty or null-byte selectors; and fail before scanning for missing or non-directory targets. Both external cases must retain the configured logical `sourceRoot` without changing durable `projectRoot` ownership. The nested daemon fixture creates a repository-level project with `rootDir: "apps/web"`. It must discover and watch a new route under the nested source root, persist an API-created Markdown note only under the repository `.topo/notes`, leave `apps/web/.topo` absent, and expose LLM context schema version 7 with distinct `projectRoot`, `sourceRoot`, and the source-root `rootDir` alias. The complete local-runtime fixture additionally keeps its temporary durable project separate from the checked-in TanStack source while exercising the real process, browser, note, flow, capture, and context paths. Workspace and runtime fixtures prove that relative extension modules resolve from the project root while scanner and process work uses the selected application source.

## Review export contract

The shared exporter and its daemon and consumer seams have focused coverage:

```powershell
pnpm --filter @topo/exporter test
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio test
pnpm --filter @topo/cli pack:check
```

Exporter tests require complete Markdown sections and explicit snapshot references, SARIF 2.1.0 rules/results with structured note evidence, escaped self-contained HTML, inclusion filters, and fail-closed format validation. Daemon tests request Markdown, SARIF, HTML, and an invalid format from `/review`. The packed-CLI fixture runs a real top-level HTML export after initialization and verifies the artifact before uninstalling. These checks prove deterministic artifact generation and transport; they do not constitute GitHub code-scanning upload evidence.

## Doctor report contract

Run the shared report, transport, projection, and consumer checks:

```powershell
pnpm --filter @topo/browser test
pnpm --filter @topo/protocol test
pnpm --filter @topo/doctor test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio test
pnpm --filter @topo/cli pack:check
pnpm verify:studio-boards
```

The Doctor suite injects one complete runtime probe and verifies ten stable checks, including explicit or ambiguous application-source selection, configured or unresolved parameterized route examples, blocking errors versus actionable warnings, summaries, and credential exclusion. The mixed-root fixture uses two exact screen framework families and requires the stable `application.source-selection` warning, normalized family evidence, and `rootDir` remediation. Browser tests prove exact-path inspection without launching Chromium. Protocol tests validate the report and `doctor` invalidation. Daemon tests cover `GET` and `POST /doctor`, synchronized `doctor-check` context records, and generated JSONL. Studio tests prove canonical scope composition without truncation and exact finding search targets. The production board verifier requires all 14 demo findings, distinct environment and security groups, a successful remediation copy, an exact report-to-evidence finding link, and direct/clicked identity retention after reload. The packed-consumer fixture executes installed `topo doctor --json` and requires all ten evidence-bearing checks, including exact source-selection identity. These checks prove the local report and Studio consumer contracts; an unreachable preview, ambiguous source root, or missing route example remains a warning and does not prove that a real application session was exercised.

## Cache management

Run the contained filesystem, transport, and Studio-consumer checks:

```powershell
pnpm --filter @topo/cache test
pnpm --filter @topo/cache typecheck
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio test
pnpm --filter @topo/cli typecheck
```

The cache suite proves deterministic recursive totals, a write-free dry run, retained durable artifacts, an empty reusable cache root, and a Windows junction escape whose external marker survives cleanup. Daemon integration validates typed inspection, malformed-request rejection, dry-run behavior, and real cleanup while preserving a note. Studio tests validate cache resource events and compact byte rendering. After building the CLI, `node packages/cli/dist/index.js cache inspect . --json` and `cache clean . --dry-run --json` provide non-mutating package-level smoke evidence.

## Bounded job history

Run the storage, queue, projection, and daemon contracts:

```powershell
pnpm --filter @topo/storage test
pnpm --filter @topo/jobs test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/daemon test
```

Storage proves that active jobs survive every limit, terminal jobs retain newest-first order, legacy state compacts atomically, and repeated compaction does not double-count pruning. The queue exposes the same retention object as its job list. LLM projection includes that object in the project record. Daemon integration starts from an oversized legacy state, verifies the persisted migration, and requires `GET /jobs` to return the retained jobs plus its versioned limit, retained count, and cumulative pruned count.

## Continuous source refresh

The daemon integration suite proves narrow route impact, preserved unaffected capture state, persisted recapture evidence, and refreshed LLM context against a real filesystem watcher:

```powershell
pnpm --filter @topo/graph test
pnpm --filter @topo/snapshots test
pnpm --filter @topo/protocol test
pnpm --filter @topo/daemon test
pnpm --filter @topo/studio test
```

For a live framework/HMR proof after `pnpm build`, use three terminals:

```powershell
pnpm --filter @topo/playground-tanstack-router dev
```

```powershell
node packages/cli/dist/index.js dev apps/playground-tanstack-router --port 4601
```

```powershell
$env:VITE_TOPO_DAEMON_URL = "http://127.0.0.1:4601"
pnpm --filter @topo/studio dev -- --host 127.0.0.1 --port 4176
```

Open `http://127.0.0.1:4176/atlas/routes`, select `/`, then edit and restore the home route headline. A valid proof shows the promoted iframe update through framework HMR, a completed watcher capture job, refreshed snapshot metadata in Studio, a changed `/image.png?v=<contentHash>` URL, `render status captured` in `GET /context`, and no browser console errors. Because the generated TanStack tree does not expose each route implementation as direct source evidence, changing `src/routes/index.tsx` must use the documented conservative visual refresh instead of claiming a false narrow dependency.

The runtime analyzer contract includes a real loopback-browser fixture:

```powershell
pnpm --filter @topo/analyzer-runtime test
```

It proves that a no-effect control becomes `possibly-inert`, ordinary click focus is ignored, typed DOM/network/focus/storage/application-event and dialog effects are recognized, implicit non-GET forms are skipped, and destructive controls are never activated. For a Studio-to-daemon smoke run, start `pnpm mvp`, open `/atlas/probe`, select a route, and use **Run probe**. Verify that `GET http://127.0.0.1:4599/interaction-probes?routePath=/` returns the same target, status, effects, and evidence visible in Studio and that an `interaction-probe` record exists in `.topo/llm/records/interaction-probe.jsonl`.

The standalone component runtime has its own browser-backed contract test and a manual fixture server:

```powershell
pnpm --filter @topo/preview-runtime test
pnpm preview:component
```

The second command prints a transient capability-scoped URL for the playground's `StatusCard` `Routes` export and remains active until interrupted. A valid proof reaches `html[data-topo-preview-status="ready"]`, renders non-empty component bounds, reports zero browser page errors, and can be captured under `artifacts/studio-verification/`. The runtime test also verifies hook-based React rendering, generic bare-origin 404 behavior, source traversal rejection, missing-export evidence, and deterministic shutdown.

Storybook ingestion has a separate executable contract:

```powershell
pnpm verify:storybook
```

This builds the permanent Storybook 10 React/Vite fixture and the benchmark dependency graph, serves the generated static Storybook on an ephemeral loopback port, and scans the same component source through `@topo/workspace`. A passing machine-readable report at `apps/benchmark/dist/storybook-capture-report.json` requires the `Healthy`, `Warning`, and `Loading` exports with exact source lines, real index-derived story IDs, three successful Chromium iframe captures, and three content-addressed PNG artifacts larger than 1,000 bytes. Unit tests also exercise legacy `/stories.json` compatibility and reject non-exported helper constants as stories.

The LLM contract has an additional deterministic smoke path:

```powershell
pnpm run topo -- context export apps/playground-next-app --json
pnpm run topo -- context query apps/playground-next-app --kind route,screen,component,interaction-probe --limit 10 --json
```

Verify that every line in `records.jsonl` parses, manifest counts match the per-kind streams, relationship targets use explicit kinds, and exported data contains no preview cookies, headers, local-storage values, signed sessions, tokens, or environment values. The MCP integration test uses the official client and in-memory transport to verify resource discovery and structured tool output without relying on a shell protocol mock.

The Markdown-note lifecycle has focused storage, daemon, projection, MCP, and Studio-model coverage:

```powershell
pnpm --filter @topo/notes test
pnpm --filter @topo/daemon test
pnpm --filter @topo/llm-context test
pnpm --filter @topo/mcp test
pnpm --filter @topo/studio test
pnpm --filter @topo/cli test
pnpm --filter @topo/cli pack:check
```

CLI tests run the actual note store behind one injected presentation adapter and require deterministic add/show/update/clear/remove behavior, strict enum and target validation, JSON output, and exactly one context refresh after every accepted mutation. The packed CLI fixture repeats the lifecycle through the installed executable: it creates a namespaced note, finds the canonical note through a bounded context query, updates and shows it, removes it, and requires the next context query to contain zero note records. This proves both package inclusion and projection freshness rather than help-text presence alone.

For browser evidence, open `/notes?demo=1`, select a note, edit and save its title and body, resolve and reopen it, and re-anchor a drifted note. Use **Place pin** or **Move pin** on an element note and click the exact evidence artboard; use **Draw region** on a region note and drag both down-right and up-left. Verify that the preview follows the pointer, a tiny region drag does not commit, the persisted marker uses normalized coordinates on the selected screen, and Escape cancels without mutation. Also verify that lifecycle and anchor status remain separate, the inspector reports only recorded anchor signals, a connected signed live frame replaces element signals with the current role/name/locator/fingerprint, a missing bridge produces coordinate-only evidence, moving to a different screen clears stale element signals, the captured route image replaces generic placeholder content, the drifted count changes after re-anchoring, and two-step deletion returns to the notes index with a decremented count. `pnpm verify:studio-boards` performs the deterministic coordinate-only element-pin path on **Notes — Note detail** and records the final placement screenshot. `pnpm verify:studio-profiles` proves the semantic request/response path through two real signed iframe origins. In daemon mode, repeat one update while observing `resource.updated`, then confirm the matching coordinates and current semantic fields in both the Markdown frontmatter and `.topo/llm/records/note.jsonl` before treating persistence as verified.
