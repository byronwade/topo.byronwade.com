# `@topo/project-lifecycle`

Safe project evolution after `topo init`. The package owns immutable migration
and update plans, stale-input checks, registered manifest transitions,
package-manager handoffs, and transactional application. It never executes a
package manager or edits a lockfile.

```ts
const migration = await planProjectMigration({ projectRoot });
if (migration.status === "ready") await applyProjectMigration(migration);

const update = await planProjectUpdate({
  projectRoot,
  targetVersion: "0.2.0",
});
if (update.status === "ready") await applyProjectUpdate(update);
```

Update planning preserves unrelated `package.json` fields and refreshes a
reversible uninstall baseline containing those project-owned changes. Unknown
manifest versions, missing ownership, duplicate package declarations, and
project-owned `topo` scripts fail closed.
