import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildStudioShowcase } from "@topo/showcase-builder";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const result = await buildStudioShowcase({
  sourceDir: path.join(repositoryRoot, "apps/studio/dist"),
  outputDir: path.join(repositoryRoot, "apps/web/public/_topo-studio"),
  basePath: "/_topo-studio",
  routeBase: "/demo-studio",
});

process.stdout.write(
  `Prepared ${result.manifest.summary.fileCount} verified Studio showcase files.\n`,
);
