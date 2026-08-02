# `@topo/exporter`

One deterministic interface for Markdown, SARIF 2.1.0, and self-contained HTML
review artifacts:

```ts
const artifact = exportReview(
  { graph, notes, snapshots },
  { format: "sarif", include: "all", attachSnapshots: true },
);
```

The result includes `body`, `fileName`, and `mimeType`. Snapshot binaries are
never embedded; optional snapshot evidence contains explicit local references.
