# `@topo/preview-adapter`

Versioned, adapter-neutral discovery and runtime URL resolution for component previews. Adapters receive an immutable source snapshot during discovery and explicit base URLs plus injected fetch during resolution. They return exact component/source identities and cannot depend on scanner internals.

`createComponentPreviewAdapterRegistry` validates adapter IDs, preview IDs, source containment, duplicate identities, and adapter-specific configuration before capture workers receive a URL.

Preview sources may declare a deterministic priority and optional `readySelector`, `errorSelector`, and timeout. The registry preserves this metadata; generic capture workers enforce it. Runtime ownership remains outside this SDK, allowing Storybook, Topo's built-in Vite host, and future systems to share one artifact path.
