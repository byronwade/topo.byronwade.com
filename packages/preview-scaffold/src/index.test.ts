import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ComponentPreviewScaffoldError,
  createComponentPreviewScaffold,
  inspectComponentPreviewScaffold,
} from "./index.js";

async function fixture(
  source: string,
  filePath = "components/Button.tsx",
): Promise<{ sourceRoot: string; absoluteSource: string }> {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "topo-preview-"));
  const absoluteSource = path.join(sourceRoot, filePath);
  await mkdir(path.dirname(absoluteSource), { recursive: true });
  await writeFile(absoluteSource, source, "utf8");
  return { sourceRoot, absoluteSource };
}

function component(filePath = "components/Button.tsx") {
  return {
    id: `component:${filePath}`,
    name: path.basename(filePath, path.extname(filePath)),
    source: { filePath, line: 1 },
  };
}

describe("component preview scaffold", () => {
  it("plans and atomically creates a ready named-export preview", async () => {
    const { sourceRoot } = await fixture(
      "export function Button() { return <button>Save</button>; }",
    );
    const input = { sourceRoot, component: component() };

    const plan = await inspectComponentPreviewScaffold(input);
    expect(plan).toMatchObject({
      schemaVersion: 1,
      previewSource: "components/Button.topo.tsx",
      exportName: "Button",
      requiredProps: 0,
      mode: "ready",
      canApply: true,
      conflicts: [],
    });
    await expect(
      readFile(path.join(sourceRoot, plan.previewSource), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const result = await createComponentPreviewScaffold(input);
    expect(result.status).toBe("created");
    expect(await readFile(path.join(sourceRoot, plan.previewSource), "utf8"))
      .toBe(`import { Button as PreviewComponent } from "./Button";

export function Default() {
  return <PreviewComponent />;
}
`);
    await expect(createComponentPreviewScaffold(input)).rejects.toMatchObject({
      code: "target-exists",
    });
  });

  it("creates an inactive fixture draft for required default-export props", async () => {
    const { sourceRoot } = await fixture(
      "export default function Button(props: { label: string }) { return <button>{props.label}</button>; }",
    );
    const result = await createComponentPreviewScaffold({
      sourceRoot,
      component: component(),
    });
    const generated = await readFile(
      path.join(sourceRoot, result.previewSource),
      "utf8",
    );

    expect(result).toMatchObject({
      exportName: "default",
      requiredProps: 1,
      mode: "fixture-required",
    });
    expect(generated).toContain('import PreviewComponent from "./Button";');
    expect(generated).toContain("satisfies Partial<PreviewProps>");
    expect(generated).not.toMatch(/^export function Default/m);
    expect(generated).toContain("Do not place credentials");
  });

  it("rejects escaping and linked source paths", async () => {
    const { sourceRoot } = await fixture(
      "export function Button() { return null; }",
    );
    await expect(
      inspectComponentPreviewScaffold({
        sourceRoot,
        component: component("../Button.tsx"),
      }),
    ).rejects.toBeInstanceOf(ComponentPreviewScaffoldError);

    const outside = await mkdtemp(path.join(os.tmpdir(), "topo-outside-"));
    const outsideFile = path.join(outside, "Outside.tsx");
    await writeFile(
      outsideFile,
      "export function Outside() { return null; }",
      "utf8",
    );
    await symlink(
      outsideFile,
      path.join(sourceRoot, "components", "Outside.tsx"),
      "file",
    );
    await expect(
      inspectComponentPreviewScaffold({
        sourceRoot,
        component: component("components/Outside.tsx"),
      }),
    ).rejects.toMatchObject({ code: "source-link-outside-root" });
  });
});
