# `@topo/browser`

Playwright-backed browser sessions for local preview profiles, isolated cookies/local storage, and route screenshots. Browser launch is explicit and injectable through the preview options so tests and future adapters can use a controlled executable.

`captureRoute()` optionally accepts an adapter-owned readiness contract. It waits for `readySelector`, watches `errorSelector`, and throws the error element's visible text instead of persisting a blank or failed document as a successful PNG. This primitive is adapter-neutral; it does not know about Storybook, Topo, or any framework.
