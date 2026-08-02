# Standalone Component Preview Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make colocated `.topo.tsx` previews and safe zero-required-prop component exports discoverable, executable, capturable, and inspectable without Storybook.

**Architecture:** Add a built-in `topo` component-preview adapter beside the existing Storybook adapter. It emits exact, versioned preview-source records; a separate loopback-only Vite runtime renders those records behind a per-process capability URL. The daemon starts that runtime lazily only when a selected capture needs it, then reuses the existing Playwright, artifact, Studio, LLM-context, and MCP paths.

**Tech Stack:** Node.js 24, TypeScript, pnpm/Turbo, Zod, Vitest, Vite, React 19, Playwright, existing Topo preview-adapter and artifact contracts.

## Global Constraints

- The application repository remains authoritative; generated PNGs and state remain under `.topo/`.
- Framework route adapters and component preview adapters remain separate extension families.
- Binary image bytes never enter the normalized application graph.
- Preview runtime binds to loopback, uses an unguessable per-process URL prefix, and rejects source paths outside the project/workspace allow-list.
- Storybook remains first priority, followed by explicit `.topo.tsx` previews, followed by safe zero-required-prop exports.
- A component is `renderable` only when at least one exact `previewSources` record exists.
- Preview readiness and runtime errors are explicit evidence; capture must not silently persist a blank success image.
- The repository has no `.git` directory, so each task records a verification checkpoint instead of a commit.
- Every new behavior follows red → observed failure → minimal implementation → green.

---

### Task 1: Built-in Topo preview discovery adapter

**Files:**

- Create: `packages/adapter-topo/package.json`
- Create: `packages/adapter-topo/tsconfig.json`
- Create: `packages/adapter-topo/README.md`
- Create: `packages/adapter-topo/src/index.ts`
- Create: `packages/adapter-topo/src/index.test.ts`
- Modify: `packages/workspace/package.json`
- Modify: `packages/workspace/src/index.ts`
- Modify: `packages/workspace/src/index.test.ts`
- Modify: `packages/scanner/src/index.ts`
- Modify: `packages/scanner/src/index.test.ts`

**Interfaces:**

- Consumes: `ComponentPreviewAdapter`, `FrameworkAdapterContext`, and `parseModule(source, filePath)`.
- Produces: `topoComponentPreviewAdapter` with adapter ID `topo` and exact `ComponentPreviewSource` records.

- [ ] **Step 1: Write failing adapter tests**

```ts
expect(result.previews.map((item) => item.preview)).toEqual([
  expect.objectContaining({
    id: "topo:components/StatusCard.topo.tsx#Routes",
    adapterId: "topo",
    exportName: "Routes",
    source: { filePath: "components/StatusCard.topo.tsx", line: 3 },
  }),
  expect.objectContaining({
    id: "topo:components/HealthBadge.tsx#HealthBadge",
    adapterId: "topo",
    exportName: "HealthBadge",
  }),
]);
```

The fixture must also contain a required-prop component and a non-component exported constant; neither may become a safe automatic preview.

- [ ] **Step 2: Run the adapter test and observe RED**

Run: `pnpm.cmd --filter @topo/adapter-topo test`

Expected: failure because the package/export does not exist.

- [ ] **Step 3: Implement exact discovery**

```ts
export const TOPO_COMPONENT_PREVIEW_ADAPTER_ID = "topo" as const;

export const topoComponentPreviewAdapter = defineComponentPreviewAdapter({
  apiVersion: COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  id: TOPO_COMPONENT_PREVIEW_ADAPTER_ID,
  displayName: "Topo previews",
  async scan(context) {
    return { previews: await discoverTopoComponentPreviews(context) };
  },
  resolveCaptureUrl(preview, { baseUrl }) {
    const url = new URL("preview", baseUrl);
    url.searchParams.set("source", preview.source.filePath);
    url.searchParams.set("export", preview.exportName ?? "default");
    return url.toString();
  },
});
```

Discovery rules:

1. Pair `components/X.topo.tsx` with `components/X.tsx`.
2. Emit zero-required-prop function/default exports from the preview module in source order.
3. Emit a safe direct preview only for a zero-required-prop function/default export from the component module.
4. Explicit previews precede automatic direct previews.
5. Every preview has a stable ID, exact source line, export name, locator, and runtime-readiness selectors.

- [ ] **Step 4: Remove scanner heuristics**

Replace `hasStory`, `hasPreview`, and string-matched `hasZeroRequiredProps` classification with:

```ts
previewStatus: previewSources.length > 0 ? "renderable" : "missing";
```

This makes adapters the sole authority for executable component coverage.

- [ ] **Step 5: Register the adapter after Storybook**

```ts
export const builtInComponentPreviewAdapters = Object.freeze([
  storybookComponentPreviewAdapter,
  topoComponentPreviewAdapter,
]);
```

- [ ] **Step 6: Run focused tests and record GREEN checkpoint**

Run:

```powershell
pnpm.cmd --filter @topo/adapter-topo test
pnpm.cmd --filter @topo/scanner test
pnpm.cmd --filter @topo/workspace test
```

Expected: all focused tests pass, and every `renderable` component has at least one source record.

---

### Task 2: Generic capture readiness contract

**Files:**

- Modify: `packages/schema/src/index.ts`
- Modify: `packages/schema/src/index.test.ts`
- Modify: `packages/browser/src/index.ts`
- Create: `packages/browser/src/index.test.ts`
- Modify: `packages/snapshots/src/index.ts`
- Modify: `packages/snapshots/src/index.test.ts`

**Interfaces:**

- Consumes: adapter-owned preview metadata.
- Produces: optional `readiness` metadata and Playwright behavior that distinguishes ready/error/timeout.

- [ ] **Step 1: Write failing schema and browser integration tests**

```ts
readiness: {
  readySelector: 'html[data-topo-preview-status="ready"]',
  errorSelector: 'html[data-topo-preview-status="error"]',
  timeoutMs: 10_000,
}
```

The browser test starts a tiny local HTTP server. One route changes from `loading` to `ready`; another changes to `error` with text. Assert capture waits for ready and rejects the error route with the visible message.

- [ ] **Step 2: Run schema/browser tests and observe RED**

Run:

```powershell
pnpm.cmd --filter @topo/schema test
pnpm.cmd --filter @topo/browser test
```

Expected: schema rejects `readiness`, and browser capture does not wait or reject.

- [ ] **Step 3: Add the optional source contract**

```ts
const PreviewReadinessSchema = z.object({
  readySelector: z.string().min(1),
  errorSelector: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
});
```

- [ ] **Step 4: Implement readiness-aware capture**

```ts
export interface CaptureReadiness {
  readySelector: string;
  errorSelector?: string;
  timeoutMs?: number;
}

export interface CaptureRouteOptions extends PreviewSessionOptions {
  routePath: string;
  readiness?: CaptureReadiness;
}
```

After navigation, wait until the ready selector or error selector exists. If error wins, read its text and throw an actionable error. If neither appears before timeout, let Playwright's timeout identify the missing selector.

- [ ] **Step 5: Forward adapter readiness from component capture**

```ts
await capture({
  baseUrl: parsedUrl.origin,
  routePath: parsedUrl.toString(),
  readiness: preview.readiness,
  waitUntil: "networkidle",
  fullPage: false,
});
```

- [ ] **Step 6: Run focused tests and record GREEN checkpoint**

Run:

```powershell
pnpm.cmd --filter @topo/schema test
pnpm.cmd --filter @topo/browser test
pnpm.cmd --filter @topo/snapshots test
```

Expected: readiness metadata round-trips, ready capture succeeds, error capture fails with evidence, and existing adapters remain compatible.

---

### Task 3: Signed loopback Vite preview runtime

**Files:**

- Create: `packages/preview-runtime/package.json`
- Create: `packages/preview-runtime/tsconfig.json`
- Create: `packages/preview-runtime/README.md`
- Create: `packages/preview-runtime/src/index.ts`
- Create: `packages/preview-runtime/src/index.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: project root plus exact source path/export query generated by the built-in adapter.
- Produces:

```ts
export interface TopoPreviewRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export function startTopoPreviewRuntime(options: {
  rootDir: string;
  host?: string;
  port?: number;
  token?: string;
}): Promise<TopoPreviewRuntime>;
```

- [ ] **Step 1: Write failing runtime contract tests**

Tests must prove:

- non-loopback hosts are rejected;
- `port: 0` returns the actual bound loopback origin;
- the base URL includes a high-entropy capability segment;
- source traversal outside the workspace returns 400;
- a valid preview document reaches `data-topo-preview-status="ready"` in Chromium;
- a missing export reaches `data-topo-preview-status="error"` with an actionable message.

- [ ] **Step 2: Run runtime tests and observe RED**

Run: `pnpm.cmd --filter @topo/preview-runtime test`

Expected: failure because the runtime package does not exist.

- [ ] **Step 3: Implement the Vite host**

`startTopoPreviewRuntime` binds before it resolves, reads the actual address from Vite's HTTP server, and only then constructs the immutable `baseUrl`.

Use `createServer` with:

```ts
{
  root: absoluteRoot,
  base: capabilityPath,
  appType: "custom",
  configFile: false,
  plugins: [react({ fastRefresh: false }), topoPreviewPlugin(...)],
  server: {
    host: "127.0.0.1",
    port: options.port ?? 0,
    strictPort: Boolean(options.port),
    hmr: false,
    cors: false,
    fs: { strict: true, allow: [absoluteRoot, searchForWorkspaceRoot(absoluteRoot)] },
  },
}
```

The custom HTML route is `<capability>/preview?source=...&export=...`. The virtual entry dynamically imports the exact module, selects `default` or the named export, renders React elements/components, and sets `loading`, `ready`, or `error` on the document element. An error panel must contain source, export, and error text so Playwright and humans receive evidence.

- [ ] **Step 4: Add root and extension validation**

Only `.js`, `.jsx`, `.ts`, `.tsx`, and `.mdx` files inside the resolved workspace allow-list may be imported. Normalize Windows paths before generating `/@fs/` module IDs.

- [ ] **Step 5: Run focused runtime tests and record GREEN checkpoint**

Run: `pnpm.cmd --filter @topo/preview-runtime test`

Expected: all loopback, containment, ready, and error tests pass using a real browser.

---

### Task 4: Lazy daemon lifecycle and real capture endpoint

**Files:**

- Modify: `packages/daemon/package.json`
- Modify: `packages/daemon/src/index.ts`
- Modify: `packages/daemon/src/index.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**

- Consumes: built-in adapter ID `topo`, selected graph preview sources, and `startTopoPreviewRuntime`.
- Produces: lazy local runtime startup, actual-origin injection, and deterministic shutdown.

- [ ] **Step 1: Write failing daemon integration test**

Create a temporary Next fixture beneath `apps/playground-next-app` so React resolves from the existing package installation. Include `Button.tsx`, `Button.topo.tsx`, and `app/page.tsx`. Start the daemon on port 0, POST the selected component to `/capture/components`, and assert:

```ts
expect(result.failures).toEqual([]);
expect(result.artifacts).toEqual([
  expect.objectContaining({
    adapterId: "topo",
    status: "captured",
    width: 1440,
  }),
]);
```

Then fetch the returned artifact URL and verify the PNG signature. Close the daemon and prove the preview runtime no longer accepts connections.

- [ ] **Step 2: Run daemon test and observe RED**

Run: `pnpm.cmd --filter @topo/daemon test`

Expected: graph has no Topo preview source or capture cannot resolve a `topo` base URL.

- [ ] **Step 3: Implement lazy runtime startup**

Before the capture job:

```ts
const needsTopoRuntime = selectedComponents.some((component) =>
  component.previewSources.some(
    (preview) => preview.adapterId === TOPO_COMPONENT_PREVIEW_ADAPTER_ID,
  ),
);
const runtime = needsTopoRuntime ? await ensureTopoPreviewRuntime() : undefined;
const baseUrls = {
  ...config.preview.componentBaseUrls,
  ...(runtime ? { topo: runtime.baseUrl } : {}),
};
```

Do not start Vite for Storybook-only capture. Cache one runtime per daemon and close it before the daemon HTTP server resolves `close()`.

- [ ] **Step 4: Keep generated config honest**

Update the CLI template comments to explain that Topo's built-in preview runtime is daemon-managed and does not require a fixed port. `componentBaseUrls` remains for external adapters such as Storybook.

- [ ] **Step 5: Run focused daemon/CLI tests and record GREEN checkpoint**

Run:

```powershell
pnpm.cmd --filter @topo/daemon test
pnpm.cmd --filter @topo/cli test
```

Expected: real local component capture passes, artifact bytes are readable, and shutdown releases both servers.

---

### Task 5: Permanent playground and Studio evidence

**Files:**

- Create: `apps/playground-next-app/components/StatusCard.topo.tsx`
- Create: `apps/playground-next-app/components/HealthBadge.tsx`
- Modify: `apps/playground-next-app/app/page.tsx`
- Modify: `apps/playground-next-app/app/globals.css`
- Modify: `apps/studio/src/studio-model.ts`
- Modify: `apps/studio/src/studio-model.test.ts`

**Interfaces:**

- Consumes: built-in Topo adapter and existing Studio artifact rendering.
- Produces: one explicit multi-variant preview and one automatic zero-prop preview in the real playground.

- [ ] **Step 1: Write failing fixture/model tests**

The workspace scan test must find `Routes`, `States`, and `HealthBadge` Topo preview sources. The Studio model test must stop hard-coding every demo variant as Storybook and include at least one `topo` source/artifact.

- [ ] **Step 2: Observe RED**

Run:

```powershell
pnpm.cmd --filter @topo/workspace test
pnpm.cmd --filter @topo/studio test
```

- [ ] **Step 3: Add explicit and automatic fixtures**

```tsx
// StatusCard.topo.tsx
import "../app/globals.css";
import { StatusCard } from "./StatusCard";

export function Routes() {
  return <StatusCard label="Routes" value="5" detail="App Router screens" />;
}

export function States() {
  return (
    <StatusCard label="States" value="3" detail="default, loading, not-found" />
  );
}
```

`HealthBadge.tsx` exports `function HealthBadge()` with no props and is used by the playground home page.

- [ ] **Step 4: Run focused fixture/Studio tests and record GREEN checkpoint**

Expected: graph source priority is Storybook → explicit Topo → automatic Topo, and Studio displays adapter/status without special-casing.

---

### Task 6: LLM-readable docs and complete verification

**Files:**

- Modify: `docs/features.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/LLM_INTERFACE.md`
- Modify: `docs/SCAFFOLD_MATRIX.md`
- Modify: `docs/product.json`
- Modify: `docs/product-changes.json` via `pnpm docs:record`
- Modify: `docs/CHANGELOG.md` via governance generation
- Modify: package READMEs for adapter/runtime/browser/capture boundaries

**Interfaces:**

- Consumes: verified implementation behavior.
- Produces: canonical documentation and append-only feature fingerprints.

- [ ] **Step 1: Update canonical behavior docs**

Document:

- exact `.topo.tsx` export contract;
- safe automatic export criteria;
- source priority;
- loopback capability URL and root containment;
- lazy Vite lifecycle;
- readiness/error evidence;
- unchanged `component-preview` LLM and MCP artifact records.

- [ ] **Step 2: Record changed feature fingerprints**

Run:

```powershell
pnpm.cmd docs:record -- --id 2026-08-01-standalone-component-preview-runtime --feature application-atlas,screen-capture,llm-context,local-mcp,storybook-ingestion --type changed --summary "Standalone Topo component preview runtime and evidence capture"
```

- [ ] **Step 3: Format only touched files**

Run Prettier against the exact files changed by Tasks 1–6.

- [ ] **Step 4: Run focused proof**

Run all package tests changed by this plan and use a browser to capture the real playground `StatusCard` preview. Save the screenshot under `artifacts/studio-verification/standalone-component-preview.png`.

- [ ] **Step 5: Run full repository gates**

```powershell
pnpm.cmd docs:check
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd build
```

Expected:

- documentation reports synchronized;
- Turbo test and typecheck tasks have zero failures;
- all production packages build;
- browser proof shows ready status, non-empty component pixels, zero page errors, and an artifact PNG served through the daemon.

- [ ] **Step 6: Self-review residual scope**

Confirm no claim exceeds evidence. Explicit configuration-entry previews and accepted AI-generated stubs remain separate future sources unless implemented by another adapter; this plan does not invent them.
