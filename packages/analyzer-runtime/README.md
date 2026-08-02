# `@topo/analyzer-runtime`

Isolated Playwright runtime probes for safe controls. Every control produces a versioned `InteractionProbeArtifact` with stable route/control identity, an accessible locator, timestamp, typed effects, evidence, and one of `effect-observed`, `possibly-inert`, `skipped`, or `activation-error`.

The worker recognizes navigation, network, DOM/accessibility, dialog, form, download, meaningful focus, storage, preview-bridge event, and runtime-error effects. Ordinary focus landing on the clicked control is ignored. Disabled, hidden, explicitly skipped, destructive, and implicit non-GET form controls are classified before activation and never clicked. No-effect controls become probabilistic findings rather than automatic breakage claims.
