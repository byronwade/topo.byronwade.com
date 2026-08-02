# @topo/local-runtime

`@topo/local-runtime` owns the complete local Topo process composition behind
one interface:

```ts
const runtime = await startTopoLocalRuntime({
  project,
  studioAssetsDir,
});

console.log(runtime.daemon.url, runtime.studio?.url);
await runtime.close();
```

It starts or reuses the native application, creates isolated preview-profile
gateways, starts the daemon, and serves the compiled Studio. Startup is
transactional and `close()` is idempotent. Signed launch capabilities remain
internal; callers receive only origins, profile names, and lifecycle evidence.

The CLI is a presentation adapter over this module. Browser verification uses
the same interface instead of recreating the startup sequence.
