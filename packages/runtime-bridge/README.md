# `@topo/runtime-bridge`

Framework-neutral preview instrumentation for signed local application frames.

The package exposes three deliberately small interfaces:

- `createPreviewBridgeScript()` produces a self-contained browser bootstrap for gateway injection. It keeps at most 200 sanitized navigation, network, DOM, and error events and answers semantic anchor inspections only for its exact loopback parent.
- `subscribePreviewEvents()` correlates one exact frame window and loopback origin, receives the current bounded snapshot plus future events, supports explicit refresh after a frame reload, and closes with an unsubscribe.
- `inspectPreviewAnchor()` sends a normalized point to one exact frame origin and returns bounded role, accessible-name, test-locator, and DOM-fingerprint evidence. Source window, origin, version, and request ID must all match; unavailable bridges resolve to `undefined` after a bounded timeout.

The generated source contains no profile values, capabilities, credentials, or environment configuration. Runtime events are transient observation state; only semantic evidence deliberately persisted into an ordinary note becomes part of Topo's LLM-readable record model.
