import { describe, expect, it } from "vitest";

import { parseModule, parseModules } from "./index.js";

describe("Oxc module parser", () => {
  it("extracts precise value imports, aliases, dependencies, and exports", () => {
    const source = [
      'import DefaultCard, { Card as Renamed, type CardProps } from "./Card";',
      'export { Toolbar } from "./Toolbar";',
      "export function Screen({ customer, mode = 'full', optional }: { customer: Customer; mode?: string; optional?: boolean }) { return null }",
      "export const EmptyState = () => null;",
    ].join("\n");
    const result = parseModule(source, "app/page.tsx");

    expect(result).toMatchObject({
      version: 1,
      engine: "oxc",
      filePath: "app/page.tsx",
      hasModuleSyntax: true,
      dependencies: ["./Card", "./Toolbar"],
      diagnostics: [],
    });
    expect(result.imports[0]).toEqual({
      source: "./Card",
      names: ["DefaultCard", "Renamed"],
      line: 1,
      specifiers: [
        {
          imported: "default",
          local: "DefaultCard",
          kind: "default",
          typeOnly: false,
        },
        {
          imported: "Card",
          local: "Renamed",
          kind: "named",
          typeOnly: false,
        },
        {
          imported: "CardProps",
          local: "CardProps",
          kind: "named",
          typeOnly: true,
        },
      ],
    });
    expect(result.exports).toEqual([
      {
        name: "Screen",
        kind: "function",
        runtimeKind: "function",
        line: 3,
        requiredProps: 1,
      },
      {
        name: "EmptyState",
        kind: "const",
        runtimeKind: "arrow",
        line: 4,
        requiredProps: 0,
      },
    ]);
  });

  it("does not mistake comments, strings, types, or non-callable constants for previews", () => {
    const source = [
      'const example = "export function Fake() {}";',
      "// export const AlsoFake = () => null",
      "export type Props = { value: string };",
      "export const metadata = { title: 'Card' };",
      "export default ({ label = 'Ready' }: { label?: string }) => null;",
    ].join("\n");

    expect(parseModule(source, "components/Card.tsx").exports).toEqual([
      {
        name: "metadata",
        kind: "const",
        runtimeKind: "unknown",
        line: 4,
        requiredProps: 1,
      },
      {
        name: "default",
        kind: "default",
        runtimeKind: "arrow",
        line: 5,
        requiredProps: 0,
      },
    ]);
  });

  it("returns source-located diagnostics while retaining a partial read model", () => {
    const result = parseModule(
      "export function Broken( {\n  return null\n}",
      "components/Broken.tsx",
    );

    expect(result.engine).toBe("oxc");
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      line: expect.any(Number),
      column: expect.any(Number),
    });
    expect(result.diagnostics[0]?.message).toBeTruthy();
  });

  it("parses deterministic batches and rejects duplicate identities", () => {
    expect(
      parseModules([
        { filePath: "a.ts", source: "export const a = 1" },
        { filePath: "b.ts", source: "export const b = 2" },
      ]).map((item) => item.filePath),
    ).toEqual(["a.ts", "b.ts"]);

    expect(() =>
      parseModules([
        { filePath: "a.ts", source: "export const a = 1" },
        { filePath: "a.ts", source: "export const a = 2" },
      ]),
    ).toThrow('Module "a.ts" was provided more than once.');
  });
});
