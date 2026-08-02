# Durable Note Lifecycle and Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Studio's fabricated note-detail state with a complete local-first note lifecycle whose Markdown, anchor evidence, daemon API, UI, and LLM/MCP projections agree.

**Architecture:** `.topo/notes/*.md` remains authoritative. `@topo/notes` owns the version-1 schema, backward-compatible Markdown codec, atomic store, and anchor-signal semantics; the daemon exposes validated CRUD and publishes resource invalidations; Studio applies optimistic local updates and renders only evidence present in each note. LLM context embeds the complete note and makes lifecycle and anchor evidence searchable without introducing another datastore.

**Tech Stack:** TypeScript, Zod, Node filesystem/HTTP/SSE, React 19, Vitest, Markdown with YAML frontmatter.

## Global Constraints

- The application repository and `.topo/notes/*.md` are the only note source of truth.
- Existing version-1 notes without lifecycle or anchor fields must continue to load as open, unbound notes.
- Missing anchor signals must render as missing; Studio must never synthesize role, locator, fingerprint, coordinates, or match counts.
- Note writes must be atomic and root-contained.
- Every note mutation must refresh deterministic `.topo/llm` output.
- The current workspace has no Git repository; do not initialize one or add commit steps as part of this feature.

---

### Task 1: Versioned note lifecycle and anchor contract

**Files:**
- Modify: `packages/notes/package.json`
- Modify: `packages/notes/src/index.ts`
- Test: `packages/notes/src/index.test.ts`

**Interfaces:**
- Produces: `NoteStatusSchema`, `NoteAnchorSchema`, `NoteRecordSchema`, `WriteNoteInputSchema`, `UpdateNoteInputSchema`, `countNoteAnchorSignals(anchor)`, and `NoteStore.update(id, patch)`.
- Preserves: `createNoteStore`, `renderNoteMarkdown`, `parseNoteMarkdown`, and version `1` compatibility.

- [ ] **Step 1: Write failing codec tests**

Add tests that parse an old version-1 note as `{ status: "open" }`, round-trip a resolved note with author and all six anchor signal families, and reject malformed inline anchor JSON.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm.cmd --filter @topo/notes test`

Expected: FAIL because lifecycle schemas and anchor fields do not exist.

- [ ] **Step 3: Implement the schema and Markdown codec**

Define strict Zod schemas for status (`open | resolved`) and anchor status (`unbound | attached | drifted | orphaned`). Store the anchor as one JSON-compatible inline YAML scalar:

```markdown
status: open
author: "local"
anchor: {"status":"attached","source":{"filePath":"app/page.tsx","line":41},"role":"heading","accessibleName":"Welcome","testLocator":"hero-headline","domFingerprint":"a91c","coordinates":{"x":0.12,"y":0.2,"width":0.4,"height":0.1},"verifiedAt":"2026-08-01T00:00:00.000Z"}
```

Default absent `status` to `open`; leave absent `anchor` undefined.

- [ ] **Step 4: Write failing store mutation tests**

Add tests proving `update` preserves `createdAt`, changes `updatedAt`, can resolve and re-anchor a note, returns `undefined` for an unknown id, and writes no temporary file after completion.

- [ ] **Step 5: Run the focused test and verify RED**

Run: `pnpm.cmd --filter @topo/notes test`

Expected: FAIL because `NoteStore.update` and atomic writes are absent.

- [ ] **Step 6: Implement atomic create/update/delete behavior**

Write to `<id>.md.<uuid>.tmp`, then rename to `<id>.md`. Validate ids before path construction. Make `remove` return `true` only when a note existed.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `pnpm.cmd --filter @topo/notes test && pnpm.cmd --filter @topo/notes typecheck`

Expected: all note tests pass and TypeScript exits `0`.

### Task 2: Validated daemon CRUD and resource invalidation

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/daemon/src/index.ts`
- Test: `packages/protocol/src/index.test.ts`
- Test: `packages/daemon/src/index.test.ts`

**Interfaces:**
- Produces: `ResourceEventSchema` for `resource.updated` events with `resource: "notes" | "flows"`.
- Produces: `GET/PATCH/DELETE /notes/:id`; retains `GET/POST /notes`.

- [ ] **Step 1: Write failing protocol and daemon tests**

Test create → get → patch title/body/status/anchor → list → delete → 404. Assert invalid ids and malformed anchors return `400`, missing notes return `404`, and `Access-Control-Allow-Methods` includes `PATCH, DELETE`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm.cmd --filter @topo/protocol test && pnpm.cmd --filter @topo/daemon test`

Expected: FAIL because resource events and item routes do not exist.

- [ ] **Step 3: Implement item routes and context refresh**

Parse request bodies with the note package schemas, return validated notes, call `syncContext()` after every successful mutation, and publish `resource.updated` after the durable write succeeds.

- [ ] **Step 4: Make direct Markdown edits observable**

Keep generated `.topo` paths ignored, but debounce `.topo/notes/*.md` and `.topo/flows/*.json` changes into context refresh plus `resource.updated`. Do not trigger a graph rescan for note-only edits.

- [ ] **Step 5: Run focused tests and typechecks**

Run: `pnpm.cmd --filter @topo/protocol test && pnpm.cmd --filter @topo/daemon test && pnpm.cmd --filter @topo/protocol typecheck && pnpm.cmd --filter @topo/daemon typecheck`

Expected: all focused tasks pass.

### Task 3: LLM-readable lifecycle and anchor evidence

**Files:**
- Modify: `packages/llm-context/src/index.ts`
- Test: `packages/llm-context/src/index.test.ts`
- Modify: `packages/mcp/src/evaluation-fixture.ts`
- Test: `packages/mcp/src/index.test.ts`

**Interfaces:**
- Consumes: complete `NoteRecord` from Task 1.
- Produces: searchable note lifecycle, author, anchor status, exact signal values, and route/entity relationships in canonical records and generic MCP context queries.

- [ ] **Step 1: Write failing LLM/MCP tests**

Create a resolved drifted note with a test locator and DOM fingerprint. Query `resolved drifted hero-headline` and assert the note record is returned with complete data and route/screen relationships.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm.cmd --filter @topo/llm-context test && pnpm.cmd --filter @topo/mcp test`

Expected: FAIL because lifecycle and anchor values are absent from searchable text/summary.

- [ ] **Step 3: Project complete evidence**

Include status and anchor status in the summary; include author and serialized anchor values in `text`; retain the exact validated note in `data`.

- [ ] **Step 4: Run focused tests and typechecks**

Run: `pnpm.cmd --filter @topo/llm-context test && pnpm.cmd --filter @topo/mcp test && pnpm.cmd --filter @topo/llm-context typecheck && pnpm.cmd --filter @topo/mcp typecheck`

Expected: all focused tasks pass.

### Task 4: Functional Studio note detail board

**Files:**
- Modify: `apps/studio/src/studio-model.ts`
- Modify: `apps/studio/src/studio-model.test.ts`
- Modify: `apps/studio/src/useTopoData.ts`
- Modify: `apps/studio/src/App.tsx`
- Modify: `apps/studio/src/components/NotesWorkspace.tsx`
- Modify: `apps/studio/src/styles.css`

**Interfaces:**
- Produces: `updateNote(id, patch)` and `deleteNote(id)` from `useTopoData`.
- Produces: Notes detail actions for save, resolve/reopen, attach to selected screen source, and delete.

- [ ] **Step 1: Write failing Studio model tests**

Test signal counting, display rows for missing evidence, lifecycle filtering, and source-only re-anchor payload generation.

- [ ] **Step 2: Run Studio tests and verify RED**

Run: `pnpm.cmd --filter @topo/studio test`

Expected: FAIL because the model helpers and durable lifecycle fields do not exist.

- [ ] **Step 3: Implement optimistic note mutations**

Update local React state synchronously, send `PATCH`/`DELETE`, replace optimistic data with the daemon result, and roll back on rejection. Listen for `resource.updated` and re-hydrate notes/flows after external file changes.

- [ ] **Step 4: Replace fabricated detail values**

Render editable title/body, real status/author/timestamps, and six anchor signal rows from the selected note. Missing values must say `Not recorded`. Calculate the match count from present signals. Re-anchor only writes the selected screen source identity and reports `1 of 6 recorded` unless additional evidence already exists.

- [ ] **Step 5: Wire lifecycle actions**

Resolve toggles `open ↔ resolved`; delete requires confirmation; creating from the annotation palette navigates to the new note detail. Disable mutation buttons while a note action is in flight.

- [ ] **Step 6: Run Studio tests, typecheck, and build**

Run: `pnpm.cmd --filter @topo/studio test && pnpm.cmd --filter @topo/studio typecheck && pnpm.cmd --filter @topo/studio build`

Expected: all Studio checks pass.

### Task 5: Documentation, full gates, and browser evidence

**Files:**
- Modify: `README.md`
- Modify: `docs/features.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/LLM_INTERFACE.md`
- Modify: `docs/product.json`
- Modify: `packages/notes/README.md`
- Modify: `packages/daemon/README.md`
- Create: `artifacts/studio-verification/durable-note-lifecycle.png`

**Interfaces:**
- Documents: lifecycle fields, anchor authority, API routes, direct-file invalidation, and LLM projection.

- [ ] **Step 1: Update canonical documentation and ledger evidence**

Record the feature change with `docs:record`; keep `markdown-notes` status evidence-scoped to implemented behavior.

- [ ] **Step 2: Run repository gates**

Run: `pnpm.cmd docs:check`, `pnpm.cmd typecheck`, `pnpm.cmd test`, and `pnpm.cmd build`.

Expected: every command exits `0` with no failed task.

- [ ] **Step 3: Verify the connected browser workflow**

Create a note, edit title/body, attach it to the selected screen, resolve it, reload Studio, and verify the values persist. Confirm the Markdown file and `.topo/llm/records/note.jsonl` contain the same lifecycle and anchor evidence. Save the final detail board screenshot.

- [ ] **Step 4: Self-review against the plan**

Confirm every checkbox has current evidence; leave the broader Topo goal active because this plan closes only the durable note lifecycle slice.
