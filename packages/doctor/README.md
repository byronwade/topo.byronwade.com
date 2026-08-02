# `@topo/doctor`

Produces Topo's canonical, versioned environment and application-readiness report. Callers provide one resolved project and normalized graph; the module owns check policy, sanitization, summaries, remediation text, and runtime probing behind one `runDoctor()` interface.

The default probe inspects the configured Chromium executable and performs one bounded request to the native preview origin. The pure source-selection check compares resolved project/source roots with exact graph framework families so a monorepo root cannot silently become one mixed atlas. Tests inject a complete probe function rather than mocking individual filesystem or network calls.
