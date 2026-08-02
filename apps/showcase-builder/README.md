# Topo showcase builder

`@topo/showcase-builder` turns the production Studio bundle into a validated,
same-origin public demo artifact. It is intentionally exposed through one deep
interface:

```ts
import { buildStudioShowcase } from "@topo/showcase-builder";

await buildStudioShowcase({
  sourceDir: "apps/studio/dist",
  outputDir: "apps/web/public/_topo-studio",
  basePath: "/_topo-studio",
  routeBase: "/demo-studio",
});
```

The builder validates the Studio performance report, rejects filesystem links
and path escapes, rebases root asset references, removes the local daemon URL
placeholder, and emits `showcase-manifest.json` with hashes for every copied
file. Existing output is replaced only when it contains a manifest owned by
this builder.
