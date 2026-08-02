# `@topo/preview-scaffold`

Safe, source-aware planning and creation of colocated `.topo.tsx` component previews. The module resolves one exact graph component, inspects its real Oxc export metadata, refuses escaping or linked source paths, never overwrites a target, and emits an immediately renderable preview only when the component has no required props. Required-prop components receive an honest fixture draft with no active preview export until a developer supplies deterministic local data.
