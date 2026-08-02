# Runtime Interaction Probe Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Topo's isolated interaction probes safe, route-scoped, durable, LLM-readable, and visible as real evidence in the Studio Probe destination.

**Architecture:** The runtime analyzer owns browser observation and emits a versioned `InteractionProbeArtifact` for every activated, skipped, inert, or failed control. Diagnostics coordinates route runs; storage atomically replaces the latest artifacts for only the routes that were actually probed; the daemon exposes those artifacts and persists findings; the canonical LLM context projects them as first-class records. Studio requests one selected route, hydrates the durable artifacts, and renders their typed effects instead of a hard-coded mock.

**Tech Stack:** Node.js 24, TypeScript, Zod, Vitest, Playwright, React 19, existing Topo daemon/storage/LLM-context contracts.

## Global Constraints

- Application source remains the only source of truth; probes never modify source files.
- Runtime probing stays opt-in and runs only inside an isolated local Playwright context.
- Disabled, hidden, explicitly skipped, and destructive controls are never activated.
- Findings say `possibly inert`; Topo never declares a control broken automatically.
- Every durable probe result must have a stable ID, route, locator, status, typed effects, evidence, and timestamp.
- Existing static-only Doctor behavior remains available and does not erase runtime artifacts.
- Old version-1 `.topo/state.json` files must rehydrate with an empty probe-artifact collection.

---

### Task 1: Version the durable probe artifact

**Files:**

- Modify: `packages/schema/src/index.ts`
- Modify: `packages/schema/src/index.test.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/src/index.test.ts`

**Interfaces:**

- Produces: `RuntimeEffect`, `InteractionProbeArtifact`, and `replaceInteractionProbes(routePaths, artifacts)`.
- Consumes: existing atomic version-1 project state.

- [ ] **Step 1: Write failing schema and storage tests**

Assert that an artifact with `status: "possibly-inert"`, a stable locator, typed effects, safety evidence, and an ISO timestamp parses. Assert that replacing route `/settings` removes only previous `/settings` artifacts while preserving `/dashboard` artifacts, and that old state without `interactionProbes` rehydrates to `[]`.

- [ ] **Step 2: Run RED**

```powershell
pnpm.cmd --filter @topo/schema test
pnpm.cmd --filter @topo/storage test
```

- [ ] **Step 3: Add the contracts**

```ts
type RuntimeEffectKind =
  | "navigation"
  | "network"
  | "dom"
  | "dialog"
  | "form-submit"
  | "download"
  | "focus"
  | "storage"
  | "app-event"
  | "runtime-error";

interface InteractionProbeArtifact {
  version: 1;
  id: string;
  routePath: string;
  screenId?: string;
  control: {
    index: number;
    id: string;
    label: string;
    tagName: string;
    role: string;
    locator: string;
  };
  status: "effect-observed" | "possibly-inert" | "skipped" | "activation-error";
  effects: Array<{ kind: RuntimeEffectKind; summary: string }>;
  evidence: string[];
  observedAt: string;
  error?: string;
}
```

Persist the collection additively and implement route-scoped replacement through the existing serialized atomic write queue.

- [ ] **Step 4: Run GREEN**

Run both focused test commands and expect zero failures.

---

### Task 2: Observe controls safely and comprehensively

**Files:**

- Modify: `packages/analyzer-runtime/src/index.ts`
- Modify: `packages/analyzer-runtime/src/index.test.ts`
- Modify: `packages/analyzer-runtime/package.json`

**Interfaces:**

- Consumes: `InteractionProbeArtifact` and `openPreview`.
- Produces: `probeRoute(options): Promise<{ observations: InteractionProbeArtifact[]; findings: Finding[] }>`.

- [ ] **Step 1: Write failing policy and real-browser tests**

Use a loopback HTML fixture containing an inert button, a safe button that changes DOM/storage/focus and emits a `window.__TOPO__` event, a dialog button, and a destructive button. Assert typed effects, a durable inert finding, dialog dismissal, and skipped destructive evidence.

- [ ] **Step 2: Run RED**

```powershell
pnpm.cmd --filter @topo/analyzer-runtime test
```

- [ ] **Step 3: Implement observation instrumentation**

For each control, reload the route, derive a deterministic control identity and locator, and inspect label, role, href, form action/method, visibility, disabled state, and `data-topo-probe`. Install temporary form and mutation observers, subscribe to Playwright request/dialog/download/pageerror events, compare URL, DOM/accessibility, focus, local/session storage, and preview-bridge events, then classify one durable artifact.

Never click a control when it is disabled, hidden, explicitly marked `data-topo-probe="skip"`, lexically destructive, or submits a non-GET form without `data-topo-probe="safe"`.

- [ ] **Step 4: Run GREEN**

Run the focused analyzer test and expect the browser fixture to close with zero leaked processes.

---

### Task 3: Persist and serve route-scoped probe runs

**Files:**

- Modify: `packages/diagnostics/src/index.ts`
- Modify: `packages/diagnostics/src/index.test.ts`
- Modify: `packages/daemon/src/index.ts`
- Modify: `packages/daemon/src/index.test.ts`

**Interfaces:**

- Consumes: analyzer artifacts and project-state replacement.
- Produces: `GET /interaction-probes?routePath=/...` and route-validated `POST /diagnostics` runtime results.

- [ ] **Step 1: Write failing coordination and daemon tests**

Inject a probe function into diagnostics to prove per-route continuation after one route fails and deterministic finding replacement. In daemon integration, assert unknown routes return `400`, a selected route run persists artifacts, and `GET /interaction-probes` filters by exact route.

- [ ] **Step 2: Run RED**

```powershell
pnpm.cmd --filter @topo/diagnostics test
pnpm.cmd --filter @topo/daemon test
```

- [ ] **Step 3: Implement route-scoped coordination**

Validate requested routes against discovered default screens. Catch route-level browser failures as `activation-error` artifacts so one route cannot discard the rest of a run. Reconcile generated static and runtime findings by stable ID, removing stale generated findings for only the scope rerun. Persist probe artifacts before refreshing canonical context.

- [ ] **Step 4: Run GREEN**

Run both focused package tests and expect zero failures.

---

### Task 4: Add probe artifacts to the canonical LLM read model

**Files:**

- Modify: `packages/llm-context/src/index.ts`
- Modify: `packages/llm-context/src/index.test.ts`
- Modify: `packages/mcp/src/evaluation-fixture.ts`
- Modify: `docs/LLM_INTERFACE.md`

**Interfaces:**

- Consumes: `ProjectState.interactionProbes`.
- Produces: `interaction-probe` context records and normal MCP bounded-query access.

- [ ] **Step 1: Write failing context test**

Assert that skipped, effect-observed, inert, and error artifacts retain complete structured data, route relationships, searchable labels/effects/evidence, and deterministic JSONL output.

- [ ] **Step 2: Run RED**

```powershell
pnpm.cmd --filter @topo/llm-context test
pnpm.cmd --filter @topo/mcp test
```

- [ ] **Step 3: Project the new record kind**

Add `interaction-probe` to the context kind enum/schema and create one record per durable artifact. Relate it to the matching screen when available and preserve the whole artifact in `data`.

- [ ] **Step 4: Run GREEN**

Run both focused tests and expect zero failures.

---

### Task 5: Drive the Studio Probe board with real data

**Files:**

- Modify: `apps/studio/src/studio-model.ts`
- Modify: `apps/studio/src/studio-model.test.ts`
- Modify: `apps/studio/src/useTopoData.ts`
- Modify: `apps/studio/src/App.tsx`
- Modify: `apps/studio/src/components/AtlasWorkspace.tsx`
- Modify: `apps/studio/src/styles.css`

**Interfaces:**

- Consumes: `GET /interaction-probes` and `POST /diagnostics { runtime: true, routes: [routePath] }`.
- Produces: selected-route Probe UI with typed effect state, evidence, safety skips, busy/error state, and deterministic demo fixtures.

- [ ] **Step 1: Write failing Studio model tests**

Assert demo probe artifacts cover `possibly-inert`, `effect-observed`, and `skipped`, and that the view-model selects the current route's inert result before other statuses.

- [ ] **Step 2: Run RED**

```powershell
pnpm.cmd --filter @topo/studio test
```

- [ ] **Step 3: Implement Studio hydration and rendering**

Hydrate probe artifacts beside the graph and captures. Give `runChecks` explicit `{ runtime, routes }` options and use the `probe` busy action for runtime runs. Pass the selected route and current artifacts to `ProbeView`; render its real target, status, effect chips, evidence, skipped count, and re-run state. Keep the website demo deterministic and network-free.

- [ ] **Step 4: Run GREEN**

Run Studio tests and typecheck.

---

### Task 6: Governance, browser proof, and full verification

**Files:**

- Modify: `docs/features.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/verification.md`
- Modify: `docs/product.json`
- Modify: package READMEs affected above
- Modify: `docs/product-changes.json` through `pnpm docs:record`

**Interfaces:**

- Consumes: verified implementation behavior.
- Produces: synchronized source-of-truth documentation and browser evidence.

- [ ] **Step 1: Update canonical docs and status**

Document safety policy, typed effect coverage, route-scoped persistence, Studio behavior, and `interaction-probe` LLM records. Promote `interaction-diagnostics` from Preview to Available only if the real browser and full gates pass.

- [ ] **Step 2: Record the feature change**

```powershell
pnpm.cmd docs:record -- --id 2026-08-01-runtime-interaction-probe-evidence --feature interaction-diagnostics,llm-context,local-mcp,application-atlas --type changed --summary "Durable route-scoped interaction probe evidence in Studio and LLM context"
```

- [ ] **Step 3: Capture browser evidence**

Run the playground, daemon, and Studio; re-run `/` from the Probe destination; verify structured artifacts through the daemon; save `artifacts/studio-verification/runtime-interaction-probe.png`; report browser errors separately.

- [ ] **Step 4: Run complete gates**

```powershell
pnpm.cmd docs:check
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd build
```

Expected: documentation synchronized, all tests/typechecks/builds green, the real browser fixture proves safety/effect observation, and Studio renders durable route evidence rather than hard-coded content.
