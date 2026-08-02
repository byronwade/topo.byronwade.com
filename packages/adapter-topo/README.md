# `@topo/adapter-topo`

Built-in component preview adapter for explicit colocated `.topo.tsx` variants and conservative zero-required-prop component exports. It emits exact source and export identities; rendering remains owned by `@topo/preview-runtime`.

## Discovery rules

- `components/X.topo.{js,jsx,ts,tsx}` pairs with `components/X.{js,jsx,ts,tsx}`.
- Zero-required-prop function/default exports and simple arrow exports in the colocated module become explicit variants at priority `200`.
- A component module becomes an automatic variant at priority `900` only when its default export or basename-matching export is constructible with zero required props.
- Required-prop components, metadata constants, unrelated exports, tests, stories, and preview files are never promoted automatically.
- Every emitted source carries a stable ID, exact POSIX path, source line, export name, locator, and runtime readiness/error selectors.

Lower source priorities win. Storybook uses `100`; unprioritized external adapters normalize to `500`.
