# `@topo/snapshots`

Capture orchestration for route screenshots and component preview variants. Route PNGs live under `.topo/snapshots`; component PNGs live under `.topo/previews`. Both retain content hashes and durable metadata, while each component variant records its preview adapter, source identity, dimensions, timestamp, and independent success or failure.

Component capture remains runtime-neutral: the preview registry resolves a URL, the preview source contributes optional readiness/error selectors, and `@topo/browser` supplies isolated Playwright evidence. Failures are recorded per variant without aborting the batch. Binary pixels stay outside the normalized application graph.
