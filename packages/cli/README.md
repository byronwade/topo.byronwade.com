# Topo CLI

Topo is a local-first, code-native application atlas for Next.js, TanStack, React, Vue, Nuxt, and Svelte applications. The CLI discovers the application graph, runs the native development server, starts the loopback daemon and production PixiJS Studio, captures evidence, stores Markdown notes and JSON flows, exports canonical reviews as Markdown, SARIF, or standalone HTML, and exposes canonical LLM context over MCP.

```powershell
pnpm dlx @topo/cli init
pnpm install
pnpm topo
```

`topo init --dry-run` prints every proposed path without writing. In a monorepo with multiple detected applications, pass `--app apps/web`. Applying a plan writes its reversible manifest last and prints the package-manager install command. `topo uninstall --dry-run` verifies every managed hash before showing the exact files it can restore or remove; non-empty note and flow directories are preserved.

`topo migrate --dry-run --json` previews registered project-metadata migrations. `pnpm dlx @topo/cli@latest update --dry-run --json` previews reconciliation to the running CLI version; applying it changes only tracked Topo package ownership and prints the install command without touching the lockfile.

The package is prepared and tested as a tarball in the source repository, but it is not published to npm yet. The release contract rejects private packages, internal or workspace runtime dependencies, build/version drift, non-public access, disabled provenance, and a release tag that differs from `v<package-version>`. CI installs and exercises the packed artifact; a published GitHub release can retain and publish that exact tarball through npm trusted publishing after npm ownership and the `publish.yml` trust relationship are configured. See the [repository](https://github.com/byronwade/topo.byronwade.com) for current source-preview instructions and documentation.

```powershell
topo export . --format markdown
topo export . --format sarif --snapshots --output artifacts/topo-review.sarif
topo export . --format html --include findings
topo doctor . --json
topo check . --json
topo check . --runtime --route /dashboard --profile Owner --fail-on low --json
topo cache inspect . --json
topo cache clean . --dry-run
topo adapters create . --kind framework --id acme.remix --name "Remix" --dry-run --json
topo adapters check . --id acme.remix --json
topo notes add . --id review:dashboard --title "Review dashboard" --route /dashboard --json
topo notes show . --id review:dashboard --json
topo notes update . --id review:dashboard --status resolved --json
topo notes remove . --id review:dashboard --json
```

`--include` accepts `all`, `findings`, or `notes`. `--snapshots` includes explicit snapshot artifact references and hashes; binary images are never embedded in review exports.

`topo doctor` emits the same versioned, sanitized readiness report consumed by the daemon, Studio, context files, and MCP. Its ten stable checks cover Node, the Playwright browser, loopback safety, preview reachability, explicit application-source selection, framework discovery, parameterized preview routes, source coverage, and preview-profile configuration without exposing profile credentials.

`topo check` emits a bounded schema-version-1 diagnostic report and exits non-zero when its explicit threshold is met. Static analysis is the default. `--runtime` adds the same destructive-action-safe Playwright probes used by Studio; `--route` limits the run to one canonical route and `--profile` selects a configured local preview profile. The default threshold is `low`; choose `info`, `low`, `medium`, `high`, or `none` with `--fail-on`. JSON includes findings and probe evidence but deliberately omits the complete graph.

`topo cache clean` owns only `.topo/cache`, never follows symlinks, and retains notes, flows, snapshots, component previews, state, installation metadata, and LLM exports. Use `--dry-run` to inspect the exact projected removal without writing.

`topo notes list|add|show|update|remove` operates on the authoritative versioned Markdown store. Add accepts deterministic namespaced IDs, update supports explicit target, route, and author clears, and every accepted mutation refreshes canonical LLM context before returning. Use `--json` for the complete accepted record or exact removal result. `topo notes export` remains the consolidated Markdown review alias.

`topo adapters create` emits a collision-safe, zero-dependency local adapter with a versioned manifest, executable Node test, and exact `topo.config.ts` registration guidance. Choose `framework`, `component-preview`, or `application-runtime`; existing targets are never overwritten. `topo adapters check` returns one versioned report covering manifest validity, module loading, exact identity, and the selected family contract against a safe empty context. It imports and executes local adapter modules, so use it only in repositories you trust. The command never starts the application or its development server. Valid manifests are available through context schema version 5 as bounded `adapter` records.
