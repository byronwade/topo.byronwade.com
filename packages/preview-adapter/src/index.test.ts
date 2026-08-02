import { describe, expect, it } from "vitest";

import {
  COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  ComponentPreviewAdapterContractError,
  createComponentPreviewAdapterRegistry,
  defineComponentPreviewAdapter,
} from "./index.js";

const preview = {
  id: "fixture:button#Primary",
  title: "Primary",
  adapterId: "fixture.preview",
  source: { filePath: "components/Button.preview.tsx", line: 1 },
  exportName: "Primary",
  locator: "components/Button.preview.tsx#Primary",
};

function adapter() {
  return defineComponentPreviewAdapter({
    apiVersion: COMPONENT_PREVIEW_ADAPTER_API_VERSION,
    id: "fixture.preview",
    displayName: "Fixture previews",
    scan: () => ({
      previews: [{ componentFilePath: "components/Button.tsx", preview }],
    }),
    resolveCaptureUrl: (_preview, { baseUrl }) =>
      new URL("/preview/button/primary", baseUrl).toString(),
  });
}

describe("component preview adapter registry", () => {
  it("preserves exact component source identity and resolves through the owning adapter", async () => {
    const registry = createComponentPreviewAdapterRegistry([adapter()]);
    const scan = await registry.scan({
      rootDir: "C:/fixture",
      files: [
        { filePath: "components/Button.tsx", extension: ".tsx" },
        { filePath: "components/Button.preview.tsx", extension: ".tsx" },
      ],
      packageNames: new Set(),
      readFile: async () => "export const Primary = {};",
    });

    expect(scan.previews).toEqual([
      { componentFilePath: "components/Button.tsx", preview },
    ]);
    await expect(
      registry.resolveCaptureUrl(preview, {
        baseUrls: { "fixture.preview": "http://127.0.0.1:6100" },
      }),
    ).resolves.toBe("http://127.0.0.1:6100/preview/button/primary");
  });

  it("rejects duplicate adapter ids before any workspace code executes", () => {
    expect(() =>
      createComponentPreviewAdapterRegistry([adapter(), adapter()]),
    ).toThrow(ComponentPreviewAdapterContractError);
  });

  it("reports an actionable error when a capture origin is not configured", async () => {
    const registry = createComponentPreviewAdapterRegistry([adapter()]);

    await expect(
      registry.resolveCaptureUrl(preview, { baseUrls: {} }),
    ).rejects.toThrow(
      'No capture base URL is configured for component preview adapter "fixture.preview"',
    );
  });
});
