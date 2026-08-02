# `@topo/mcp`

Standards-based local stdio MCP server exposing Topo's canonical LLM context through resources, resource templates, structured and paginated read-only tools, a review prompt, graph compatibility reads, and binary route/component capture resources. It uses the same context module as filesystem exports, the CLI, and the daemon. Interaction-probe effects and safety skips are queryable as complete canonical records. Component previews are available as bounded metadata, a paginated tool, and exact `topo://component-preview/{id}/image` resources.

`evaluation.xml` contains ten read-only, independent retrieval evaluations against the deterministic context in `src/evaluation-fixture.ts`. Build the package and run `pnpm --filter @topo/mcp evaluation-server` to expose that fixed fixture over stdio to an MCP evaluation harness.
