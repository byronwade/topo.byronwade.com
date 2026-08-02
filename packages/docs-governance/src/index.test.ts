import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { featureFingerprint, validateDocumentation } from "./index.js";
import { validateAutomationWorkflows } from "./workflow-contract.js";

describe("documentation governance", () => {
  it("fingerprints feature content deterministically", () => {
    const feature = {
      id: "atlas",
      title: "Atlas",
      summary: "See routes.",
      category: "Understand",
      status: "available" as const,
      updatedAt: "2026-07-31",
      docs: ["docs/features.md#application-atlas"],
      evidence: ["apps/studio/src/App.tsx"],
    };
    expect(featureFingerprint(feature)).toBe(
      featureFingerprint({ ...feature }),
    );
  });

  it("validates the repository documentation contract", async () => {
    const report = await validateDocumentation(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("validates executable CI and trusted-publishing workflow contracts", async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    expect(await validateAutomationWorkflows(root)).toEqual([]);
  });
});
