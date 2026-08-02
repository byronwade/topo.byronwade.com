# `@topo/adapter-scaffold`

Collision-safe planning, generation, inspection, and conformance verification
for local Topo adapter workspaces. The package owns versioned manifests,
zero-dependency ESM templates, and one versioned report across the framework,
component-preview, and application-runtime contracts; the CLI owns argument
parsing and presentation.

`verifyAdapterScaffolds(projectRoot, { id })` checks manifest validity, module
loading, exact manifest-to-module identity, and the selected adapter family's
public contract against an empty read-only context. It does not start an
application or development server. It does import and execute local adapter
modules, so callers must trust the repository being checked.
