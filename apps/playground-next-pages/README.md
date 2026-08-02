# Next.js Pages Router playground

Permanent executable compatibility fixture for Topo's Pages Router discovery,
native runtime, capture, flow, and LLM-context paths.

The application intentionally includes an index route, nested index route,
dynamic segment, custom 404 state, ordinary page, ignored API route, and shared
components. Run it on its reserved loopback port:

```powershell
pnpm --filter @topo/playground-next-pages dev
```

Then scan it through the same public CLI used for other projects:

```powershell
pnpm run topo -- scan apps/playground-next-pages --json
```
