import { describe, expect, it } from "vitest";

import { createApiEndpointAdapterRegistry } from "@topo/endpoint-adapter";
import { sourceApiEndpointAdapter } from "./index.js";

async function scan(files: Record<string, string>, packages: string[] = []) {
  return createApiEndpointAdapterRegistry([sourceApiEndpointAdapter]).scan({
    rootDir: "/project",
    files: Object.keys(files).map((filePath) => ({ filePath, extension: `.${filePath.split(".").pop()}` })),
    packageNames: new Set(packages),
    readFile: async (filePath) => files[filePath]!,
  });
}

describe("source API endpoint adapter", () => {
  it("discovers Next, Nuxt, and SvelteKit route handlers", async () => {
    const result = await scan({
      "app/api/customers/[id]/route.ts": "export async function GET() {}\nexport const PATCH = async () => {}",
      "server/api/jobs/[id].delete.ts": "export default defineEventHandler(() => ({}))",
      "server/routes/status.ts": "export default defineEventHandler(() => ({}))",
      "src/routes/api/orders/[id]/+server.ts": "export const GET = () => new Response()\nexport function fallback() {}",
      "src/routes/+server.ts": "export const HEAD = () => new Response()",
    });
    expect(result.endpoints.map((item) => `${item.method} ${item.path}`)).toEqual([
      "GET /api/customers/{id}",
      "PATCH /api/customers/{id}",
      "DELETE /api/jobs/{id}",
      "ANY /status",
      "GET /api/orders/{id}",
      "ANY /api/orders/{id}",
      "HEAD /",
    ]);
  });

  it("recognizes common Next Pages request variable names", async () => {
    const result = await scan({
      "pages/api/health.ts": "export default function handler(request) { if (request.method !== 'GET') return methodNotAllowed(); return ok() }",
    });
    expect(result.endpoints.map((item) => `${item.method} ${item.path}`)).toEqual(["GET /api/health"]);
  });

  it("discovers literal Express, Hono, Fastify, and Nest routes", async () => {
    const result = await scan({
      "src/api.ts": `import express from 'express'\napp.get('/health', ok)\napp.post('/customers', create)\napp.on('PATCH', '/jobs/:id', update)\nfastify.route({ method: 'DELETE', url: '/jobs/:id', handler })`,
      "src/users.controller.ts": `import { Controller, Get } from '@nestjs/common'\n@Controller('users')\nclass Users { @Get(':id') one() {} }`,
    }, ["express", "fastify", "@nestjs/common"]);
    expect(result.endpoints.map((item) => `${item.method} ${item.path}`)).toEqual(expect.arrayContaining([
      "GET /health",
      "POST /customers",
      "PATCH /jobs/:id",
      "DELETE /jobs/:id",
      "GET /users/:id",
    ]));
  });

  it("keeps computed registrations visible as issues", async () => {
    const result = await scan({ "src/api.ts": "import express from 'express'\napp.get(API_PATH, handler)" }, ["express"]);
    expect(result.endpoints).toHaveLength(0);
    expect(result.issues[0]?.message).toContain("computed path API_PATH");
  });
});
