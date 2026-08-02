import { BENCHMARK_PROFILES, type BenchmarkProfileName } from "./index.js";

export type BenchmarkCliFormat = "json" | "markdown";

export interface BenchmarkCliOptions {
  browser: boolean;
  profile: BenchmarkProfileName;
  iterations: number;
  warmupIterations: number;
  format: BenchmarkCliFormat;
  outputPath?: string;
  baselinePath?: string;
  comparisonOutputPath?: string;
  requireImprovement: boolean;
  check: boolean;
  help: boolean;
}

function requiredValue(args: readonly string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Benchmark option "${args[index]}" requires a value`);
  }
  return value;
}

function integerValue(
  value: string,
  option: string,
  allowZero: boolean,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(
      `${option} must be ${allowZero ? "a non-negative" : "a positive"} integer`,
    );
  }
  return parsed;
}

export function parseBenchmarkCliArgs(
  args: readonly string[],
): BenchmarkCliOptions {
  const options: BenchmarkCliOptions = {
    browser: false,
    profile: "standard",
    iterations: 21,
    warmupIterations: 2,
    format: "markdown",
    requireImprovement: true,
    check: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--browser") {
      options.browser = true;
      continue;
    }
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--allow-stable") {
      options.requireImprovement = false;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--profile") {
      const value = requiredValue(args, index);
      if (!(value in BENCHMARK_PROFILES)) {
        throw new Error(`Unknown benchmark profile "${value}"`);
      }
      options.profile = value as BenchmarkProfileName;
      index += 1;
      continue;
    }
    if (argument === "--iterations") {
      options.iterations = integerValue(
        requiredValue(args, index),
        argument,
        false,
      );
      index += 1;
      continue;
    }
    if (argument === "--warmup") {
      options.warmupIterations = integerValue(
        requiredValue(args, index),
        argument,
        true,
      );
      index += 1;
      continue;
    }
    if (argument === "--format") {
      const value = requiredValue(args, index);
      if (value !== "json" && value !== "markdown") {
        throw new Error(`Unknown benchmark format "${value}"`);
      }
      options.format = value;
      index += 1;
      continue;
    }
    if (argument === "--output") {
      options.outputPath = requiredValue(args, index);
      index += 1;
      continue;
    }
    if (argument === "--baseline") {
      options.baselinePath = requiredValue(args, index);
      index += 1;
      continue;
    }
    if (argument === "--comparison-output") {
      options.comparisonOutputPath = requiredValue(args, index);
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark option "${argument}"`);
  }

  if (options.baselinePath && !options.outputPath) {
    throw new Error(
      "--baseline requires --output so candidate evidence is retained",
    );
  }
  if (options.comparisonOutputPath && !options.baselinePath) {
    throw new Error("--comparison-output requires --baseline");
  }

  return options;
}
