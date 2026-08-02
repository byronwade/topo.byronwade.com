import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { startTopoPreviewRuntime } from "../packages/preview-runtime/dist/index.js";

const [rootDir, source, exportName, readyFile] = process.argv.slice(2);

if (!rootDir || !source || !exportName) {
  throw new Error(
    "Usage: node scripts/serve-standalone-preview.mjs <root> <source> <export> [ready-file]",
  );
}

const runtime = await startTopoPreviewRuntime({ rootDir });
const previewUrl = new URL("preview", runtime.baseUrl);
previewUrl.searchParams.set("source", source);
previewUrl.searchParams.set("export", exportName);

if (readyFile) {
  const absoluteReadyFile = path.resolve(readyFile);
  await mkdir(path.dirname(absoluteReadyFile), { recursive: true });
  await writeFile(
    absoluteReadyFile,
    `${JSON.stringify({ previewUrl: previewUrl.toString() })}\n`,
    "utf8",
  );
}

process.stdout.write(`${previewUrl.toString()}\n`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await runtime.close();
  process.exit(0);
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await new Promise(() => undefined);
