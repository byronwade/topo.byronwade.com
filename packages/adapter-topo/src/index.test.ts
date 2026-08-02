import { describe, expect, it } from "vitest";

import {
  createTopoComponentPreviewAdapter,
  topoComponentPreviewAdapter,
} from "./index.js";

const sourceByPath = {
  "components/StatusCard.tsx":
    "export function StatusCard({ label }: { label: string }) { return <article>{label}</article>; }\n",
  "components/StatusCard.topo.tsx": [
    'import { StatusCard } from "./StatusCard";',
    'export function Routes() { return <StatusCard label="Routes" />; }',
    'export function States() { return <StatusCard label="States" />; }',
    'export const metadata = { title: "not a preview" };',
  ].join("\n"),
  "components/HealthBadge.tsx":
    "export function HealthBadge() { return <span>Healthy</span>; }\n",
  "components/RequiredCard.tsx":
    "export function RequiredCard({ value }: { value: string }) { return <span>{value}</span>; }\n",
  "previews/Cards.preview.tsx": [
    'import { RequiredCard } from "../components/RequiredCard";',
    'export function ConfiguredRequired() { return <RequiredCard value="Configured" />; }',
    "export function AcceptedHealth() { return <span>Accepted</span>; }",
  ].join("\n"),
};

function context() {
  return {
    rootDir: "C:/fixture",
    files: Object.keys(sourceByPath).map((filePath) => ({
      filePath,
      extension: ".tsx",
    })),
    packageNames: new Set(["react"]),
    readFile: async (filePath: string) =>
      sourceByPath[filePath as keyof typeof sourceByPath],
  };
}

describe("Topo component preview adapter", () => {
  it("discovers explicit variants before safe zero-required-prop exports", async () => {
    const result = await topoComponentPreviewAdapter.scan(context());

    expect(result.previews).toEqual([
      {
        componentFilePath: "components/StatusCard.tsx",
        preview: expect.objectContaining({
          id: "topo:components/StatusCard.topo.tsx#Routes",
          title: "Routes",
          adapterId: "topo",
          discovery: "colocated",
          source: {
            filePath: "components/StatusCard.topo.tsx",
            line: 2,
          },
          exportName: "Routes",
          locator: "components/StatusCard.topo.tsx#Routes",
        }),
      },
      {
        componentFilePath: "components/StatusCard.tsx",
        preview: expect.objectContaining({
          id: "topo:components/StatusCard.topo.tsx#States",
          title: "States",
          exportName: "States",
        }),
      },
      {
        componentFilePath: "components/HealthBadge.tsx",
        preview: expect.objectContaining({
          id: "topo:components/HealthBadge.tsx#HealthBadge",
          title: "Health Badge",
          adapterId: "topo",
          discovery: "automatic",
          source: { filePath: "components/HealthBadge.tsx", line: 1 },
          exportName: "HealthBadge",
          locator: "components/HealthBadge.tsx#HealthBadge",
        }),
      },
    ]);
  });

  it("turns keyed config entries and accepted AI stubs into explicit graph provenance", async () => {
    const adapter = createTopoComponentPreviewAdapter({
      "components/RequiredCard.tsx": [
        {
          source: "previews/Cards.preview.tsx",
          exportName: "ConfiguredRequired",
          title: "Configured required card",
          provenance: "configured",
        },
      ],
      "components/HealthBadge.tsx": [
        {
          source: "previews/Cards.preview.tsx",
          exportName: "AcceptedHealth",
          provenance: "ai-accepted",
        },
      ],
    });

    const result = await adapter.scan(context());
    const configured = result.previews.filter(
      ({ preview }) =>
        preview.discovery === "configured" || preview.discovery === "generated",
    );

    expect(configured).toEqual([
      {
        componentFilePath: "components/HealthBadge.tsx",
        preview: expect.objectContaining({
          title: "Accepted Health",
          discovery: "generated",
          priority: 500,
          source: { filePath: "previews/Cards.preview.tsx", line: 3 },
          exportName: "AcceptedHealth",
        }),
      },
      {
        componentFilePath: "components/RequiredCard.tsx",
        preview: expect.objectContaining({
          title: "Configured required card",
          discovery: "configured",
          priority: 300,
          source: { filePath: "previews/Cards.preview.tsx", line: 2 },
          exportName: "ConfiguredRequired",
        }),
      },
    ]);
  });

  it("fails configured previews with actionable missing-export evidence", async () => {
    const adapter = createTopoComponentPreviewAdapter({
      "components/RequiredCard.tsx": [
        {
          source: "previews/Cards.preview.tsx",
          exportName: "Missing",
          provenance: "configured",
        },
      ],
    });

    await expect(adapter.scan(context())).rejects.toThrow(
      'does not export "Missing"',
    );
  });

  it("fails an explicitly configured malformed wrapper with Oxc evidence", async () => {
    const malformed = {
      ...sourceByPath,
      "previews/Broken.preview.tsx":
        "export function BrokenPreview( { return null }",
    };
    const adapter = createTopoComponentPreviewAdapter({
      "components/RequiredCard.tsx": [
        {
          source: "previews/Broken.preview.tsx",
          exportName: "BrokenPreview",
          provenance: "configured",
        },
      ],
    });
    const malformedContext = {
      ...context(),
      files: Object.keys(malformed).map((filePath) => ({
        filePath,
        extension: ".tsx",
      })),
      readFile: async (filePath: string) =>
        malformed[filePath as keyof typeof malformed],
    };

    await expect(adapter.scan(malformedContext)).rejects.toThrow(
      /could not be parsed by Oxc at \d+:\d+:/,
    );
  });

  it("resolves a capability-scoped runtime URL without losing its base path", async () => {
    const scan = await topoComponentPreviewAdapter.scan(context());
    const preview = scan.previews[0]!.preview;

    await expect(
      topoComponentPreviewAdapter.resolveCaptureUrl(preview, {
        baseUrl: "http://127.0.0.1:4600/__topo/capability/",
      }),
    ).resolves.toBe(
      "http://127.0.0.1:4600/__topo/capability/preview?source=components%2FStatusCard.topo.tsx&export=Routes",
    );
  });
});
