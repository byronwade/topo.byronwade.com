# `@topo/workspace`

Workspace inspection and extension composition root. The scanner remains adapter-agnostic; this package combines built-in and project-installed framework adapters and component-preview adapters through separate typed registries. `scanWorkspace(sourceRoot, { adapterRootDir: projectRoot })` keeps the immutable source snapshot separate from the directory that owns installed extension modules.
