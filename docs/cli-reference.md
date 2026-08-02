---
title: "CLI reference"
description: "Current Topo commands, outputs, and local safety behavior."
public: true
order: 30
updated: 2026-08-02
---

# CLI reference

The source-preview CLI runs from `packages/cli/dist/index.js` after `pnpm build`.

| Command                       | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `topo init [path]`            | Detect a project and create reversible local configuration   |
| `topo uninstall [path]`       | Restore an unchanged manifest-backed Topo installation       |
| `topo scan [path]`            | Discover routes, states, components, and graph relationships |
| `topo doctor [path]`          | Emit canonical environment and application-readiness checks  |
| `topo check [path]`           | Run static or isolated runtime diagnostics as a quality gate |
| `topo dev [path]`             | Start/reuse the native app, daemon, watcher, and Studio      |
| `topo gateway [path]`         | Start the signed loopback preview gateway                    |
| `topo capture [path]`         | Capture discovered screens with Playwright                   |
| `topo export [path]`          | Write Markdown, SARIF, or standalone HTML review evidence    |
| `topo context export [path]`  | Write the LLM manifest, schema, Markdown, and JSONL records  |
| `topo context query [path]`   | Search bounded context records by text, kind, or route       |
| `topo cache inspect [path]`   | Report typed derived-cache usage and top-level entries       |
| `topo cache clean [path]`     | Clean only contained `.topo/cache` working data              |
| `topo adapters create [path]` | Scaffold a local framework, preview, or runtime adapter      |
| `topo adapters check [path]`  | Verify local adapter manifests, identity, and contracts      |
| `topo notes <command> [path]` | Create, inspect, update, remove, or export Markdown notes    |
| `topo flows <command> [path]` | Create, inspect, apply, update, or remove versioned flows    |
| `topo mcp [path]`             | Serve read-only project context over MCP stdio               |

## Structured output

Use `--json` for machine-readable output. Context queries accept `--query`, `--kind`, `--route`, `--limit`, and `--offset`. Lists are capped so agents do not need to load an entire application graph for one answer.

## Diagnostic quality gate

`topo check [path]` defaults to static analysis and a `low` failure threshold. It exits `1` when an open finding meets that threshold and otherwise exits `0`. Select `--fail-on info|low|medium|high|none` explicitly in CI; `none` keeps every observation visible without turning it into a failing policy decision.

Add `--runtime` only when the configured native preview server is reachable. With no route filter, Topo probes every default screen independently. `--route /canonical/path` limits the run to one route, and `--profile Name` applies one configured preview profile without writing its cookies, headers, local storage, or capability to the report. A requested activation error is blocking whenever failure policy is enabled, while destructive and unsafe controls remain recorded as skipped.

`--json` returns the schema-version-1 report: project/source identity, mode, policy, pass/fail decision, bounded summary counts, findings, and complete interaction-probe artifacts. It deliberately omits the normalized graph; durable findings and probe artifacts remain available through canonical context files, queries, daemon APIs, and MCP.

## Project setup

`topo init --dry-run` detects the package manager, monorepo applications, frameworks, Storybook, Playwright, fixtures, and mocks, then returns every proposed operation without writing. Use `--app apps/web` when more than one application is detected. `--no-package` creates only Topo's project records; `--package-spec <spec>` overrides the planned `@topo/cli` dependency for local tarballs or prereleases.

A normal apply creates `topo.config.ts`, committable `.topo/notes`, `.topo/flows`, `.topo/fixtures`, and `.topo/metadata` directories, a derived-artifact ignore block, and a v3 `.topo/install.json`. If package installation is enabled, it also stages the `topo` script and CLI dev dependency, then prints the exact package-manager install command. It does not silently rewrite the lockfile.

`topo uninstall --dry-run` hash-checks every managed file. Any drift blocks the entire operation. A clean uninstall restores prior file contents, removes unchanged generated files, and removes only empty initializer-created directories. It never deletes user-authored notes or flows.

`topo migrate [path] --dry-run --json` inspects `.topo/install.json`, returns its current and target schema versions plus every registered step, and writes nothing. Omit `--dry-run` to apply a ready plan after rechecking the source hash. Version 2 migrates to version 3; malformed and unregistered versions remain explicit conflicts.

Run the newest CLI as `pnpm dlx @topo/cli@latest update [path] --dry-run --json` to preview project reconciliation to that CLI version. Omit `--dry-run` to update only the tracked `@topo/cli` dependency and `.topo/install.json`, then run the printed package-manager install command. `--version <semver>` and `--package-spec <spec>` support prerelease or local distribution workflows. Topo preserves unrelated package fields, refuses a project-owned `topo` script, records a safe uninstall baseline, and never mutates a lockfile itself.

## Adapter scaffolding

`topo adapters create [path] --kind <kind> --id <id> --name <label>` creates a local `framework`, `component-preview`, or `application-runtime` adapter. The default directory is `topo/adapters/<id-with-dashes>`; `--output` accepts another one-level `topo/adapters/<directory>` catalog path so agent discovery remains complete. `--dry-run --json` returns versioned identity, exact create operations and byte counts, registration guidance, and conflicts without including generated source bodies or writing files. A non-dry JSON create emits one `created` result with the exact created paths after the atomic write succeeds. Missing values, duplicates, unknown options, extra positionals, traversal, linked ancestors, and existing targets fail closed.

Topo refuses invalid IDs, absolute or traversing paths, and any existing output directory. A successful apply creates `adapter.json`, `index.mjs`, `index.test.mjs`, and `README.md` as one staged directory. It prints the exact `extensions` config key and module specifier to register. The generated module intentionally reports no match until edited; run its `node --test` file and then `topo scan --json` or `topo doctor --json`. `topo context query --kind adapter --json` exposes the manifest through context schema version 7.

`topo adapters check [path] [--id <id>] [--json]` discovers all local adapter manifests or selects one exact ID. Its schema-version-1 report checks each manifest, imports its module, requires exact ID and display-name agreement, and executes the framework, component-preview, or process-free application-runtime contract against an empty read-only context. Malformed manifests, missing IDs, import failures, identity drift, and contract violations produce explicit issues and a non-zero exit. The command does not launch an application or development server, but imported adapter modules are executable local code and must be trusted. A pass is a baseline contract result, not real-project behavior proof.

## Parameterized routes

Add one concrete local browser path for each discovered parameterized route under `preview.routes` in `topo.config.ts`. `topo scan` prints `canonical -> concrete` for configured routes and `[needs preview route]` for unresolved patterns. JSON output preserves the versioned `previewRoute` object. Capture, live frames, and runtime diagnostics use the concrete path without changing the canonical route used by filters, notes, flows, findings, and LLM queries.

Origins, hashes, and destinations that still contain Next.js or TanStack parameters are rejected. Query strings are allowed. `topo doctor` reports unresolved canonical routes under `application.preview-routes`; this is an actionable warning rather than an attempt to guess fixture data.

## Flow authoring

`topo flows list [path]` reports every valid flow plus malformed-source issues. `topo flows show [path] --id <id>` prints one complete versioned record. `topo flows add` remains the compact one-step path with `--title`, `--description`, `--route`, `--action`, and `--expected`.

Use `topo flows apply [path] --file <flow.json>` for a complete branching definition. Topo validates the same flow schema used by Studio and the daemon, preserves an existing record's creation identity, atomically replaces its JSON source, refreshes LLM context, and rejects dangling entry or next-step IDs. `topo flows update [path] --id <id>` patches `--title`, `--description`, `--status`, `--entry-step`, `--clear-entry`, or comma-delimited `--tags` without replacing steps. `topo flows remove [path] --id <id>` removes only that encoded identity. Add `--json` to every mutation for agent-readable output.

Studio uses the same records through an inspect-first flow rail. Definition and selected-step editors open only when requested; the compact state retains source identity, route-resolution coverage, the first break, selected-step evidence, and an ordered step navigator. This disclosure changes no CLI or JSON shape, and canceling an editor does not write a partial record.

## Note authoring

`topo notes list [path]` returns notes in newest-update order, while `topo notes show [path] --id <id>` reads one complete record. `topo notes add` requires `--title` and accepts a deterministic `--id`, `--body`, `--type`, `--status open|resolved`, `--author`, canonical `--route`, and an explicit `--target-kind` plus `--target-id`. Invalid enum values and incomplete targets fail before a file is written.

`topo notes update [path] --id <id>` patches only supplied fields. Use `--clear-target`, `--clear-route`, or `--clear-author` for deliberate nullable clears; conflicting set-and-clear options are rejected. `topo notes remove [path] --id <id>` removes only that percent-encoded identity. Add, update, and remove persist through the authoritative atomic Markdown store and regenerate canonical LLM context before success is printed. `--json` returns the accepted record or exact removal result for agent workflows. `topo notes export` remains the consolidated Markdown review alias.

Studio is a presentation adapter over those same records. Its index can search the currently selected lifecycle or anchor facet across human note content and structured anchor evidence; detail opens in read mode, moves between stable note identities, and exposes editing or deletion only after an explicit action. None of those local presentation states creates a second note store or changes CLI behavior.

## Cache management

`topo cache inspect [path]` reports the resolved project and cache roots, aggregate bytes and entry counts, and deterministic top-level entry summaries. Add `--json` for the versioned protocol object.

`topo cache clean [path] --dry-run` returns the exact projected removal without writing. Omitting `--dry-run` removes only children of `<projectRoot>/.topo/cache` and leaves the empty cache root ready for reuse. The command does not follow symlinks and never owns `.topo/notes`, `.topo/flows`, `.topo/snapshots`, `.topo/previews`, `.topo/llm`, `.topo/install.json`, or `.topo/state.json`.

## Preview profiles

Use `--profile <name>` when capturing with a configured local profile. For a loopback application, `topo dev` automatically creates one signed, cookie-isolated origin per configured profile. Studio Settings selects the active profile used by live frames, captures, component captures, and runtime diagnostics. Topo forwards only values configured for that signed local environment; the first-navigation capability is transient and never written to project records or logs. Eligible live HTML receives the framework-neutral preview bridge only after the signed gateway session is accepted; unsupported responses remain untouched, and no separate command or application hook is required.

Required-prop components can enter coverage through `preview.components` without a custom adapter. Key the object by component source path and provide a source-root-relative wrapper `source`, `exportName`, and optional `title`, `readiness`, or `provenance: "ai-accepted"`. One object or an array of variants is accepted. `scan`, `dev`, component capture, Studio, context export, and MCP all consume the same normalized entries and retain their discovery provenance.

## Doctor report

`topo doctor` runs the same bounded report used by the daemon and Studio. It checks Node.js 24+, the exact configured or Playwright-managed Chromium executable, loopback daemon binding, preview-origin safety and reachability, application-source selection, framework discovery, normalized source coverage, parameterized preview routes, and preview-profile names. An unscoped project root that yields multiple framework families receives the `application.source-selection` warning and exact remediation to select one `rootDir`. Warnings provide an action without failing the process; security, framework, and runtime-version errors set a non-zero exit code. `--json` returns the complete schema-versioned report with stable check IDs and sanitized evidence.

Studio groups those unchanged records by their canonical environment, security, and application scopes. Browser remediation controls copy the report's exact action text but never execute it. Source findings remain a separate complete application group and carry a stable `finding` query identity into the evidence view and across reloads.

## Review export

`topo export` defaults to `TOPO_REVIEW.md` in the project root. Select another deterministic artifact with `--format markdown|sarif|html`, limit review records with `--include all|findings|notes`, retain non-binary capture evidence with `--snapshots`, or choose an exact destination with `--output <path>`. `--json` reports the absolute output, MIME type, byte count, inclusion mode, and snapshot-reference count. `topo notes export` remains a compatible alias whose default format is Markdown.

## Local runtime orchestration

`topo dev` delegates complete composition to one transactional local-runtime handle: native application, profile gateway, daemon, and compiled Studio. A healthy application is reused. Otherwise `auto` mode resolves the highest-confidence application runtime adapter, starts the existing package `dev` script, waits for an HTTP response, and owns that process tree until shutdown. `external` mode never starts a process; `managed` mode refuses an already-occupied origin. `preview.server.command` is a non-empty token array, `preview.server.cwd` is relative to the configured application root, and `preview.server.readyTimeoutMs` is bounded from 1 to 300 seconds. Startup failures roll back earlier stages; one idempotent close owns normal and failure shutdown.

Every command resolves the target directory as `projectRoot` and `config.rootDir` as `sourceRoot`. Configuration, adapters, and the sole durable `.topo` tree belong to `projectRoot`; scanning, diagnostics, preview construction, and application commands use `sourceRoot`. `rootDir` may be a relative, linked, or absolute filesystem directory, but its resolved target must exist and be a directory before Topo starts work. Selecting application source outside the project does not move write authority: notes, flows, state, captures, cache, lifecycle records, and LLM exports remain under `projectRoot`. `topo doctor` prints both roots and reports ambiguous mixed-framework root selection so ownership is inspectable rather than implicit.

## Local Studio runtime

The command accepts `--no-app`, `--preview-port <number>`, `--studio-port <number>`, `--studio-dir <path>`, and `--no-studio`. `--preview-port` temporarily replaces the port in configured `preview.baseUrl` without editing the project and is accepted only for loopback HTTP origins. Port 4173 is preferred; an occupied default falls back to an ephemeral loopback port, while an occupied explicitly requested port fails instead of silently changing the contract. `TOPO_STUDIO_DIR` is the environment-level asset override. The native Next.js or TanStack server remains the application runtime; Topo only manages its lifecycle and never recreates router, loader, server-component, middleware, or CSS behavior.

Studio validates the graph and every collection response against the shared runtime contracts before the data enters React or Pixi state. Note and flow collection envelopes include malformed-source issues; invalid mutation responses do not replace optimistic state. A malformed graph keeps Studio offline with zero project entities.

Installed projects customize the shell through the `studio` object in `topo.config.ts`. A destination needs only a keyed loopback `url`; optional labels and paths refine it. `remove.destinations` and `remove.commands` subtract built-ins, while a command needs only a destination ID in `to` and an optional `view`. The normalized manifest is available from daemon `GET /studio` and the canonical project context. See [Studio extensions](./STUDIO_EXTENSIONS.md) for the complete minimal example and safety boundary.

## Safety behavior

- The daemon and gateway bind to loopback by default; every profile uses a separate loopback host so browser cookies cannot cross profiles.
- The production Studio host accepts loopback binds only, contains every resolved asset inside its validated root, and applies a strict CSP containing only the exact runtime profile origins.
- Automatic application startup accepts unavailable loopback HTTP origins only. Remote and HTTPS origins must already be running.
- `topo dev` may execute the inspected repository's existing `dev` script. Other read-only commands do not start application code.
- `init` keeps an existing configuration, fails closed on conflicting package scripts or manifests, and rolls back a failed apply.
- `uninstall` changes nothing when a managed file has drifted and removes only empty initializer-created directories.
- Scanning does not write application source.
- Runtime diagnostics skip controls classified as destructive.
- MCP tools are read-only and closed-world.
