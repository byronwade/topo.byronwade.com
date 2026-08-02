# `@topo/initializer`

Read-only project detection plus transactional installation and hash-verified uninstall for Topo. Planning returns every proposed path and never writes. Applying a ready plan creates one version-3 `.topo/install.json`; uninstall restores only files that still match the recorded installation result.

```ts
const plan = await planInitialization({
  projectRoot,
  application: "apps/web",
});

if (plan.status === "ready") await applyInitialization(plan);
```

The complete public surface is four operations: `planInitialization`,
`applyInitialization`, `planUninstall`, and `applyUninstall`. The module owns
detection, exact file operations, hashes, rollback, and manifest compatibility;
the CLI owns only flags and presentation.

Post-install schema migration and package-version reconciliation live in
`@topo/project-lifecycle`, keeping upgrade policy out of both initializer and CLI.
