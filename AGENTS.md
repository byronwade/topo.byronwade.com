# Agent Instructions

## Package Manager

- Use pnpm 10: `pnpm install`.
- Do not edit `dist/`, `.next/`, `.turbo/`, `.topo/state.json`, `.topo/snapshots/`, or `.topo/llm/` by hand.

## Commands

| Task               | Command                                                               |
| ------------------ | --------------------------------------------------------------------- |
| Typecheck          | `pnpm typecheck`                                                      |
| Tests              | `pnpm test`                                                           |
| Build              | `pnpm build`                                                          |
| Docs contract      | `pnpm docs:check`                                                     |
| Record change      | `pnpm docs:record -- --id <id> --feature <id> --summary "<text>"`     |
| Public website     | `pnpm web`                                                            |
| Export LLM context | `pnpm run topo -- context export <project-path>`                      |
| Query LLM context  | `pnpm run topo -- context query <project-path> --query "text" --json` |
| Start MCP          | `node packages/cli/dist/index.js mcp <project-path>`                  |
| Scaffold adapter   | `pnpm run topo -- adapters create <project-path> --kind <kind> --id <id> --name "<name>"` |

## Authority

- Application source files are authoritative for routes, screens, components, and interactions.
- `.topo/notes/*.md` files are authoritative for notes.
- `.topo/flows/*.json` files are authoritative for user flows.
- `.topo/state.json`, snapshots, and `.topo/llm/` are derived local artifacts.
- The normalized contracts live in `packages/schema/src/index.ts`.
- The canonical agent read model lives in `packages/llm-context/src/index.ts`.
- Product feature status, plans, and distribution live in `docs/product.json`.
- Product history lives in `docs/product-changes.json`; `docs/CHANGELOG.md` is generated.

## Documentation Contract

- Read `docs/documentation-standard.md` before changing a product capability.
- Update implementation, tests, `docs/product.json`, referenced Markdown, and its frontmatter date together.
- Record added, changed, and removed features with `pnpm docs:record`; never hand-edit `docs/CHANGELOG.md`.
- Never present `planned` or `considering` work as available. The public website renders canonical product and pricing status from the manifest.
- Root dev, typecheck, test, and build commands fail when the documentation contract drifts.

## LLM Readability

- Read `docs/LLM_INTERFACE.md` before adding a durable Topo concept.
- Every durable concept must have a versioned schema, a context-record representation, source references, relationships, bounded query coverage, and tests.
- Malformed source records must appear as `issue` context records; never silently hide them.
- Use context pagination for large projects; do not load the full graph unless explicitly needed.
- Keep Markdown for human review and JSON/JSONL for complete machine reads.
- Never expose preview cookies, headers, local storage, tokens, or environment values in context exports or MCP.

## Architecture References

| Need                 | File                             |
| -------------------- | -------------------------------- |
| Product architecture | `docs/ARCHITECTURE.md`           |
| LLM/MCP contract     | `docs/LLM_INTERFACE.md`          |
| Framework adapters   | `docs/ADAPTERS.md`               |
| Verification levels  | `docs/verification.md`           |
| Docs governance      | `docs/documentation-standard.md` |
