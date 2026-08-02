import type { BenchmarkReport } from "./index.js";
import type { BrowserBenchmarkReport } from "./browser-contract.js";

function milliseconds(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function mebibytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function isBrowserBenchmarkReport(
  report: BenchmarkReport | BrowserBenchmarkReport,
): report is BrowserBenchmarkReport {
  return "browserName" in report.runtime;
}

export function renderBenchmarkMarkdown(
  report: BenchmarkReport | BrowserBenchmarkReport,
): string {
  const browserReport = isBrowserBenchmarkReport(report);
  const profileDescription = browserReport
    ? `${report.profile.spriteCount.toLocaleString("en-US")} sprites, ${report.profile.textureCount.toLocaleString("en-US")} textures, ${report.profile.cameraFrames.toLocaleString("en-US")} camera frames, ${report.profile.liveFrameCount.toLocaleString("en-US")} live frames`
    : `${report.profile.routeCount.toLocaleString("en-US")} routes, ${report.profile.componentCount.toLocaleString("en-US")} components, ${report.profile.flowCount.toLocaleString("en-US")} flows`;
  const runtimeDescription = browserReport
    ? `${report.runtime.browserName} ${report.runtime.browserVersion} · ${report.runtime.renderer} · ${report.runtime.webglVersion}`
    : `${report.runtime.nodeVersion} · ${report.runtime.platform}/${report.runtime.architecture} · ${report.runtime.cpuModel} (${report.runtime.cpuCount} logical CPUs)`;
  const samplingDescription =
    "settings" in report
      ? `${report.settings.iterations} measured after ${report.settings.warmupIterations} warmup iteration(s). Budgets apply to p95.`
      : "Each browser workload retains its raw measured samples. Budgets apply to p95.";
  const heapDescription =
    browserReport && report.runtime.jsHeapBeforeBytes !== undefined
      ? [
          `${mebibytes(report.runtime.jsHeapBeforeBytes)} before`,
          ...(report.runtime.jsHeapWorkingBytes === undefined
            ? []
            : [
                `${mebibytes(report.runtime.jsHeapWorkingBytes)} working (${report.runtime.jsHeapWorkingDeltaBytes === undefined ? "delta unavailable" : `${report.runtime.jsHeapWorkingDeltaBytes >= 0 ? "+" : ""}${mebibytes(report.runtime.jsHeapWorkingDeltaBytes)}`})`,
              ]),
          ...(report.runtime.jsHeapRetainedBytes === undefined
            ? []
            : [
                `${mebibytes(report.runtime.jsHeapRetainedBytes)} retained after ${report.runtime.jsHeapCollection ?? "unavailable collection"} (${report.runtime.jsHeapRetainedDeltaBytes === undefined ? "delta unavailable" : `${report.runtime.jsHeapRetainedDeltaBytes >= 0 ? "+" : ""}${mebibytes(report.runtime.jsHeapRetainedDeltaBytes)}`})`,
              ]),
        ].join(" · ")
      : undefined;
  const lines = [
    "# Topo benchmark report",
    "",
    `Status: **${report.status.toUpperCase()}**`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Profile: \`${report.profile.id}\` (${profileDescription})`,
    "",
    `Runtime: ${runtimeDescription}`,
    "",
    ...(heapDescription ? [`Heap: ${heapDescription}`, ""] : []),
    `Samples: ${samplingDescription}`,
    "",
    "| Workload | Status | Median | p95 | Budget |",
    "| --- | --- | ---: | ---: | ---: |",
    ...report.results.map((result) => {
      const status =
        result.status === "fail" && "enforced" in result && !result.enforced
          ? "FAIL (INFO)"
          : result.status.toUpperCase();
      return `| ${result.title} | ${status} | ${milliseconds(result.medianMs)} | ${milliseconds(result.p95Ms)} | ${milliseconds(result.budgetMs)} |`;
    }),
    "",
    "## Workloads",
    "",
  ];

  for (const result of report.results) {
    lines.push(
      `### ${result.title}`,
      "",
      result.description,
      "",
      "```json",
      JSON.stringify(result.workload, null, 2),
      "```",
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
