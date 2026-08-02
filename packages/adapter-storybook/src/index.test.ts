import { describe, expect, it } from "vitest";

import { discoverStories, storybookComponentPreviewAdapter } from "./index.js";

describe("Storybook adapter", () => {
  it("catalogs declarative story exports", () => {
    expect(
      discoverStories(["components/Button.stories.tsx"], {
        "components/Button.stories.tsx": "export const Primary = {};",
      })[0],
    ).toMatchObject({ componentName: "Button", storyNames: ["Primary"] });
  });

  it("keeps only exported stories and records their exact source lines", () => {
    const [descriptor] = discoverStories(["components/Button.stories.tsx"], {
      "components/Button.stories.tsx": [
        "const helper = {};",
        "const meta = {};",
        "export default meta;",
        "export const Primary = {};",
        "const localDisabled = {};",
        "export { localDisabled as Disabled };",
        "export type { ButtonProps };",
      ].join("\n"),
    });

    expect(descriptor?.stories).toEqual([
      { name: "Primary", line: 4 },
      { name: "Disabled", line: 6 },
    ]);
  });

  it("discovers each colocated story as an adapter-owned component preview", async () => {
    const sourceByPath: Record<string, string> = {
      "components/Button.tsx": "export function Button() { return null }",
      "components/Button.stories.tsx":
        "export default { component: Button };\nexport const Primary = {};\nexport const Disabled = {};",
    };

    const result = await storybookComponentPreviewAdapter.scan({
      rootDir: "C:/fixture",
      files: Object.keys(sourceByPath).map((filePath) => ({
        filePath,
        extension: ".tsx",
      })),
      packageNames: new Set(["storybook"]),
      readFile: async (filePath) => sourceByPath[filePath] ?? "",
    });

    expect(result.previews).toEqual([
      {
        componentFilePath: "components/Button.tsx",
        preview: {
          id: "storybook:components/Button.stories.tsx#Primary",
          title: "Primary",
          adapterId: "storybook",
          discovery: "storybook",
          source: { filePath: "components/Button.stories.tsx", line: 2 },
          exportName: "Primary",
          locator: "components/Button.stories.tsx#Primary",
          priority: 100,
        },
      },
      {
        componentFilePath: "components/Button.tsx",
        preview: {
          id: "storybook:components/Button.stories.tsx#Disabled",
          title: "Disabled",
          adapterId: "storybook",
          discovery: "storybook",
          source: { filePath: "components/Button.stories.tsx", line: 3 },
          exportName: "Disabled",
          locator: "components/Button.stories.tsx#Disabled",
          priority: 100,
        },
      },
    ]);
  });

  it("resolves the exact Storybook index entry instead of guessing a story id", async () => {
    const url = await storybookComponentPreviewAdapter.resolveCaptureUrl(
      {
        id: "storybook:components/Button.stories.tsx#Primary",
        title: "Primary",
        adapterId: "storybook",
        source: { filePath: "components/Button.stories.tsx", line: 1 },
        exportName: "Primary",
        locator: "components/Button.stories.tsx#Primary",
      },
      {
        baseUrl: "http://127.0.0.1:6006",
        fetch: async () =>
          new Response(
            JSON.stringify({
              v: 5,
              entries: {
                "components-button--primary": {
                  id: "components-button--primary",
                  title: "Components/Button",
                  name: "Primary",
                  importPath: "./components/Button.stories.tsx",
                  exportName: "Primary",
                  type: "story",
                  tags: ["dev", "test"],
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    );

    expect(url).toBe(
      "http://127.0.0.1:6006/iframe.html?id=components-button--primary&viewMode=story",
    );
  });

  it("falls back to legacy stories.json indexes", async () => {
    const requested: string[] = [];
    const url = await storybookComponentPreviewAdapter.resolveCaptureUrl(
      {
        id: "storybook:components/Button.stories.tsx#Primary",
        title: "Primary",
        adapterId: "storybook",
        source: { filePath: "components/Button.stories.tsx", line: 1 },
        exportName: "Primary",
        locator: "components/Button.stories.tsx#Primary",
      },
      {
        baseUrl: "http://127.0.0.1:6006",
        fetch: async (input) => {
          const value = String(input);
          requested.push(value);
          if (value.endsWith("/index.json"))
            return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              v: 3,
              stories: {
                "components-button--primary": {
                  id: "components-button--primary",
                  importPath: "./components/Button.stories.tsx",
                  exportName: "Primary",
                  type: "story",
                },
              },
            }),
          );
        },
      },
    );

    expect(requested).toEqual([
      "http://127.0.0.1:6006/index.json",
      "http://127.0.0.1:6006/stories.json",
    ]);
    expect(url).toContain("id=components-button--primary");
  });
});
