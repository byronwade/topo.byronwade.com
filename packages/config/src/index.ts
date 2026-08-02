import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { createJiti } from "jiti";
import { z } from "zod";

import { StudioCustomizationSchema } from "@topo/protocol";
import {
  AtlasOrganizationSchema,
  ComponentPreviewReadinessSchema,
  PreviewRouteExamplesSchema,
} from "@topo/schema";

const WorkspacePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.startsWith("/") &&
      !value.split("/").includes(".."),
    "Expected a workspace-relative POSIX path without parent traversal",
  );

const ProjectRootDirSchema = z
  .string()
  .trim()
  .min(1, "Expected rootDir to identify an application directory")
  .max(4_096, "Expected rootDir to be at most 4096 characters")
  .refine(
    (value) => !value.includes("\0"),
    "Expected rootDir to be a filesystem path without null bytes",
  );

const ConfiguredComponentPreviewSchema = z.object({
  source: WorkspacePathSchema,
  exportName: z.string().min(1).default("default"),
  title: z.string().min(1).optional(),
  provenance: z.enum(["configured", "ai-accepted"]).default("configured"),
  readiness: ComponentPreviewReadinessSchema.optional(),
});

const ConfiguredComponentPreviewListSchema = z
  .union([
    ConfiguredComponentPreviewSchema,
    z.array(ConfiguredComponentPreviewSchema).min(1),
  ])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export type ConfiguredComponentPreview = z.infer<
  typeof ConfiguredComponentPreviewSchema
>;

const PreviewProfileSchema = z.object({
  name: z.string().min(1),
  headers: z.record(z.string()).default({}),
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string().optional(),
        path: z.string().optional(),
      }),
    )
    .default([]),
  localStorage: z.record(z.string()).default({}),
});

export type PreviewProfile = z.infer<typeof PreviewProfileSchema>;

const PreviewConfigSchema = z
  .object({
    baseUrl: z.string().url().default("http://localhost:3000"),
    server: z
      .object({
        /** Reuse a healthy origin, require an external origin, or own a process. */
        mode: z.enum(["auto", "external", "managed"]).default("auto"),
        /** Tokenized executable and arguments; never interpreted by a shell. */
        command: z.array(z.string().min(1)).min(1).optional(),
        /** Working directory relative to rootDir. */
        cwd: z.string().min(1).default("."),
        readyTimeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(300_000)
          .default(45_000),
      })
      .default({}),
    /** Keep route and component evidence current after watched source changes. */
    autoCapture: z.boolean().default(true),
    headless: z.boolean().default(true),
    executablePath: z.string().optional(),
    viewport: z
      .object({
        width: z.number().int().positive().default(1440),
        height: z.number().int().positive().default(1000),
      })
      .default({}),
    componentBaseUrls: z
      .record(z.string().url())
      .default({ storybook: "http://127.0.0.1:6006" }),
    /** Concrete local paths keyed by canonical parameterized route identity. */
    routes: PreviewRouteExamplesSchema,
    /** Explicit zero-prop preview exports keyed by the component source path. */
    components: z
      .record(WorkspacePathSchema, ConfiguredComponentPreviewListSchema)
      .default({}),
  })
  .default({});

export const TopoConfigSchema = z.object({
  rootDir: ProjectRootDirSchema.default("."),
  ignore: z.array(z.string()).default([]),
  extensions: z
    .object({
      frameworkAdapters: z.array(z.string().min(1)).default([]),
      apiEndpointAdapters: z.array(z.string().min(1)).default([]),
      flowAdapters: z.array(z.string().min(1)).default([]),
      componentPreviewAdapters: z.array(z.string().min(1)).default([]),
      applicationRuntimeAdapters: z.array(z.string().min(1)).default([]),
    })
    .default({}),
  daemon: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(1).max(65535).default(4599),
    })
    .default({}),
  preview: PreviewConfigSchema,
  atlas: AtlasOrganizationSchema,
  studio: StudioCustomizationSchema,
  profiles: z
    .array(PreviewProfileSchema)
    .default([
      { name: "Anonymous", headers: {}, cookies: [], localStorage: {} },
    ]),
});

export type TopoConfig = z.infer<typeof TopoConfigSchema>;

/**
 * One resolved Topo project. Durable `.topo` data belongs to `projectRoot`;
 * framework source and native application commands belong to `sourceRoot`.
 */
export interface TopoProject {
  readonly projectRoot: string;
  readonly sourceRoot: string;
  readonly configPath: string;
  readonly config: TopoConfig;
}

export class TopoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopoConfigError";
  }
}

export function defineConfig(
  config: z.input<typeof TopoConfigSchema> = {},
): TopoConfig {
  return TopoConfigSchema.parse(config);
}

export function defaultConfig(): TopoConfig {
  return defineConfig();
}

export async function loadConfig(cwd = process.cwd()): Promise<TopoConfig> {
  const configPath = path.resolve(cwd, "topo.config.ts");

  try {
    await access(configPath);
  } catch {
    return defaultConfig();
  }

  const jiti = createJiti(import.meta.url);
  const module = (await jiti.import(configPath)) as {
    default?: unknown;
    config?: unknown;
  };
  return TopoConfigSchema.parse(module.default ?? module.config ?? {});
}

export async function resolveProject(
  cwd = process.cwd(),
): Promise<TopoProject> {
  const projectRoot = path.resolve(cwd);
  const configPath = path.join(projectRoot, "topo.config.ts");
  const config = await loadConfig(projectRoot);
  const sourceRoot = path.resolve(projectRoot, config.rootDir);
  let physicalSourceRoot: string;
  try {
    physicalSourceRoot = await realpath(sourceRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TopoConfigError(
        `Configured application root does not exist: ${sourceRoot}`,
      );
    }
    throw error;
  }
  const sourceStats = await stat(physicalSourceRoot);
  if (!sourceStats.isDirectory()) {
    throw new TopoConfigError(
      `Configured application root is not a directory: ${sourceRoot}`,
    );
  }
  return Object.freeze({ projectRoot, sourceRoot, configPath, config });
}
