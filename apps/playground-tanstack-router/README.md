# TanStack Router playground

Executable file-based TanStack Router compatibility fixture for Topo.

```powershell
pnpm --filter @topo/playground-tanstack-router dev
```

The Vite plugin generates `src/routeTree.gen.ts`. Topo preferentially reads its
authoritative `fullPath` records and falls back to route filenames only when a
generated tree is unavailable.
