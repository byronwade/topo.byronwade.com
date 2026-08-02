import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  resolveApplicationRuntimeAdapter,
  type ApplicationRuntimeAdapter,
} from "@topo/application-runtime";
import {
  createApiEndpointAdapterRegistry,
  type ApiEndpointAdapter,
} from "@topo/endpoint-adapter";
import {
  createFrameworkAdapterRegistry,
  type FrameworkAdapter,
  type FrameworkAdapterContext,
} from "@topo/framework-adapter";
import {
  createFlowDiscoveryAdapterRegistry,
  type FlowDiscoveryAdapter,
} from "@topo/flow-adapter";
import {
  createComponentPreviewAdapterRegistry,
  type ComponentPreviewAdapter,
} from "@topo/preview-adapter";
import { z } from "zod";

export const ADAPTER_SCAFFOLD_KINDS = [
  "framework",
  "component-preview",
  "api-endpoint",
  "flow-discovery",
  "application-runtime",
] as const;

export type AdapterScaffoldKind = (typeof ADAPTER_SCAFFOLD_KINDS)[number];

const AdapterScaffoldKindSchema = z.enum(ADAPTER_SCAFFOLD_KINDS);
const AdapterRegistrationKeySchema = z.enum([
  "frameworkAdapters",
  "componentPreviewAdapters",
  "apiEndpointAdapters",
  "flowAdapters",
  "applicationRuntimeAdapters",
]);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const REGISTRATION_KEY_BY_KIND = {
  framework: "frameworkAdapters",
  "component-preview": "componentPreviewAdapters",
  "api-endpoint": "apiEndpointAdapters",
  "flow-discovery": "flowAdapters",
  "application-runtime": "applicationRuntimeAdapters",
} as const satisfies Record<
  AdapterScaffoldKind,
  z.infer<typeof AdapterRegistrationKeySchema>
>;

export const AdapterScaffoldManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: AdapterScaffoldKindSchema,
    id: z.string().regex(IDENTIFIER_PATTERN),
    displayName: z.string().trim().min(1),
    source: z.literal("local"),
    entry: z.literal("index.mjs"),
    test: z.literal("index.test.mjs"),
    registration: z
      .object({
        configKey: AdapterRegistrationKeySchema,
        moduleSpecifier: z.string().startsWith("./"),
      })
      .strict(),
    generatedBy: z.literal("topo adapters create"),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.registration.configKey !==
      REGISTRATION_KEY_BY_KIND[manifest.kind]
    ) {
      context.addIssue({
        code: "custom",
        path: ["registration", "configKey"],
        message: `Registration key must be ${REGISTRATION_KEY_BY_KIND[manifest.kind]} for ${manifest.kind} adapters.`,
      });
    }
  });

export type AdapterScaffoldManifest = z.infer<
  typeof AdapterScaffoldManifestSchema
>;

export interface AdapterScaffoldFile {
  path: "adapter.json" | "index.mjs" | "index.test.mjs" | "README.md";
  content: string;
}

export interface AdapterScaffoldRegistration {
  configKey: z.infer<typeof AdapterRegistrationKeySchema>;
  moduleSpecifier: string;
  snippet: string;
}

export interface AdapterScaffoldPlan {
  schemaVersion: 1;
  status: "ready" | "conflict";
  projectRoot: string;
  outputDirectory: string;
  kind: AdapterScaffoldKind;
  id: string;
  displayName: string;
  registration: AdapterScaffoldRegistration;
  files: AdapterScaffoldFile[];
  conflicts: string[];
}

export interface AdapterScaffoldResult {
  schemaVersion: 1;
  status: "created";
  projectRoot: string;
  outputDirectory: string;
  manifestPath: string;
  createdPaths: string[];
  registration: AdapterScaffoldRegistration;
}

export interface InspectedAdapterScaffold {
  filePath: string;
  manifest: AdapterScaffoldManifest;
}

export interface AdapterScaffoldReadIssue {
  filePath: string;
  message: string;
}

export interface AdapterScaffoldInspection {
  adapters: InspectedAdapterScaffold[];
  issues: AdapterScaffoldReadIssue[];
}

export const ADAPTER_SCAFFOLD_CHECK_VERSION = 1 as const;

export interface AdapterScaffoldConformanceCheck {
  id: "manifest" | "module" | "identity" | "empty-context";
  status: "pass" | "fail";
  detail: string;
}

export interface AdapterScaffoldConformanceResult {
  id: string;
  kind: AdapterScaffoldKind;
  displayName: string;
  manifestPath: string;
  moduleSpecifier: string;
  status: "pass" | "fail";
  checks: AdapterScaffoldConformanceCheck[];
}

export interface AdapterScaffoldConformanceReport {
  schemaVersion: typeof ADAPTER_SCAFFOLD_CHECK_VERSION;
  status: "pass" | "fail";
  projectRoot: string;
  selectedId?: string;
  summary: {
    checked: number;
    passed: number;
    failed: number;
    issues: number;
    malformed: number;
  };
  adapters: AdapterScaffoldConformanceResult[];
  issues: AdapterScaffoldReadIssue[];
}

export interface VerifyAdapterScaffoldsOptions {
  id?: string;
}

export interface PlanAdapterScaffoldInput {
  projectRoot: string;
  kind: AdapterScaffoldKind;
  id: string;
  displayName: string;
  outputDirectory?: string;
}

function assertIdentifier(id: string): string {
  if (!IDENTIFIER_PATTERN.test(id)) {
    throw new Error(
      "Adapter id must begin with a lowercase letter and contain only lowercase letters, numbers, dots, and hyphens.",
    );
  }
  return id;
}

function assertDisplayName(displayName: string): string {
  const value = displayName.trim();
  if (!value) throw new Error("Adapter display name cannot be empty.");
  return value;
}

function defaultOutputDirectory(id: string): string {
  return `topo/adapters/${id.replaceAll(".", "-")}`;
}

function assertProjectRelativeDirectory(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    value.split("/").includes("..")
  ) {
    throw new Error(
      `Adapter output must be a project-relative POSIX directory; received "${value}".`,
    );
  }
  const normalized = path.posix.normalize(value).replace(/^\.\//, "");
  if (!normalized || normalized === ".") {
    throw new Error("Adapter output must name a project-relative directory.");
  }
  return normalized.replace(/\/$/, "");
}

function assertAdapterCatalogDirectory(value: string): string {
  const normalized = assertProjectRelativeDirectory(value);
  const segments = normalized.split("/");
  if (
    segments.length !== 3 ||
    segments[0] !== "topo" ||
    segments[1] !== "adapters" ||
    !segments[2]
  ) {
    throw new Error(
      "Adapter output must use topo/adapters/<directory> so its durable manifest remains discoverable.",
    );
  }
  return normalized;
}

async function assertNoLinkedPathSegments(
  projectRoot: string,
  targetPath: string,
): Promise<void> {
  const relative = path.relative(projectRoot, targetPath);
  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const status = await lstat(current);
      if (status.isSymbolicLink()) {
        throw new Error(
          `Adapter output cannot traverse the linked path ${path.relative(projectRoot, current)}.`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function assertPhysicalContainment(
  projectRoot: string,
  existingPath: string,
): Promise<void> {
  const physicalRoot = await realpath(projectRoot);
  const physicalPath = await realpath(existingPath);
  const relative = path.relative(physicalRoot, physicalPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "Adapter output must physically remain inside the selected project root.",
    );
  }
}

function registrationFor(
  kind: AdapterScaffoldKind,
  outputDirectory: string,
): AdapterScaffoldRegistration {
  const configKey = REGISTRATION_KEY_BY_KIND[kind];
  const moduleSpecifier = `./${path.posix.join(outputDirectory, "index.mjs")}`;
  return {
    configKey,
    moduleSpecifier,
    snippet: `extensions: { ${configKey}: [${JSON.stringify(moduleSpecifier)}] }`,
  };
}

function frameworkSource(id: string, displayName: string): string {
  return `/**
 * Local Topo framework adapter.
 *
 * Replace the no-match implementation with framework-specific detection and
 * route discovery. The workspace snapshot is read-only and deterministic.
 */
export const frameworkAdapter = {
  apiVersion: 1,
  id: ${JSON.stringify(id)},
  displayName: ${JSON.stringify(displayName)},

  detect(context) {
    void context;
    return [];
  },

  scan(context, matches) {
    void context;
    void matches;
    return { routes: [] };
  },
};

export default frameworkAdapter;
`;
}

function componentPreviewSource(id: string, displayName: string): string {
  return `/**
 * Local Topo component-preview adapter.
 *
 * Return exact component and preview source identities from scan(). Keep the
 * runtime independent from route discovery and never invent required props.
 */
export const componentPreviewAdapter = {
  apiVersion: 1,
  id: ${JSON.stringify(id)},
  displayName: ${JSON.stringify(displayName)},

  scan(context) {
    void context;
    return { previews: [] };
  },

  resolveCaptureUrl(preview, { baseUrl }) {
    const url = new URL("preview", baseUrl);
    url.searchParams.set("export", preview.exportName ?? "default");
    return url.toString();
  },
};

export default componentPreviewAdapter;
`;
}

function applicationRuntimeSource(id: string, displayName: string): string {
  return `/**
 * Local Topo application-runtime adapter.
 *
 * Return a command plan only when this adapter can confidently start the
 * inspected application's native development server.
 */
export const applicationRuntimeAdapter = {
  apiVersion: 1,
  id: ${JSON.stringify(id)},
  displayName: ${JSON.stringify(displayName)},

  resolve(context) {
    void context;
    return undefined;
  },
};

export default applicationRuntimeAdapter;
`;
}

function apiEndpointSource(id: string, displayName: string): string {
  return `/**
 * Local Topo API endpoint adapter.
 *
 * Read only from the supplied snapshot and return literal, evidence-backed
 * operations. Return malformed or unresolved declarations through issues.
 */
export const apiEndpointAdapter = {
  apiVersion: 1,
  id: ${JSON.stringify(id)},
  displayName: ${JSON.stringify(displayName)},

  scan(context) {
    void context;
    return { endpoints: [], issues: [] };
  },
};

export default apiEndpointAdapter;
`;
}

function flowDiscoverySource(id: string, displayName: string): string {
  return `/**
 * Local Topo flow discovery adapter.
 *
 * Read only from the supplied source snapshot and exact screen ownership.
 * Return source-located transitions and issues; never write recorded flows.
 */
export const flowDiscoveryAdapter = {
  apiVersion: 1,
  id: ${JSON.stringify(id)},
  displayName: ${JSON.stringify(displayName)},

  scan(context) {
    void context;
    return { transitions: [], issues: [] };
  },
};

export default flowDiscoveryAdapter;
`;
}

function moduleSource(
  kind: AdapterScaffoldKind,
  id: string,
  displayName: string,
): string {
  if (kind === "framework") return frameworkSource(id, displayName);
  if (kind === "component-preview")
    return componentPreviewSource(id, displayName);
  if (kind === "api-endpoint") return apiEndpointSource(id, displayName);
  if (kind === "flow-discovery") return flowDiscoverySource(id, displayName);
  return applicationRuntimeSource(id, displayName);
}

function generatedTestSource(kind: AdapterScaffoldKind): string {
  const namedExport = {
    framework: "frameworkAdapter",
    "component-preview": "componentPreviewAdapter",
    "api-endpoint": "apiEndpointAdapter",
    "flow-discovery": "flowDiscoveryAdapter",
    "application-runtime": "applicationRuntimeAdapter",
  }[kind];
  const operation =
    kind === "framework"
      ? `assert.deepEqual(await adapter.detect(context), []);
  assert.deepEqual(await adapter.scan(context, []), { routes: [] });`
      : kind === "component-preview"
        ? `assert.deepEqual(await adapter.scan(context), { previews: [] });
  const preview = {
    id: "fixture:button#Primary",
    title: "Primary",
    adapterId: adapter.id,
    source: { filePath: "components/Button.preview.tsx", line: 1 },
    exportName: "Primary",
    locator: "components/Button.preview.tsx#Primary",
  };
  const captureUrl = await adapter.resolveCaptureUrl(preview, {
    baseUrl: "http://127.0.0.1:6100/",
  });
  assert.equal(new URL(captureUrl).origin, "http://127.0.0.1:6100");
  assert.equal(new URL(captureUrl).searchParams.get("export"), "Primary");`
        : kind === "api-endpoint"
          ? `assert.deepEqual(await adapter.scan(context), { endpoints: [], issues: [] });`
          : kind === "flow-discovery"
            ? `assert.deepEqual(await adapter.scan(context), { transitions: [], issues: [] });`
          : `assert.equal(await adapter.resolve({
    rootDir: process.cwd(),
    baseUrl: "http://127.0.0.1:3000",
    host: "127.0.0.1",
    port: 3000,
    packageManager: "pnpm",
    scripts: {},
    dependencies: new Set(),
  }), undefined);`;
  const context =
    kind === "application-runtime"
      ? ""
      : `  const context = {
    rootDir: process.cwd(),
    files: [],
    packageNames: new Set(),
    screens: [],
    readFile: async () => "",
  };
`;
  return `import assert from "node:assert/strict";
import test from "node:test";

import adapter, { ${namedExport} } from "./index.mjs";

test("exports one contract-shaped adapter", async () => {
  assert.equal(adapter, ${namedExport});
  assert.equal(adapter.apiVersion, 1);
  assert.equal(typeof adapter.id, "string");
  assert.equal(typeof adapter.displayName, "string");
${context}${operation}
});
`;
}

function readmeSource(
  manifest: AdapterScaffoldManifest,
  registration: AdapterScaffoldRegistration,
): string {
  return `# ${manifest.displayName}

This is a local, zero-dependency Topo ${manifest.kind} adapter scaffold.

## Register it

Merge this entry into \`topo.config.ts\`:

\`\`\`ts
export default {
  extensions: {
    ${registration.configKey}: [${JSON.stringify(registration.moduleSpecifier)}],
  },
};
\`\`\`

## Develop it

1. Edit \`index.mjs\` using the read-only contract comments as a guide.
2. Run \`node --test ${path.posix.join(path.posix.dirname(registration.moduleSpecifier), "index.test.mjs")}\`.
3. Run \`topo adapters check . --id ${manifest.id}\` to load the exact manifest module and exercise its public contract against a safe empty workspace.
4. Run \`topo scan --json\` for discovery adapters or \`topo doctor --json\` for runtime adapters against a real project.

\`adapter.json\` is the versioned, machine-readable identity and registration
record for this scaffold. Application routes, previews, and runtime evidence
remain authoritative in their existing Topo contracts.

Adapter checks import and execute the local adapter module, so run them only for
repositories and adapter code you trust. Topo does not start the application or
a development server during this conformance check.
`;
}

function scaffoldFiles(
  kind: AdapterScaffoldKind,
  id: string,
  displayName: string,
  registration: AdapterScaffoldRegistration,
): AdapterScaffoldFile[] {
  const manifest = AdapterScaffoldManifestSchema.parse({
    schemaVersion: 1,
    kind,
    id,
    displayName,
    source: "local",
    entry: "index.mjs",
    test: "index.test.mjs",
    registration: {
      configKey: registration.configKey,
      moduleSpecifier: registration.moduleSpecifier,
    },
    generatedBy: "topo adapters create",
  });
  return [
    {
      path: "adapter.json",
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    },
    { path: "index.mjs", content: moduleSource(kind, id, displayName) },
    { path: "index.test.mjs", content: generatedTestSource(kind) },
    { path: "README.md", content: readmeSource(manifest, registration) },
  ];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function inspectAdapterScaffolds(
  projectRootValue: string,
): Promise<AdapterScaffoldInspection> {
  const projectRoot = path.resolve(projectRootValue);
  const directory = path.join(projectRoot, "topo", "adapters");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { adapters: [], issues: [] };
    }
    throw error;
  }
  const adapters: InspectedAdapterScaffold[] = [];
  const issues: AdapterScaffoldReadIssue[] = [];
  for (const entry of entries
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.posix.join(
      "topo",
      "adapters",
      entry.name,
      "adapter.json",
    );
    try {
      const manifest = AdapterScaffoldManifestSchema.parse(
        JSON.parse(
          await readFile(
            path.join(directory, entry.name, "adapter.json"),
            "utf8",
          ),
        ) as unknown,
      );
      const expectedModuleSpecifier = `./${path.posix.join(
        path.posix.dirname(filePath),
        manifest.entry,
      )}`;
      if (manifest.registration.moduleSpecifier !== expectedModuleSpecifier) {
        throw new Error(
          `registration.moduleSpecifier must be ${expectedModuleSpecifier} for ${filePath}.`,
        );
      }
      adapters.push({ filePath, manifest });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      issues.push({
        filePath,
        message:
          error instanceof Error
            ? error.message
            : "Unable to parse adapter manifest",
      });
    }
  }
  return { adapters, issues };
}

function conformanceCheck(
  id: AdapterScaffoldConformanceCheck["id"],
  status: AdapterScaffoldConformanceCheck["status"],
  detail: string,
): AdapterScaffoldConformanceCheck {
  return { id, status, detail };
}

function adapterExportsForKind(
  loaded: Readonly<Record<string, unknown>>,
  kind: AdapterScaffoldKind,
): unknown[] {
  const value =
    kind === "framework"
      ? (loaded.frameworkAdapters ?? loaded.frameworkAdapter ?? loaded.default)
      : kind === "component-preview"
        ? (loaded.componentPreviewAdapters ??
          loaded.componentPreviewAdapter ??
          loaded.default)
        : kind === "api-endpoint"
          ? (loaded.apiEndpointAdapters ??
            loaded.apiEndpointAdapter ??
            loaded.default)
          : kind === "flow-discovery"
            ? (loaded.flowDiscoveryAdapters ??
              loaded.flowDiscoveryAdapter ??
              loaded.default)
          : (loaded.applicationRuntimeAdapters ??
            loaded.applicationRuntimeAdapter ??
            loaded.default);
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function emptyFrameworkContext(projectRoot: string): FrameworkAdapterContext {
  return {
    rootDir: projectRoot,
    files: [],
    packageNames: new Set(),
    readFile: async (filePath) => {
      throw new Error(
        `The empty conformance snapshot does not contain ${filePath}.`,
      );
    },
  };
}

async function verifyEmptyContext(
  kind: AdapterScaffoldKind,
  adapter: unknown,
  projectRoot: string,
): Promise<string> {
  if (kind === "framework") {
    const scan = await createFrameworkAdapterRegistry([
      adapter as FrameworkAdapter,
    ]).scan(emptyFrameworkContext(projectRoot));
    return `Valid empty-workspace result: ${scan.frameworks.length} framework matches and ${scan.routes.length} routes.`;
  }
  if (kind === "component-preview") {
    const registry = createComponentPreviewAdapterRegistry([
      adapter as ComponentPreviewAdapter,
    ]);
    const scan = await registry.scan(emptyFrameworkContext(projectRoot));
    for (const { preview } of scan.previews) {
      await registry.resolveCaptureUrl(preview, {
        baseUrls: {
          [preview.adapterId]: "http://127.0.0.1:6100/",
        },
      });
    }
    return `Valid empty-workspace result: ${scan.previews.length} previews and ${scan.previews.length} capture URLs.`;
  }
  if (kind === "api-endpoint") {
    const scan = await createApiEndpointAdapterRegistry([
      adapter as ApiEndpointAdapter,
    ]).scan(emptyFrameworkContext(projectRoot));
    return `Valid empty-workspace result: ${scan.endpoints.length} API endpoints and ${scan.issues.length} issues.`;
  }
  if (kind === "flow-discovery") {
    const scan = await createFlowDiscoveryAdapterRegistry([
      adapter as FlowDiscoveryAdapter,
    ]).scan({ ...emptyFrameworkContext(projectRoot), screens: [] });
    return `Valid empty-workspace result: ${scan.transitions.length} flow transitions and ${scan.issues.length} issues.`;
  }
  const resolved = await resolveApplicationRuntimeAdapter(
    {
      rootDir: projectRoot,
      baseUrl: "http://127.0.0.1:3000/",
      host: "127.0.0.1",
      port: 3000,
      packageManager: "pnpm",
      scripts: {},
      dependencies: new Set(),
    },
    [adapter as ApplicationRuntimeAdapter],
  );
  return resolved
    ? `Valid empty-workspace runtime match from ${resolved.adapterId}.`
    : "Valid empty-workspace no-match result.";
}

async function verifyInspectedAdapter(
  projectRoot: string,
  inspected: InspectedAdapterScaffold,
  cacheKey: number,
): Promise<AdapterScaffoldConformanceResult> {
  const { manifest } = inspected;
  const checks: AdapterScaffoldConformanceCheck[] = [
    conformanceCheck(
      "manifest",
      "pass",
      `Schema version 1 manifest declares ${manifest.kind} adapter ${manifest.id}.`,
    ),
  ];
  let adapter: unknown;
  try {
    const modulePath = path.resolve(
      projectRoot,
      manifest.registration.moduleSpecifier,
    );
    await assertNoLinkedPathSegments(projectRoot, modulePath);
    await assertPhysicalContainment(projectRoot, modulePath);
    const loaded = (await import(
      `${pathToFileURL(modulePath).href}?topo-conformance=${cacheKey}`
    )) as Record<string, unknown>;
    const exported = adapterExportsForKind(loaded, manifest.kind);
    if (exported.length !== 1) {
      throw new Error(
        `Expected exactly one ${manifest.kind} adapter export; received ${exported.length}.`,
      );
    }
    [adapter] = exported;
    checks.push(
      conformanceCheck(
        "module",
        "pass",
        `Loaded one adapter from ${manifest.registration.moduleSpecifier}.`,
      ),
    );
  } catch (error) {
    checks.push(
      conformanceCheck(
        "module",
        "fail",
        error instanceof Error
          ? error.message
          : "Unable to load adapter module.",
      ),
      conformanceCheck(
        "identity",
        "fail",
        "Manifest identity was not evaluated because the module did not load.",
      ),
      conformanceCheck(
        "empty-context",
        "fail",
        "The adapter contract was not evaluated because the module did not load.",
      ),
    );
    return {
      id: manifest.id,
      kind: manifest.kind,
      displayName: manifest.displayName,
      manifestPath: inspected.filePath,
      moduleSpecifier: manifest.registration.moduleSpecifier,
      status: "fail",
      checks,
    };
  }

  const candidate = adapter as { id?: unknown; displayName?: unknown };
  const identityPasses =
    candidate?.id === manifest.id &&
    candidate?.displayName === manifest.displayName;
  checks.push(
    conformanceCheck(
      "identity",
      identityPasses ? "pass" : "fail",
      identityPasses
        ? "Module id and display name exactly match adapter.json."
        : `Expected id ${manifest.id} and display name ${manifest.displayName}; received ${String(candidate?.id)} and ${String(candidate?.displayName)}.`,
    ),
  );
  try {
    checks.push(
      conformanceCheck(
        "empty-context",
        "pass",
        await verifyEmptyContext(manifest.kind, adapter, projectRoot),
      ),
    );
  } catch (error) {
    checks.push(
      conformanceCheck(
        "empty-context",
        "fail",
        error instanceof Error
          ? error.message
          : "Adapter execution failed against the empty workspace context.",
      ),
    );
  }
  return {
    id: manifest.id,
    kind: manifest.kind,
    displayName: manifest.displayName,
    manifestPath: inspected.filePath,
    moduleSpecifier: manifest.registration.moduleSpecifier,
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks,
  };
}

/**
 * Loads local adapter modules and exercises their public contracts against a
 * deterministic read-only empty workspace. This never starts an app server.
 */
export async function verifyAdapterScaffolds(
  projectRootValue: string,
  options: VerifyAdapterScaffoldsOptions = {},
): Promise<AdapterScaffoldConformanceReport> {
  const projectRoot = await realpath(path.resolve(projectRootValue));
  const inspection = await inspectAdapterScaffolds(projectRoot);
  const selected = options.id
    ? inspection.adapters.filter(({ manifest }) => manifest.id === options.id)
    : inspection.adapters;
  const issues = [...inspection.issues];
  if (selected.length === 0) {
    issues.push({
      filePath: "topo/adapters",
      message: options.id
        ? `No local adapter manifest declares id ${options.id}.`
        : "No local adapter manifests were found.",
    });
  }
  const adapters = await Promise.all(
    selected.map((adapter, index) =>
      verifyInspectedAdapter(projectRoot, adapter, Date.now() + index),
    ),
  );
  const passed = adapters.filter((adapter) => adapter.status === "pass").length;
  const failed = adapters.length - passed;
  return {
    schemaVersion: ADAPTER_SCAFFOLD_CHECK_VERSION,
    status: failed === 0 && issues.length === 0 ? "pass" : "fail",
    projectRoot,
    ...(options.id ? { selectedId: options.id } : {}),
    summary: {
      checked: adapters.length,
      passed,
      failed,
      issues: issues.length,
      malformed: inspection.issues.length,
    },
    adapters,
    issues,
  };
}

export async function planAdapterScaffold(
  input: PlanAdapterScaffoldInput,
): Promise<AdapterScaffoldPlan> {
  const projectRoot = await realpath(path.resolve(input.projectRoot));
  const kind = AdapterScaffoldKindSchema.parse(input.kind);
  const id = assertIdentifier(input.id);
  const displayName = assertDisplayName(input.displayName);
  const outputDirectory = assertAdapterCatalogDirectory(
    input.outputDirectory ?? defaultOutputDirectory(id),
  );
  const outputPath = path.resolve(projectRoot, ...outputDirectory.split("/"));
  const relative = path.relative(projectRoot, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "Adapter output must remain inside the selected project root.",
    );
  }
  await assertNoLinkedPathSegments(projectRoot, outputPath);
  const registration = registrationFor(kind, outputDirectory);
  const conflicts = (await pathExists(outputPath))
    ? [`${outputDirectory} already exists`]
    : [];
  return {
    schemaVersion: 1,
    status: conflicts.length ? "conflict" : "ready",
    projectRoot,
    outputDirectory,
    kind,
    id,
    displayName,
    registration,
    files: scaffoldFiles(kind, id, displayName, registration),
    conflicts,
  };
}

export async function applyAdapterScaffold(
  plan: AdapterScaffoldPlan,
): Promise<AdapterScaffoldResult> {
  if (plan.schemaVersion !== 1) {
    throw new Error("Unsupported adapter scaffold plan schema version.");
  }
  if (plan.status !== "ready" || plan.conflicts.length) {
    throw new Error("Adapter scaffold has conflicts; no files were changed.");
  }
  const projectRoot = await realpath(path.resolve(plan.projectRoot));
  const outputDirectory = assertAdapterCatalogDirectory(plan.outputDirectory);
  const outputPath = path.resolve(projectRoot, ...outputDirectory.split("/"));
  const relative = path.relative(projectRoot, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "Adapter output must remain inside the selected project root.",
    );
  }
  await assertNoLinkedPathSegments(projectRoot, outputPath);
  const kind = AdapterScaffoldKindSchema.parse(plan.kind);
  const id = assertIdentifier(plan.id);
  const displayName = assertDisplayName(plan.displayName);
  const expectedRegistration = registrationFor(kind, outputDirectory);
  if (
    plan.registration.configKey !== expectedRegistration.configKey ||
    plan.registration.moduleSpecifier !==
      expectedRegistration.moduleSpecifier ||
    plan.registration.snippet !== expectedRegistration.snippet
  ) {
    throw new Error("Adapter scaffold plan has invalid registration metadata.");
  }
  const expectedFiles = scaffoldFiles(
    kind,
    id,
    displayName,
    expectedRegistration,
  );
  if (
    plan.files.length !== expectedFiles.length ||
    plan.files.some(
      (file, index) =>
        file.path !== expectedFiles[index]?.path ||
        file.content !== expectedFiles[index]?.content,
    )
  ) {
    throw new Error("Adapter scaffold plan has an invalid scaffold file set.");
  }
  if (await pathExists(outputPath)) {
    throw new Error(
      `Adapter scaffold target ${outputDirectory} now exists; no files were changed.`,
    );
  }
  const parent = path.dirname(outputPath);
  await mkdir(parent, { recursive: true });
  await assertNoLinkedPathSegments(projectRoot, parent);
  await assertPhysicalContainment(projectRoot, parent);
  const temporaryDirectory = await mkdtemp(
    path.join(parent, `.${path.basename(outputPath)}.topo-`),
  );
  try {
    await assertPhysicalContainment(projectRoot, temporaryDirectory);
    for (const file of expectedFiles) {
      await writeFile(path.join(temporaryDirectory, file.path), file.content, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    await assertNoLinkedPathSegments(projectRoot, parent);
    await assertPhysicalContainment(projectRoot, parent);
    if (await pathExists(outputPath)) {
      throw new Error(
        `Adapter scaffold target ${outputDirectory} now exists; no files were changed.`,
      );
    }
    await rename(temporaryDirectory, outputPath);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return {
    schemaVersion: 1,
    status: "created",
    projectRoot,
    outputDirectory,
    manifestPath: path.posix.join(outputDirectory, "adapter.json"),
    createdPaths: expectedFiles.map((file) =>
      path.posix.join(outputDirectory, file.path),
    ),
    registration: expectedRegistration,
  };
}
