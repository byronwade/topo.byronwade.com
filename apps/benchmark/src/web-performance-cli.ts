import { promises as fs } from "node:fs";
import path from "node:path";

import { runWebPerformance } from "./web-performance.js";

function value(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

const args = process.argv.slice(2);
const url = value(args, "--url");
const output = value(args, "--output");
const iterationsValue = value(args, "--iterations");
if (!url || !output) {
  throw new Error(
    "Usage: web-performance-cli --url <url> --output <report.json> [--iterations <count>] [--check]",
  );
}
const iterations =
  iterationsValue === undefined ? undefined : Number(iterationsValue);
const report = await runWebPerformance(url, { iterations });
const outputPath = path.resolve(output);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `Topo web performance ${report.status.toUpperCase()} · ${outputPath}\n`,
);
if (args.includes("--check") && report.status === "fail") process.exitCode = 1;
