#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpEvaluationContext } from "./evaluation-fixture.js";
import { createMcpServer } from "./index.js";

export async function runEvaluationServer(): Promise<void> {
  const context = createMcpEvaluationContext();
  const server = createMcpServer({ getContext: async () => context });
  await server.connect(new StdioServerTransport());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runEvaluationServer();
}
