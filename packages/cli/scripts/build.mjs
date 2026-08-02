import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const executeFile = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const distRoot = path.join(packageRoot, "dist");
const studioRoot = path.join(repositoryRoot, "apps", "studio");
const studioOutput = path.join(distRoot, "studio");
const require = createRequire(import.meta.url);
const cliEntryPath = path.join(packageRoot, "src", "index.ts");
const nodeExternals = [
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
  "@vitejs/plugin-react",
  "jiti",
  "oxc-parser",
  "playwright",
  "pngjs",
  "vite",
  "ws",
  "yaml",
  "zod",
];

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

await esbuild({
  entryPoints: [cliEntryPath],
  outfile: path.join(distRoot, "cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  legalComments: "eof",
  external: nodeExternals,
});

const cliSource = await readFile(cliEntryPath, "utf8");
const usageMatch = cliSource.match(
  /function usage\(\): void \{\s*console\.log\(\s*`([\s\S]*?)`\s*,?\s*\);\s*\}/u,
);
if (!usageMatch?.[1]) {
  throw new Error("Unable to extract the canonical Topo CLI help text");
}
await esbuild({
  stdin: {
    contents: `#!/usr/bin/env node
const command = process.argv[2] ?? "help";
if (command === "help" || command === "--help" || command === "-h") {
  console.log(${JSON.stringify(usageMatch[1])});
} else {
  await import(new URL("./cli.js", import.meta.url).href);
}
`,
    loader: "js",
    resolveDir: packageRoot,
    sourcefile: "bootstrap.js",
  },
  outfile: path.join(distRoot, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  legalComments: "eof",
});

await viteBuild({
  root: studioRoot,
  configFile: path.join(studioRoot, "vite.config.ts"),
  build: {
    outDir: studioOutput,
    emptyOutDir: true,
  },
});
await executeFile(process.execPath, [
  path.join(studioRoot, "scripts", "check-build.mjs"),
  studioOutput,
]);

const typescriptCli = require.resolve("typescript/bin/tsc");
await executeFile(process.execPath, [
  typescriptCli,
  "-p",
  path.join(packageRoot, "tsconfig.build.json"),
  "--emitDeclarationOnly",
]);

await cp(path.join(repositoryRoot, "LICENSE"), path.join(distRoot, "LICENSE"));

const packageManifest = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);
await writeFile(
  path.join(distRoot, "build.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      package: packageManifest.name,
      version: packageManifest.version,
      entry: "index.js",
      studio: "studio/index.html",
      bundledInternalPackages: true,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
