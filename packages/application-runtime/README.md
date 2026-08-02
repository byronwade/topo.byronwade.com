# @topo/application-runtime

Framework-neutral lifecycle module for the inspected application's native
development server. It reuses a healthy configured origin or resolves one
runtime adapter, starts the native package script, waits for HTTP readiness,
retains bounded output evidence, reports unexpected exits, and deterministically
stops only the process tree it owns.

```ts
const runtime = await startApplicationRuntime({
  rootDir: "apps/web",
  adapterRootDir: ".",
  baseUrl: "http://localhost:3000",
});

console.log(runtime.ownership, runtime.adapterId);
await runtime.close();
```

Next.js, TanStack, Nuxt, Vite, and generic `dev` package scripts are built in.
The Vite adapter covers ordinary React, Vue, and SvelteKit projects while Nuxt
retains its native CLI argument contract. A project-installed adapter can add
another framework without changing the CLI or lifecycle implementation.
Automatic process startup is limited to HTTP loopback origins; remote origins
are reuse-only.

`resolveApplicationRuntimeAdapter(context, adapters)` exposes the same
validation and deterministic selection path without starting a process. Topo's
local adapter conformance check uses this narrower interface; successful
resolution is contract evidence, not proof that the command can start the real
application.
