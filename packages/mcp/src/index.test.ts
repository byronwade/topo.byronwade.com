import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createMcpEvaluationContext } from "./evaluation-fixture.js";
import { createMcpServer } from "./index.js";

async function connectedClient() {
  const context = createMcpEvaluationContext();
  const server = createMcpServer({
    getContext: async () => context,
    getComponentPreviewArtifact: async (id) =>
      id === "component-preview:status-card:default"
        ? {
            id,
            artifactPath: ".topo/previews/status-card-default.png",
            mimeType: "image/png" as const,
            data: Buffer.from("preview-png"),
          }
        : undefined,
    getVisualBaselineArtifact: async (id) =>
      id === "visual-baseline:dashboard"
        ? {
            id,
            artifactPath: ".topo/snapshots/dashboard-baseline.png",
            mimeType: "image/png" as const,
            data: Buffer.from("baseline-png"),
          }
        : undefined,
    getVisualComparisonArtifact: async (id) =>
      id === "visual-comparison:dashboard"
        ? {
            id,
            artifactPath: ".topo/comparisons/dashboard.png",
            mimeType: "image/png" as const,
            data: Buffer.from("comparison-png"),
          }
        : undefined,
    exportReview: async () => "# Review",
  });
  const client = new Client({ name: "topo-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP server", () => {
  it("exposes discoverable resources, bounded tools, and structured content", async () => {
    const { client, server } = await connectedClient();
    try {
      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain(
        "topo://project/manifest",
      );
      expect(resources.resources.map((resource) => resource.uri)).toContain(
        "topo://project/atlas",
      );
      expect(resources.resources.map((resource) => resource.uri)).toContain(
        "topo://project/components",
      );
      expect(resources.resources.map((resource) => resource.uri)).toContain(
        "topo://project/flows",
      );
      expect(resources.resources.map((resource) => resource.uri)).toContain(
        "topo://project/component-previews",
      );
      expect(resources.resources.map((resource) => resource.uri)).toContain(
        "topo://project/visuals",
      );
      const templates = await client.listResourceTemplates();
      expect(
        templates.resourceTemplates.map((template) => template.uriTemplate),
      ).toContain("topo://component-preview/{id}/image");
      expect(
        templates.resourceTemplates.map((template) => template.uriTemplate),
      ).toContain("topo://visual-baseline/{id}/image");
      expect(
        templates.resourceTemplates.map((template) => template.uriTemplate),
      ).toContain("topo://visual-comparison/{id}/image");
      const baselineImage = await client.readResource({
        uri: "topo://visual-baseline/visual-baseline%3Adashboard/image",
      });
      expect(baselineImage.contents[0]).toMatchObject({
        mimeType: "image/png",
        blob: Buffer.from("baseline-png").toString("base64"),
      });
      const manifest = await client.readResource({
        uri: "topo://project/manifest",
      });
      expect(JSON.stringify(manifest.contents)).toContain("totalRecords");
      const atlasResource = await client.readResource({
        uri: "topo://project/atlas",
      });
      const atlasResourceScene = JSON.parse(
        (atlasResource.contents[0] as { text: string }).text,
      ) as { routeMap: { groups: Array<{ id: string; label: string }> } };
      expect(atlasResourceScene.routeMap.groups).toMatchObject([
        { id: "/", label: "Entry" },
        { id: "workspace", label: "Workspace" },
      ]);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain(
        "topo_query_context",
      );
      expect(tools.tools.map((tool) => tool.name)).toContain(
        "topo_list_component_previews",
      );
      const previews = await client.callTool({
        name: "topo_list_component_previews",
        arguments: { limit: 10, offset: 0, response_format: "json" },
      });
      expect(previews.structuredContent).toMatchObject({
        count: 1,
        items: [
          expect.objectContaining({
            kind: "component-preview",
            id: "component-preview:status-card:default",
          }),
        ],
      });
      const called = await client.callTool({
        name: "topo_query_context",
        arguments: {
          kinds: ["route"],
          limit: 1,
          offset: 0,
          response_format: "json",
        },
      });
      expect(called.structuredContent).toMatchObject({
        count: 1,
        hasMore: true,
        nextOffset: 1,
      });
      const routeHierarchy = await client.callTool({
        name: "topo_get_entity",
        arguments: {
          kind: "route",
          id: "route:next-app:/dashboard/customers",
          response_format: "json",
        },
      });
      expect(routeHierarchy.structuredContent).toMatchObject({
        kind: "route",
        id: "route:next-app:/dashboard/customers",
        relationships: expect.arrayContaining([
          {
            type: "parent-route",
            targetKind: "route",
            targetId: "route:next-app:/dashboard",
          },
        ]),
        data: {
          atlas: {
            hierarchy: {
              level: 1,
              parentRouteId: "route:next-app:/dashboard",
              childRouteIds: [],
            },
          },
        },
      });
      const probes = await client.callTool({
        name: "topo_query_context",
        arguments: {
          query: "delete destructive",
          kinds: ["interaction-probe"],
          limit: 10,
          offset: 0,
          response_format: "json",
        },
      });
      expect(probes.structuredContent).toMatchObject({
        count: 1,
        items: [
          expect.objectContaining({
            kind: "interaction-probe",
            id: "interaction-probe:dashboard-delete",
          }),
        ],
      });
      const anchoredNote = await client.callTool({
        name: "topo_query_context",
        arguments: {
          query: "resolved drifted customer-table-row",
          kinds: ["note"],
          limit: 10,
          offset: 0,
          response_format: "json",
        },
      });
      expect(anchoredNote.structuredContent).toMatchObject({
        count: 1,
        items: [
          expect.objectContaining({
            id: "note:customer-table-fixture",
            data: expect.objectContaining({
              status: "resolved",
              anchor: expect.objectContaining({
                status: "drifted",
                testLocator: "customer-table-row",
              }),
            }),
          }),
        ],
      });
      const adapters = await client.callTool({
        name: "topo_query_context",
        arguments: {
          query: "framework acme routes",
          kinds: ["adapter"],
          limit: 10,
          offset: 0,
          response_format: "json",
        },
      });
      expect(adapters.structuredContent).toMatchObject({
        count: 1,
        items: [
          expect.objectContaining({
            kind: "adapter",
            id: "adapter:acme.routes",
          }),
        ],
      });
      const malformedAdapter = await client.callTool({
        name: "topo_query_context",
        arguments: {
          query: "Malformed adapter manifest fixture",
          kinds: ["issue"],
          limit: 10,
          offset: 0,
          response_format: "json",
        },
      });
      expect(malformedAdapter.structuredContent).toMatchObject({
        count: 1,
        items: [
          expect.objectContaining({
            kind: "issue",
            source: {
              filePath: "topo/adapters/malformed/adapter.json",
            },
          }),
        ],
      });
      const adapterEntity = await client.callTool({
        name: "topo_get_entity",
        arguments: {
          kind: "adapter",
          id: "adapter:acme.routes",
          response_format: "json",
        },
      });
      expect(adapterEntity.structuredContent).toMatchObject({
        kind: "adapter",
        id: "adapter:acme.routes",
        source: { filePath: "topo/adapters/acme-routes/adapter.json" },
      });

      const atlas = await client.callTool({
        name: "topo_get_atlas_scene",
        arguments: { selected_screen_id: "screen:dashboard" },
      });
      expect(
        atlas.structuredContent,
        JSON.stringify(atlas, null, 2),
      ).toBeDefined();
      expect(atlas.structuredContent).toMatchObject({
        version: 4,
        selectedScreenId: "screen:dashboard",
        selectedBounds: { x: 0, y: -18 },
        routeMap: {
          sections: [
            expect.objectContaining({
              id: "section:top-level",
              groupIds: ["/"],
            }),
            expect.objectContaining({
              id: "section:configured:workspace",
              groupIds: ["workspace"],
            }),
          ],
          groups: [
            expect.objectContaining({
              id: "/",
              label: "Entry",
              routeNodeIds: ["route:/"],
            }),
            expect.objectContaining({
              id: "workspace",
              label: "Workspace",
              routeNodeIds: [
                "route:/dashboard",
                "route:/dashboard/customers",
                "route:/settings",
              ],
            }),
          ],
          routes: expect.arrayContaining([
            expect.objectContaining({
              routePath: "/dashboard",
              primaryScreenId: "screen:dashboard",
              screenIds: expect.arrayContaining([
                "screen:dashboard",
                "screen:dashboard-loading",
              ]),
              states: ["default", "loading"],
            }),
          ]),
        },
        layout: {
          screens: expect.arrayContaining([
            expect.objectContaining({
              id: "screen:dashboard",
              position: { x: 0, y: 0 },
            }),
          ]),
        },
      });

      const components = await client.callTool({
        name: "topo_get_component_scene",
        arguments: { selected_component_id: "component:customer-table" },
      });
      expect(components.structuredContent).toMatchObject({
        version: 2,
        selectedComponentId: "component:customer-table",
        selectedGroupId: "component-source:components",
        groups: [
          expect.objectContaining({
            id: "component-source:components",
            label: "Shared components",
            componentCount: 2,
            previewStatusCounts: {
              renderable: 1,
              missing: 1,
              blocked: 0,
              unknown: 0,
            },
          }),
        ],
        components: expect.arrayContaining([
          expect.objectContaining({
            id: "component:customer-table",
            position: { x: 0, y: 0 },
          }),
        ]),
        routeNodes: [
          expect.objectContaining({
            screenId: "screen:customers",
            routePath: "/dashboard/customers",
            resolution: "resolved",
          }),
        ],
      });

      const flows = await client.callTool({
        name: "topo_get_flow_scene",
        arguments: {
          selected_flow_id: "flow:create-customer",
          selected_step_id: "open-customers",
        },
      });
      expect(flows.structuredContent).toMatchObject({
        version: 1,
        selectedFlowId: "flow:create-customer",
        selectedStepId: "open-customers",
        steps: expect.arrayContaining([
          expect.objectContaining({
            flowId: "flow:create-customer",
            stepId: "open-customers",
            resolution: "resolved",
            position: { x: 0, y: 0 },
          }),
        ]),
      });

      const note = await client.callTool({
        name: "topo_get_entity",
        arguments: {
          kind: "note",
          id: "note:customer-table-fixture",
          response_format: "json",
        },
      });
      expect(note.structuredContent).toMatchObject({
        kind: "note",
        relationships: expect.arrayContaining([
          expect.objectContaining({ targetKind: "route" }),
          {
            type: "attached-to-entity",
            targetKind: "component",
            targetId: "component:customer-table",
          },
        ]),
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
