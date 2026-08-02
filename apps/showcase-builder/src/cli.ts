import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildStudioShowcase } from "./index.js";

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const result = await buildStudioShowcase({
  sourceDir:
    readOption("--source") ?? path.join(repositoryRoot, "apps/studio/dist"),
  outputDir:
    readOption("--output") ??
    path.join(repositoryRoot, "apps/showcase-builder/dist/site"),
  basePath: readOption("--base-path") ?? "/_topo-studio",
  routeBase: readOption("--route-base") ?? "/demo-studio",
});

process.stdout.write(
  `${JSON.stringify(
    {
      status: result.manifest.status,
      outputDir: result.outputDir,
      manifestPath: result.manifestPath,
      files: result.manifest.summary.fileCount,
      bytes: result.manifest.summary.bytes,
    },
    null,
    2,
  )}\n`,
);
