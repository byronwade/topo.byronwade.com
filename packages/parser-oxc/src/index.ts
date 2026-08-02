import {
  parseSync,
  type EcmaScriptModule,
  type OxcError,
  type ParamPattern,
  type Program,
  type Statement,
} from "oxc-parser";

export const PARSED_MODULE_VERSION = 1 as const;
export const PARSER_ENGINE = "oxc" as const;

export interface ParsedImportSpecifier {
  imported: string;
  local: string;
  kind: "default" | "named" | "namespace";
  typeOnly: boolean;
}

export interface ParsedImport {
  source: string;
  /** Local value bindings available to the importing module. */
  names: string[];
  line: number;
  specifiers: ParsedImportSpecifier[];
}

export interface ParsedExport {
  name: string;
  kind: "function" | "const" | "class" | "default";
  runtimeKind: "function" | "arrow" | "class" | "reference" | "unknown";
  line: number;
  requiredProps: number;
}

export interface ParsedDiagnostic {
  severity: "error" | "warning" | "advice";
  message: string;
  line: number;
  column: number;
}

export interface ParsedModule {
  version: typeof PARSED_MODULE_VERSION;
  engine: typeof PARSER_ENGINE;
  filePath: string;
  hasModuleSyntax: boolean;
  imports: ParsedImport[];
  exports: ParsedExport[];
  dependencies: string[];
  diagnostics: ParsedDiagnostic[];
}

interface CachedModule {
  source: string;
  result: ParsedModule;
}

interface ObjectPatternView {
  optional?: boolean;
  typeAnnotation?: {
    typeAnnotation?: {
      type: string;
      members?: Array<{
        type: string;
        optional?: boolean;
        key?: unknown;
      }>;
    };
  } | null;
  properties: Array<{
    type: string;
    optional?: boolean;
    key?: unknown;
    value?: { type: string };
  }>;
}

const MAX_CACHE_ENTRIES = 4_096;
const moduleCache = new Map<string, CachedModule>();

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function locationAt(
  starts: readonly number[],
  offset: number,
): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: offset - (starts[lineIndex] ?? 0) + 1,
  };
}

function nameOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as { name?: unknown; value?: unknown };
  if (typeof candidate.name === "string") return candidate.name;
  return typeof candidate.value === "string" ? candidate.value : undefined;
}

function optionalObjectKeys(pattern: ObjectPatternView): Set<string> {
  const annotation = pattern.typeAnnotation?.typeAnnotation;
  if (annotation?.type !== "TSTypeLiteral") return new Set();
  return new Set(
    (annotation.members ?? [])
      .filter(
        (member) => member.type === "TSPropertySignature" && member.optional,
      )
      .map((member) =>
        member.type === "TSPropertySignature" ? nameOf(member.key) : undefined,
      )
      .filter((name): name is string => Boolean(name)),
  );
}

function requiredPatternCount(pattern: ParamPattern): number {
  if (pattern.type === "TSParameterProperty") {
    return requiredPatternCount(pattern.parameter);
  }
  if (pattern.type === "AssignmentPattern") return 0;
  if (pattern.type === "RestElement") return pattern.optional ? 0 : 1;
  if (pattern.type === "Identifier") return pattern.optional ? 0 : 1;
  if (pattern.type === "ArrayPattern") {
    return pattern.elements.reduce((count, item) => {
      if (!item || item.type === "AssignmentPattern") return count;
      return count + 1;
    }, 0);
  }
  if (pattern.type === "ObjectPattern") {
    const objectPattern = pattern as unknown as ObjectPatternView;
    if (objectPattern.optional) return 0;
    const optional = optionalObjectKeys(objectPattern);
    return objectPattern.properties.reduce((count, property) => {
      if (property.type === "RestElement") {
        return count + (property.optional ? 0 : 1);
      }
      if (property.value?.type === "AssignmentPattern") return count;
      const key = nameOf(property.key);
      return count + (key && optional.has(key) ? 0 : 1);
    }, 0);
  }
  return 1;
}

function requiredParameterCount(parameters: readonly ParamPattern[]): number {
  return parameters.reduce(
    (count, parameter) => count + requiredPatternCount(parameter),
    0,
  );
}

function lineOf(starts: readonly number[], offset: number): number {
  return locationAt(starts, offset).line;
}

function exportFromFunction(
  statement: Extract<Statement, { type: "ExportNamedDeclaration" }>,
  starts: readonly number[],
): ParsedExport[] {
  const declaration = statement.declaration;
  if (!declaration) return [];

  if (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "TSDeclareFunction"
  ) {
    if (!declaration.id) return [];
    return [
      {
        name: declaration.id.name,
        kind: "function",
        runtimeKind: "function",
        line: lineOf(starts, declaration.start),
        requiredProps: requiredParameterCount(declaration.params),
      },
    ];
  }
  if (declaration.type === "ClassDeclaration") {
    if (!declaration.id) return [];
    return [
      {
        name: declaration.id.name,
        kind: "class",
        runtimeKind: "class",
        line: lineOf(starts, declaration.start),
        requiredProps: 1,
      },
    ];
  }
  if (declaration.type !== "VariableDeclaration") return [];

  return declaration.declarations.flatMap((item): ParsedExport[] => {
    if (item.id.type !== "Identifier") return [];
    const runtimeKind =
      item.init?.type === "ArrowFunctionExpression"
        ? "arrow"
        : item.init?.type === "FunctionExpression"
          ? "function"
          : "unknown";
    const parameters =
      item.init?.type === "ArrowFunctionExpression" ||
      item.init?.type === "FunctionExpression"
        ? item.init.params
        : undefined;
    return [
      {
        name: item.id.name,
        kind: "const",
        runtimeKind,
        line: lineOf(starts, item.start),
        requiredProps: parameters ? requiredParameterCount(parameters) : 1,
      },
    ];
  });
}

function exportFromDefault(
  statement: Extract<Statement, { type: "ExportDefaultDeclaration" }>,
  starts: readonly number[],
): ParsedExport {
  const declaration = statement.declaration;
  if (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "FunctionExpression"
  ) {
    return {
      name: "default",
      kind: "default",
      runtimeKind: "function",
      line: lineOf(starts, declaration.start),
      requiredProps: requiredParameterCount(declaration.params),
    };
  }
  if (declaration.type === "ArrowFunctionExpression") {
    return {
      name: "default",
      kind: "default",
      runtimeKind: "arrow",
      line: lineOf(starts, declaration.start),
      requiredProps: requiredParameterCount(declaration.params),
    };
  }
  if (
    declaration.type === "ClassDeclaration" ||
    declaration.type === "ClassExpression"
  ) {
    return {
      name: "default",
      kind: "default",
      runtimeKind: "class",
      line: lineOf(starts, declaration.start),
      requiredProps: 1,
    };
  }
  return {
    name: "default",
    kind: "default",
    runtimeKind: declaration.type === "Identifier" ? "reference" : "unknown",
    line: lineOf(starts, declaration.start),
    requiredProps: 1,
  };
}

function extractExports(
  program: Program,
  starts: readonly number[],
): ParsedExport[] {
  const result: ParsedExport[] = [];
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      result.push(exportFromDefault(statement, starts));
      continue;
    }
    if (
      statement.type !== "ExportNamedDeclaration" ||
      statement.exportKind === "type"
    ) {
      continue;
    }
    const declared = exportFromFunction(statement, starts);
    if (declared.length > 0) {
      result.push(...declared);
      continue;
    }
    if (statement.source) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.exportKind === "type") continue;
      const exported = nameOf(specifier.exported);
      if (!exported) continue;
      result.push({
        name: exported,
        kind: "const",
        runtimeKind: "reference",
        line: lineOf(starts, specifier.start),
        requiredProps: 1,
      });
    }
  }
  return result;
}

function importKind(kind: string): ParsedImportSpecifier["kind"] {
  if (kind === "Default") return "default";
  if (kind === "NamespaceObject") return "namespace";
  return "named";
}

function extractImports(
  module: EcmaScriptModule,
  starts: readonly number[],
): ParsedImport[] {
  return module.staticImports.map((item) => {
    const specifiers = item.entries.map((entry) => ({
      imported:
        entry.importName.kind === "Default"
          ? "default"
          : entry.importName.kind === "NamespaceObject"
            ? "*"
            : (entry.importName.name ?? entry.localName.value),
      local: entry.localName.value,
      kind: importKind(entry.importName.kind),
      typeOnly: entry.isType,
    }));
    return {
      source: item.moduleRequest.value,
      names: specifiers
        .filter((specifier) => !specifier.typeOnly)
        .map((specifier) => specifier.local),
      line: lineOf(starts, item.start),
      specifiers,
    };
  });
}

function extractDependencies(module: EcmaScriptModule): string[] {
  return [
    ...new Set([
      ...module.staticImports.flatMap((item) =>
        item.entries.length === 0 || item.entries.some((entry) => !entry.isType)
          ? [item.moduleRequest.value]
          : [],
      ),
      ...module.staticExports.flatMap((item) =>
        item.entries.flatMap((entry) =>
          entry.moduleRequest && !entry.isType
            ? [entry.moduleRequest.value]
            : [],
        ),
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function diagnosticFromOxc(
  diagnostic: OxcError,
  starts: readonly number[],
): ParsedDiagnostic {
  const label = diagnostic.labels[0];
  const location = locationAt(starts, label?.start ?? 0);
  const severity = diagnostic.severity.toLowerCase();
  return {
    severity:
      severity === "warning" || severity === "advice" ? severity : "error",
    message: diagnostic.message,
    ...location,
  };
}

function parseUncached(source: string, filePath: string): ParsedModule {
  const starts = lineStarts(source);
  const parsed = parseSync(filePath, source, {
    sourceType: "unambiguous",
    astType: "ts",
    preserveParens: false,
    showSemanticErrors: false,
  });
  return {
    version: PARSED_MODULE_VERSION,
    engine: PARSER_ENGINE,
    filePath,
    hasModuleSyntax: parsed.module.hasModuleSyntax,
    imports: extractImports(parsed.module, starts),
    exports: extractExports(parsed.program, starts),
    dependencies: extractDependencies(parsed.module),
    diagnostics: parsed.errors.map((error) => diagnosticFromOxc(error, starts)),
  };
}

/**
 * Parse one JavaScript or TypeScript module through the native Oxc binding.
 * Results are cached by source identity so daemon rescans do not reparse
 * unchanged files. The bounded cache retains only the newest file identities.
 */
export function parseModule(
  source: string,
  filePath = "unknown.tsx",
): ParsedModule {
  const cached = moduleCache.get(filePath);
  if (cached?.source === source) {
    moduleCache.delete(filePath);
    moduleCache.set(filePath, cached);
    return cached.result;
  }

  const result = parseUncached(source, filePath);
  moduleCache.delete(filePath);
  moduleCache.set(filePath, { source, result });
  while (moduleCache.size > MAX_CACHE_ENTRIES) {
    const oldest = moduleCache.keys().next().value as string | undefined;
    if (!oldest) break;
    moduleCache.delete(oldest);
  }
  return result;
}

export function parseModules(
  modules: readonly { source: string; filePath: string }[],
): ParsedModule[] {
  const seen = new Set<string>();
  return modules.map((item) => {
    if (seen.has(item.filePath)) {
      throw new Error(`Module "${item.filePath}" was provided more than once.`);
    }
    seen.add(item.filePath);
    return parseModule(item.source, item.filePath);
  });
}
