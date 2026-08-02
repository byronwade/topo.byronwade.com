import { describe, expect, it } from "vitest";

import { createApiEndpointAdapterRegistry } from "@topo/endpoint-adapter";
import { openApiEndpointAdapter } from "./index.js";

async function scan(filePath: string, source: string) {
  return createApiEndpointAdapterRegistry([openApiEndpointAdapter]).scan({
    rootDir: "/project",
    files: [{ filePath, extension: `.${filePath.split(".").pop()}` }],
    packageNames: new Set(),
    readFile: async () => source,
  });
}

describe("OpenAPI endpoint adapter", () => {
  it("extracts operation, contract, response, and security evidence", async () => {
    const result = await scan("openapi.yaml", `
openapi: 3.1.0
security:
  - bearerAuth: []
paths:
  /customers/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: string }
    get:
      operationId: getCustomer
      summary: Get customer
      tags: [Customers]
      responses:
        "200":
          description: Customer
          content:
            application/json: {}
`);
    const endpoint = result.endpoints[0];
    expect(endpoint).toMatchObject({ method: "GET", path: "/customers/{id}", operationId: "getCustomer" });
    expect(endpoint?.parameters?.[0]).toMatchObject({ name: "id", required: true });
    expect(endpoint?.responses?.[0]?.contentTypes).toEqual(["application/json"]);
    expect(endpoint?.security).toEqual({ status: "declared", schemes: ["bearerAuth"] });
  });

  it("exposes malformed contracts as issues", async () => {
    const result = await scan("swagger.json", "{ definitely not json }");
    expect(result.endpoints).toHaveLength(0);
    expect(result.issues[0]?.message).toContain("Unable to parse API contract");
  });

  it("retains line-one evidence for compact generated JSON", async () => {
    const result = await scan("openapi.json", JSON.stringify({
      openapi: "3.1.0",
      paths: { "/health": { get: { responses: { "200": { description: "OK" } } } } },
    }));
    expect(result.endpoints[0]?.source).toEqual({ filePath: "openapi.json", line: 1 });
  });
});
