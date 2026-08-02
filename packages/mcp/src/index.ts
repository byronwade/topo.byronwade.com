import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  LLM_CONTEXT_JSON_SCHEMA,
  LLM_CONTEXT_KINDS,
  LlmContextKindSchema,
  LlmContextManifestSchema,
  LlmContextRecordSchema,
  getLlmContextRecord,
  queryLlmContext,
  renderLlmContextMarkdown,
  renderLlmQueryMarkdown,
  type LlmContext,
  type ComponentPreviewImageArtifact,
  type SnapshotArtifact,
  type VisualImageArtifact,
} from "@topo/llm-context";
import {
  createAtlasScene,
  createComponentScene,
  createFlowScene,
} from "@topo/layout";
import {
  AtlasSceneSchema,
  ComponentSceneSchema,
  FlowSceneSchema,
} from "@topo/layout/schema";
import { ApplicationGraphSchema, FlowSchema, type Flow } from "@topo/schema";
import { z } from "zod";

export interface McpServerHandlers {
  getContext(): Promise<LlmContext>;
  getSnapshotArtifact?(id: string): Promise<SnapshotArtifact | undefined>;
  getComponentPreviewArtifact?(
    id: string,
  ): Promise<ComponentPreviewImageArtifact | undefined>;
  getVisualBaselineArtifact?(
    id: string,
  ): Promise<VisualImageArtifact | undefined>;
  getVisualComparisonArtifact?(
    id: string,
  ): Promise<VisualImageArtifact | undefined>;
  exportReview?(): Promise<string>;
}

const ReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const ResponseFormatSchema = z.enum(["json", "markdown"]).default("json");
const QueryOutputSchema = z.object({
  total: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  items: z.array(LlmContextRecordSchema),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().optional(),
});

function text(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function toolResult(
  structuredContent: Record<string, unknown>,
  rendered?: string,
) {
  return {
    content: [
      { type: "text" as const, text: rendered ?? text(structuredContent) },
    ],
    structuredContent,
  };
}

function toolError(error: unknown, suggestion: string) {
  const message =
    error instanceof Error ? error.message : "Unknown Topo MCP error";
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Topo could not complete this read: ${message}. ${suggestion}`,
      },
    ],
  };
}

function manifestMarkdown(context: LlmContext): string {
  const lines = [
    "# Topo context index",
    "",
    `- Framework: ${context.manifest.project.framework}`,
    `- Records: ${context.manifest.totalRecords}`,
    `- Generated: ${context.manifest.generatedAt}`,
    "",
    "## Available record kinds",
    "",
    ...context.manifest.kinds.map(
      (item) =>
        `- **${item.kind}** (${context.manifest.counts[item.kind] ?? 0}): ${item.description}`,
    ),
  ];
  return lines.join("\n");
}

function flowsFromContext(context: LlmContext): Flow[] {
  return context.records.flatMap((record) => {
    if (record.kind !== "flow") return [];
    const parsed = FlowSchema.safeParse(record.data);
    return parsed.success ? [parsed.data] : [];
  });
}

export function createMcpServer(handlers: McpServerHandlers): McpServer {
  const server = new McpServer({ name: "topo-mcp-server", version: "0.1.0" });

  server.registerResource(
    "topo-context-manifest",
    "topo://project/manifest",
    {
      title: "Topo context manifest",
      description:
        "Version, counts, record-kind catalog, warnings, and generated context files.",
      mimeType: "application/json",
    },
    async (uri) => {
      const context = await handlers.getContext();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: text(context.manifest),
          },
        ],
      };
    },
  );

  server.registerResource(
    "topo-context-summary",
    "topo://project/context",
    {
      title: "Topo context summary",
      description:
        "Compact Markdown discovery view. Use query tools for complete bounded reads.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const context = await handlers.getContext();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderLlmContextMarkdown(context),
          },
        ],
      };
    },
  );

  server.registerResource(
    "topo-context-schema",
    "topo://project/schema",
    {
      title: "Topo context JSON Schema",
      description:
        "Machine-readable schema for every Topo LLM context record envelope.",
      mimeType: "application/schema+json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/schema+json",
          text: text(LLM_CONTEXT_JSON_SCHEMA),
        },
      ],
    }),
  );

  server.registerResource(
    "topo-application-graph",
    "topo://project/graph",
    {
      title: "Topo normalized application graph",
      description:
        "Complete normalized graph of screens, components, edges, and findings.",
      mimeType: "application/json",
    },
    async (uri) => {
      const context = await handlers.getContext();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: text(context.graph),
          },
        ],
      };
    },
  );

  server.registerResource(
    "topo-atlas-scene",
    "topo://project/atlas",
    {
      title: "Topo application atlas scene",
      description:
        "Deterministic route groups, screen positions, whole-scene bounds, selection bounds, and graph connections.",
      mimeType: "application/json",
    },
    async (uri) => {
      const context = await handlers.getContext();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: text(
              createAtlasScene(context.graph, undefined, {
                routeOrganization: context.manifest.project.atlas,
              }),
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "topo-component-scene",
    "topo://project/components",
    {
      title: "Topo component coverage scene",
      description:
        "Deterministic component coverage groups and exact selected-component route usage geometry.",
      mimeType: "application/json",
    },
    async (uri) => {
      const context = await handlers.getContext();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: text(
              createComponentScene(context.graph, undefined, {
                organization: context.manifest.project.atlas,
              }),
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "topo-flow-scene",
    "topo://project/flows",
    {
      title: "Topo directed flow scene",
      description:
        "Deterministic flow lanes, explicit next-step edges, route resolution evidence, and scene bounds.",
      mimeType: "application/json",
    },
    async (uri) => {
      const context = await handlers.getContext();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: text(
              createFlowScene(context.graph, flowsFromContext(context)),
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "topo-component-previews",
    "topo://project/component-previews",
    {
      title: "Topo component preview captures",
      description:
        "Bounded first page of component preview capture metadata and component relationships. Use topo_list_component_previews for pagination.",
      mimeType: "application/json",
    },
    async (uri) => {
      const result = queryLlmContext(await handlers.getContext(), {
        kinds: ["component-preview"],
        limit: 100,
        offset: 0,
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: text(result),
          },
        ],
      };
    },
  );

  server.registerResource(
    "topo-visual-evidence",
    "topo://project/visuals",
    {
      title: "Topo visual baselines and comparisons",
      description:
        "Accepted screen baselines and latest deterministic pixel-comparison records.",
      mimeType: "application/json",
    },
    async (uri) => {
      const result = queryLlmContext(await handlers.getContext(), {
        kinds: ["visual-baseline", "visual-comparison"],
        limit: 100,
        offset: 0,
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: text(result),
          },
        ],
      };
    },
  );

  server.registerResource(
    "topo-context-entity",
    new ResourceTemplate("topo://entity/{kind}/{id}", {
      list: undefined,
      complete: { kind: () => [...LLM_CONTEXT_KINDS] },
    }),
    {
      title: "Topo context entity",
      description:
        "One exact context record addressed by kind and URL-encoded ID.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const kind = LlmContextKindSchema.parse(String(variables.kind));
      const id = decodeURIComponent(String(variables.id));
      const item = getLlmContextRecord(await handlers.getContext(), kind, id);
      if (!item) throw new Error(`No ${kind} record exists with id "${id}"`);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: text(item) },
        ],
      };
    },
  );

  if (handlers.getSnapshotArtifact) {
    server.registerResource(
      "topo-snapshot-image",
      new ResourceTemplate("topo://snapshot/{id}/image", { list: undefined }),
      {
        title: "Topo snapshot image",
        description:
          "Captured application screen image. Metadata is available as a snapshot context record.",
        mimeType: "image/png",
      },
      async (uri, variables) => {
        const id = decodeURIComponent(String(variables.id));
        const artifact = await handlers.getSnapshotArtifact?.(id);
        if (!artifact)
          throw new Error(`No captured image exists for snapshot "${id}"`);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: artifact.mimeType,
              blob: artifact.data.toString("base64"),
            },
          ],
        };
      },
    );
  }

  if (handlers.getComponentPreviewArtifact) {
    server.registerResource(
      "topo-component-preview-image",
      new ResourceTemplate("topo://component-preview/{id}/image", {
        list: undefined,
      }),
      {
        title: "Topo component preview image",
        description:
          "Captured component variant image. Metadata and source identity are available as a component-preview context record.",
        mimeType: "image/png",
      },
      async (uri, variables) => {
        const id = decodeURIComponent(String(variables.id));
        const artifact = await handlers.getComponentPreviewArtifact?.(id);
        if (!artifact) {
          throw new Error(
            `No captured image exists for component preview "${id}"`,
          );
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: artifact.mimeType,
              blob: artifact.data.toString("base64"),
            },
          ],
        };
      },
    );
  }

  if (handlers.getVisualBaselineArtifact) {
    server.registerResource(
      "topo-visual-baseline-image",
      new ResourceTemplate("topo://visual-baseline/{id}/image", {
        list: undefined,
      }),
      {
        title: "Topo visual baseline image",
        description:
          "Explicitly accepted screen baseline image with metadata in the matching visual-baseline record.",
        mimeType: "image/png",
      },
      async (uri, variables) => {
        const id = decodeURIComponent(String(variables.id));
        const artifact = await handlers.getVisualBaselineArtifact?.(id);
        if (!artifact)
          throw new Error(
            `No baseline image exists for visual baseline "${id}"`,
          );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: artifact.mimeType,
              blob: artifact.data.toString("base64"),
            },
          ],
        };
      },
    );
  }

  if (handlers.getVisualComparisonArtifact) {
    server.registerResource(
      "topo-visual-comparison-image",
      new ResourceTemplate("topo://visual-comparison/{id}/image", {
        list: undefined,
      }),
      {
        title: "Topo visual comparison image",
        description:
          "Pixel-diff image with metrics in the matching visual-comparison record.",
        mimeType: "image/png",
      },
      async (uri, variables) => {
        const id = decodeURIComponent(String(variables.id));
        const artifact = await handlers.getVisualComparisonArtifact?.(id);
        if (!artifact)
          throw new Error(`No diff image exists for visual comparison "${id}"`);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: artifact.mimeType,
              blob: artifact.data.toString("base64"),
            },
          ],
        };
      },
    );
  }

  server.registerTool(
    "topo_get_context_index",
    {
      title: "Get Topo context index",
      description:
        "Discover every LLM-readable Topo record kind, count, source of truth, warning, and export file.",
      inputSchema: { response_format: ResponseFormatSchema },
      outputSchema: LlmContextManifestSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ response_format }) => {
      try {
        const context = await handlers.getContext();
        return toolResult(
          context.manifest as unknown as Record<string, unknown>,
          response_format === "markdown"
            ? manifestMarkdown(context)
            : undefined,
        );
      } catch (error) {
        return toolError(
          error,
          "Verify the project can be scanned with `topo scan`.",
        );
      }
    },
  );

  server.registerTool(
    "topo_query_context",
    {
      title: "Query Topo context",
      description:
        "Search and paginate adapters, routes, screens, components, component previews, notes, flows, findings, snapshots, visual baselines, visual comparisons, jobs, and read issues.",
      inputSchema: {
        query: z
          .string()
          .max(500)
          .optional()
          .describe(
            "Words that must appear in the record ID, title, summary, or text.",
          ),
        kinds: z
          .array(LlmContextKindSchema)
          .max(LLM_CONTEXT_KINDS.length)
          .optional(),
        route_path: z.string().startsWith("/").optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
        response_format: ResponseFormatSchema,
      },
      outputSchema: QueryOutputSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ query, kinds, route_path, limit, offset, response_format }) => {
      try {
        const result = queryLlmContext(await handlers.getContext(), {
          query,
          kinds,
          routePath: route_path,
          limit,
          offset,
        });
        return toolResult(
          result as unknown as Record<string, unknown>,
          response_format === "markdown"
            ? renderLlmQueryMarkdown(result)
            : undefined,
        );
      } catch (error) {
        return toolError(
          error,
          "Reduce the requested kinds or limit and try again.",
        );
      }
    },
  );

  server.registerTool(
    "topo_get_entity",
    {
      title: "Get one Topo entity",
      description:
        "Read one exact, complete context record by its kind and stable ID.",
      inputSchema: {
        kind: LlmContextKindSchema,
        id: z.string().min(1).max(2000),
        response_format: ResponseFormatSchema,
      },
      outputSchema: LlmContextRecordSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ kind, id, response_format }) => {
      try {
        const item = getLlmContextRecord(await handlers.getContext(), kind, id);
        if (!item)
          return toolError(
            new Error(`No ${kind} record exists with id "${id}"`),
            "Call topo_query_context to discover valid IDs.",
          );
        const rendered =
          response_format === "markdown"
            ? renderLlmQueryMarkdown({
                total: 1,
                count: 1,
                offset: 0,
                items: [item],
                hasMore: false,
              })
            : undefined;
        return toolResult(item as unknown as Record<string, unknown>, rendered);
      } catch (error) {
        return toolError(
          error,
          "Call topo_get_context_index to inspect supported record kinds.",
        );
      }
    },
  );

  server.registerTool(
    "topo_get_graph",
    {
      title: "Get Topo application graph",
      description:
        "Read the complete normalized graph. Prefer topo_query_context for large projects.",
      inputSchema: {},
      outputSchema: ApplicationGraphSchema,
      annotations: ReadOnlyAnnotations,
    },
    async () => {
      try {
        const context = await handlers.getContext();
        const graph = context.graph;
        return toolResult(graph as unknown as Record<string, unknown>);
      } catch (error) {
        return toolError(
          error,
          "Verify the framework adapter can scan this workspace.",
        );
      }
    },
  );

  server.registerTool(
    "topo_get_atlas_scene",
    {
      title: "Get Topo application atlas scene",
      description:
        "Read the deterministic, renderer-neutral route-group layout and connection geometry for the whole application, anchored to an optional selected screen.",
      inputSchema: {
        selected_screen_id: z.string().min(1).max(2000).optional(),
      },
      outputSchema: AtlasSceneSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ selected_screen_id }) => {
      try {
        const context = await handlers.getContext();
        const graph = context.graph;
        if (
          selected_screen_id &&
          !graph.screens.some((screen) => screen.id === selected_screen_id)
        ) {
          return toolError(
            new Error(`Unknown selected screen: ${selected_screen_id}`),
            "Call topo_list_routes or topo_get_graph to discover valid screen IDs.",
          );
        }
        const scene = createAtlasScene(graph, selected_screen_id, {
          routeOrganization: context.manifest.project.atlas,
        });
        return toolResult(scene as unknown as Record<string, unknown>);
      } catch (error) {
        return toolError(
          error,
          "Verify the application graph can be read and try again.",
        );
      }
    },
  );

  server.registerTool(
    "topo_get_component_scene",
    {
      title: "Get Topo component coverage scene",
      description:
        "Read deterministic component positions, coverage groups, and exact route consumers for an optional selected component.",
      inputSchema: {
        selected_component_id: z.string().min(1).max(2000).optional(),
      },
      outputSchema: ComponentSceneSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ selected_component_id }) => {
      try {
        const context = await handlers.getContext();
        const graph = context.graph;
        if (
          selected_component_id &&
          !graph.components.some(
            (component) => component.id === selected_component_id,
          )
        ) {
          return toolError(
            new Error(`Unknown selected component: ${selected_component_id}`),
            "Call topo_query_context with kind component to discover valid component IDs.",
          );
        }
        const scene = createComponentScene(graph, selected_component_id, {
          organization: context.manifest.project.atlas,
        });
        return toolResult(scene as unknown as Record<string, unknown>);
      } catch (error) {
        return toolError(
          error,
          "Verify the application graph can be read and try again.",
        );
      }
    },
  );

  server.registerTool(
    "topo_get_flow_scene",
    {
      title: "Get Topo directed flow scene",
      description:
        "Read deterministic flow lanes and explicit next-step geometry, anchored to an optional flow and step.",
      inputSchema: {
        selected_flow_id: z.string().min(1).max(2000).optional(),
        selected_step_id: z.string().min(1).max(2000).optional(),
      },
      outputSchema: FlowSceneSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ selected_flow_id, selected_step_id }) => {
      try {
        const context = await handlers.getContext();
        const flows = flowsFromContext(context);
        const selectedFlow = selected_flow_id
          ? flows.find((flow) => flow.id === selected_flow_id)
          : flows[0];
        if (selected_flow_id && !selectedFlow) {
          return toolError(
            new Error(`Unknown selected flow: ${selected_flow_id}`),
            "Call topo_list_flows to discover valid flow IDs.",
          );
        }
        if (
          selected_step_id &&
          !selectedFlow?.steps.some((step) => step.id === selected_step_id)
        ) {
          return toolError(
            new Error(`Unknown selected step: ${selected_step_id}`),
            "Read the flow record to discover valid step IDs.",
          );
        }
        const scene = createFlowScene(
          context.graph,
          flows,
          selectedFlow?.id,
          selected_step_id,
        );
        return toolResult(scene as unknown as Record<string, unknown>);
      } catch (error) {
        return toolError(
          error,
          "Verify flow records and the application graph are readable.",
        );
      }
    },
  );

  for (const [toolName, kind, description] of [
    [
      "topo_list_findings",
      "finding",
      "List diagnostic findings with bounded pagination.",
    ],
    [
      "topo_list_notes",
      "note",
      "List Markdown-backed notes with bounded pagination.",
    ],
    ["topo_list_flows", "flow", "List user flows with bounded pagination."],
    [
      "topo_list_component_previews",
      "component-preview",
      "List captured component preview variants with source and binary resource identities.",
    ],
    [
      "topo_list_visual_comparisons",
      "visual-comparison",
      "List latest screen pixel comparisons with baseline relationships and diff resource identities.",
    ],
    [
      "topo_list_routes",
      "route",
      "List normalized routes with bounded pagination.",
    ],
  ] as const) {
    server.registerTool(
      toolName,
      {
        title: description,
        description,
        inputSchema: {
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
          response_format: ResponseFormatSchema,
        },
        outputSchema: QueryOutputSchema,
        annotations: ReadOnlyAnnotations,
      },
      async ({ limit, offset, response_format }) => {
        try {
          const result = queryLlmContext(await handlers.getContext(), {
            kinds: [kind],
            limit,
            offset,
          });
          return toolResult(
            result as unknown as Record<string, unknown>,
            response_format === "markdown"
              ? renderLlmQueryMarkdown(result)
              : undefined,
          );
        } catch (error) {
          return toolError(
            error,
            "Call topo_get_context_index to inspect current context availability.",
          );
        }
      },
    );
  }

  if (handlers.exportReview) {
    server.registerTool(
      "topo_export_review",
      {
        title: "Render Topo review Markdown",
        description:
          "Render the current graph, findings, and notes as Markdown without writing a file.",
        inputSchema: {},
        outputSchema: { markdown: z.string() },
        annotations: ReadOnlyAnnotations,
      },
      async () => {
        try {
          const markdown = await handlers.exportReview?.();
          return toolResult({ markdown: markdown ?? "" }, markdown);
        } catch (error) {
          return toolError(
            error,
            "Verify notes and graph records are readable.",
          );
        }
      },
    );
  }

  server.registerPrompt(
    "topo_review_application",
    {
      title: "Review a Topo application atlas",
      description:
        "Start a source-grounded application review using bounded Topo context reads.",
      argsSchema: { focus: z.string().max(500).optional() },
    },
    ({ focus }) => ({
      description:
        "Review the application using Topo's canonical context records.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read topo://project/manifest first. Use topo_query_context with pagination; follow source and relationship fields rather than guessing. Review adapters, routes, flows, notes, findings, and coverage${focus ? ` with this focus: ${focus}` : ""}. Never request preview-profile secrets because Topo intentionally excludes them.`,
          },
        },
      ],
    }),
  );

  return server;
}

export async function runMcpStdio(handlers: McpServerHandlers): Promise<void> {
  const server = createMcpServer(handlers);
  await server.connect(new StdioServerTransport());
}
