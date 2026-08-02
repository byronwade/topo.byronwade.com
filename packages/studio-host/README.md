# @topo/studio-host

Portable loopback host for the production Topo Studio bundle. It validates the
asset root, serves static files with containment and MIME checks, falls back to
the Studio index for client routes, injects the active daemon origin, and owns
deterministic startup and shutdown.

```ts
const studio = await startStudioHost({
  assetsDir: "apps/studio/dist",
  daemonUrl: "http://127.0.0.1:4599",
});

console.log(studio.url);
await studio.close();
```

The host accepts loopback addresses only. Application source discovery and
daemon routes remain outside this module.

## Build evidence

`inspectStudioBuild()` is the one deep artifact-inspection seam used by both
the source Studio build and the CLI-packaged Studio. It reads Vite's manifest,
measures the transitive initial JavaScript graph, verifies all built-in
destinations are reachable dynamic entries, and proves Pixi stays outside the
initial shell. Schema-version-3 evidence also requires the shared review
renderer and strict Studio validation to be reachable only through on-demand
chunks, so report generation or Zod parsing cannot silently return to the
startup graph.

```ts
const report = await inspectStudioBuild("apps/studio/dist");

if (report.status === "fail") {
  throw new Error(report.checks.map((check) => check.detail).join("\n"));
}
```

The returned value is stable JSON-safe evidence. Production builds write it as
`studio-build-report.json` beside the Studio bundle so people and LLM agents
can inspect the same loading contract.
