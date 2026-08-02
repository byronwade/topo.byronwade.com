# @topo/preview-runtime

Loopback-only React preview host for Topo's built-in component preview adapter.

## Machine-readable contract

- Input: a project root plus an exact workspace-relative source path and export name.
- Authority: source files in the project; this package does not generate or persist source modules.
- Output: a capability-scoped local URL whose document reports `loading`, `ready`, or `error` through `data-topo-preview-status`.
- Security boundary: loopback binding, per-process high-entropy path, strict source containment, and a closed extension allow-list.
- Lifecycle owner: the Topo daemon starts one runtime lazily and closes it with the daemon.

This package renders standalone component previews only. Framework route behavior remains owned by native application development servers and framework adapters.
