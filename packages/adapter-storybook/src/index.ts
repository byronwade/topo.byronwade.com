import {
  COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  defineComponentPreviewAdapter,
} from "@topo/preview-adapter";

export interface StoryDescriptor {
  filePath: string;
  componentName: string;
  storyNames: string[];
  stories: Array<{ name: string; line: number }>;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function discoverNamedStoryExports(
  source: string,
): Array<{ name: string; line: number }> {
  const stories = new Map<string, { name: string; line: number }>();
  const add = (name: string, offset: number) => {
    if (name !== "default" && !stories.has(name)) {
      stories.set(name, { name, line: lineAt(source, offset) });
    }
  };

  for (const match of source.matchAll(
    /^[ \t]*export\s+(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    if (match[1]) add(match[1], match.index ?? 0);
  }

  for (const match of source.matchAll(/^[ \t]*export\s*\{([^}]+)\}/gm)) {
    for (const rawSpecifier of (match[1] ?? "").split(",")) {
      const specifier = rawSpecifier.trim().replace(/^type\s+/, "");
      if (!specifier || rawSpecifier.trim().startsWith("type ")) continue;
      const [localName, exportedName] = specifier.split(/\s+as\s+/);
      const name = (exportedName ?? localName)?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
        add(name, match.index ?? 0);
      }
    }
  }

  return [...stories.values()];
}

export function discoverStories(
  filePaths: string[],
  sourceByPath: Record<string, string> = {},
): StoryDescriptor[] {
  return filePaths
    .filter((filePath) => /\.stories\.(?:[cm]?[jt]sx?|mdx)$/.test(filePath))
    .map((filePath) => {
      const fileName = filePath.split("/").at(-1) ?? filePath;
      const componentName = fileName.split(".stories.")[0] ?? fileName;
      const source = sourceByPath[filePath] ?? "";
      const stories = discoverNamedStoryExports(source);
      return {
        filePath,
        componentName,
        storyNames: stories.map((story) => story.name),
        stories,
      };
    });
}

const COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx"];

function normalizedImportPath(value: string): string {
  return value.replace(/^\.\//, "").replace(/\\/g, "/");
}

function componentFileForStory(
  storyPath: string,
  filePaths: ReadonlySet<string>,
): string | undefined {
  const marker = storyPath.lastIndexOf(".stories.");
  if (marker < 0) return undefined;
  const stem = storyPath.slice(0, marker);
  return COMPONENT_EXTENSIONS.map((extension) => `${stem}${extension}`).find(
    (candidate) => filePaths.has(candidate),
  );
}

interface StorybookIndexEntry {
  id: string;
  importPath: string;
  exportName?: string;
  type?: string;
}

function storybookEntries(value: unknown): StorybookIndexEntry[] {
  if (typeof value !== "object" || value === null) return [];
  const index = value as { entries?: unknown; stories?: unknown };
  const entries = index.entries ?? index.stories;
  if (typeof entries !== "object" || entries === null) return [];
  return Object.values(entries).filter(
    (entry): entry is StorybookIndexEntry => {
      if (typeof entry !== "object" || entry === null) return false;
      const candidate = entry as Partial<StorybookIndexEntry>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.importPath === "string" &&
        (candidate.exportName === undefined ||
          typeof candidate.exportName === "string")
      );
    },
  );
}

export const storybookComponentPreviewAdapter = defineComponentPreviewAdapter({
  apiVersion: COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  id: "storybook",
  displayName: "Storybook",
  async scan(context) {
    const storyFiles = context.files.filter((file) =>
      /\.stories\.(?:[cm]?[jt]sx?|mdx)$/.test(file.filePath),
    );
    const sourceByPath = Object.fromEntries(
      await Promise.all(
        storyFiles.map(async (file) => [
          file.filePath,
          await context.readFile(file.filePath),
        ]),
      ),
    );
    const filePaths = new Set(context.files.map((file) => file.filePath));
    return {
      previews: discoverStories(
        storyFiles.map((file) => file.filePath),
        sourceByPath,
      ).flatMap((story) => {
        const componentFilePath = componentFileForStory(
          story.filePath,
          filePaths,
        );
        if (!componentFilePath) return [];
        return story.stories.map(({ name: storyName, line }) => ({
          componentFilePath,
          preview: {
            id: `storybook:${story.filePath}#${storyName}`,
            title: storyName,
            adapterId: "storybook",
            discovery: "storybook",
            source: { filePath: story.filePath, line },
            exportName: storyName,
            locator: `${story.filePath}#${storyName}`,
            priority: 100,
          },
        }));
      }),
    };
  },
  async resolveCaptureUrl(preview, options) {
    if (!preview.exportName) {
      throw new Error(
        `Storybook preview "${preview.id}" does not declare an export name.`,
      );
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    const indexUrls = ["/index.json", "/stories.json"].map(
      (pathname) => new URL(pathname, options.baseUrl),
    );
    let response: Response | undefined;
    const failures: string[] = [];
    for (const candidate of indexUrls) {
      const candidateResponse = await fetcher(candidate);
      if (candidateResponse.ok) {
        response = candidateResponse;
        break;
      }
      failures.push(
        `${candidate.pathname} returned ${candidateResponse.status}`,
      );
    }
    if (!response) {
      throw new Error(
        `Storybook index is unavailable (${failures.join(", ")}). Start Storybook or update preview.componentBaseUrls.storybook.`,
      );
    }
    const sourcePath = normalizedImportPath(preview.source.filePath);
    const entry = storybookEntries(await response.json()).find(
      (candidate) =>
        normalizedImportPath(candidate.importPath) === sourcePath &&
        candidate.exportName === preview.exportName &&
        candidate.type !== "docs",
    );
    if (!entry) {
      throw new Error(
        `Storybook index has no story for ${preview.source.filePath}#${preview.exportName}. Refresh Storybook's index and rescan Topo.`,
      );
    }
    const url = new URL("/iframe.html", options.baseUrl);
    url.searchParams.set("id", entry.id);
    url.searchParams.set("viewMode", "story");
    return url.toString();
  },
});
