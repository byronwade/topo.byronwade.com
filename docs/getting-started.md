---
title: "Getting started"
description: "Build and run Topo against the included fixture or a Next.js, TanStack, React, Vue, Nuxt, or Svelte application."
public: true
order: 10
updated: 2026-08-02
---

# Getting started

Topo is currently distributed as a source preview. A self-contained CLI tarball is built and consumer-tested in the repository, but `@topo/cli` is not published to npm yet. The reliable path remains cloning the repository and running the included MVP.

## Requirements

- Node.js 24 or newer.
- pnpm 10.
- Chromium for screen capture and runtime diagnostics.

## Run the complete MVP

```powershell
git clone https://github.com/byronwade/topo.byronwade.com.git
cd topo.byronwade.com
pnpm install
pnpm exec playwright install chromium
pnpm mvp
```

The MVP starts three cooperating processes:

| Surface    | Default address         | Responsibility                                         |
| ---------- | ----------------------- | ------------------------------------------------------ |
| Playground | `http://localhost:3000` | Real Next.js application under inspection              |
| Daemon     | `http://localhost:4599` | Graph, capture, notes, flows, diagnostics, and context |
| Studio     | `http://localhost:4173` | GPU application atlas and inspector                    |

Open Studio, select a screen, inspect its source, add a note, and switch the selected screen into a live application preview. Editor's **Screens** search reads the complete discovered default-screen inventory, while **Assets** searches the complete component catalog. Compact related-evidence lists state when they are showing only a subset and link to the destination that owns the complete records.

The read-only MCP server is an optional fourth process started separately with `node packages/cli/dist/index.js mcp apps/playground-next-app`.

## Scan another project

Build Topo, then point the CLI at a Next.js, TanStack, React, Vue, Nuxt, or Svelte workspace:

```powershell
pnpm build
node packages/cli/dist/index.js init C:\path\to\your-app --dry-run --no-package
node packages/cli/dist/index.js init C:\path\to\your-app --no-package
node packages/cli/dist/index.js scan C:\path\to\your-app --json
node packages/cli/dist/index.js dev C:\path\to\your-app
```

The first command shows every proposed path. `--no-package` is appropriate when invoking the CLI from this source workspace; a published or local-tarball install can instead stage the CLI dependency and `topo` package script. Initialization detects all six built-in framework families, records the selected application in a reversible manifest only after all planned changes succeed, and uses the native framework's normal development script. `topo uninstall --dry-run C:\path\to\your-app` verifies hashes before any restoration, and a clean uninstall preserves non-empty note and flow directories. Scanning is read-only. `dev` probes the configured `preview.baseUrl`, reuses a healthy native application server or starts the detected local `dev` script, then starts the loopback daemon and compiled production Studio. It prints all authoritative URLs only after the application is reachable. Live frames, capture, and diagnostics therefore continue exercising the real framework runtime rather than a Topo reimplementation.

Production Studio accepts project data only after runtime schema validation. A malformed graph leaves the shell empty and offline; a malformed secondary resource preserves the last valid collection and raises a warning. The explicit `?demo=1` query is the only path that loads the bundled Fieldbase records.

The Studio prefers port 4173 and chooses a free loopback port if that default is occupied. Use `--preview-port <number>` to temporarily move the configured loopback application origin without editing `topo.config.ts`, `--studio-port <number>` when an exact Studio port is required, `--studio-dir <path>` to supply another compiled Studio bundle, `--no-studio` to omit Studio, or `--no-app` when another process explicitly owns application startup.

The default `preview.server.mode` is `auto`. Use `external` to require an already-running origin or `managed` to require Topo ownership and reject an occupied port. Frameworks without a conventional `dev` script can provide a tokenized command—such as `command: ["pnpm", "run", "preview:topo"]`—or an application runtime adapter. Automatic startup is restricted to loopback HTTP origins. Because `topo dev` can execute the inspected repository's existing `dev` script, run it only for repositories you trust; `scan`, `check`, and context commands do not start application code.

For a nested monorepo application, keep Topo's versioned records at the repository root and point `rootDir` at the application source:

```ts
export default {
  rootDir: "apps/web",
  preview: { baseUrl: "http://localhost:3000" },
};
```

Run every command against the repository root. Topo resolves adapter packages from there, runs and scans `apps/web`, and stores notes, flows, captures, state, and `.topo/llm` only under the repository-level `.topo` directory. `topo doctor` prints both resolved absolute roots.

## Create a local framework adapter

When a framework is not built in, generate a safe local starting point:

```powershell
node packages/cli/dist/index.js adapters create C:\path\to\your-app --kind framework --id acme.remix --name "Remix" --dry-run --json
node packages/cli/dist/index.js adapters create C:\path\to\your-app --kind framework --id acme.remix --name "Remix"
node --test C:\path\to\your-app\topo\adapters\acme-remix\index.test.mjs
node packages/cli/dist/index.js adapters check C:\path\to\your-app --id acme.remix --json
```

The create command never edits `topo.config.ts` ambiguously. It prints the exact `extensions.frameworkAdapters` entry to merge, while `adapter.json` keeps the scaffold identity and registration machine-readable. Existing directories and paths outside the project are rejected. Component-preview and application-runtime adapters use the same command with `--kind component-preview` or `--kind application-runtime`. The check command imports the trusted local module and validates manifest identity plus its public contract without starting the application; follow it with a real scan or runtime test. See [adapter authoring](./ADAPTERS.md#scaffold-a-local-adapter).

## Organize the route atlas

Topo creates useful route areas automatically, then composes those exact areas into a small set of readable regions. Related automatic areas under a substantive root such as `/workspace` stay together, unrelated roots begin in **Top level**, and configured areas remain explicit project-owned regions. This organization changes presentation only: canonical routes, screen states, source evidence, and adapter output do not change. A project can replace automatic district grouping when its product language is more useful:

Studio opens Routes on the selected **Region**, anchored near the top of the canvas so its route families are immediately readable and the next product territory remains visible below. Use **Area** for the selected route's closest group, **Atlas** for the complete application topology, and **Screen** to promote the selected route into its full-size live or captured evidence. The percentage control refits the active semantic level after manual pan or zoom.

```ts
export default {
  atlas: {
    routeGroups: {
      operations: {
        label: "Operations",
        order: 10,
        prefixes: ["/jobs", "/dispatch"],
      },
      account: {
        label: "Account",
        order: 20,
        prefixes: ["/settings"],
      },
    },
  },
};
```

Keys are stable district IDs. `label` is shown in Studio, `order` sorts configured districts, and each canonical prefix claims that route plus descendants. The longest matching prefix wins, one prefix cannot belong to two districts, and routes with no configured match keep their framework-derived area. Studio, the daemon scene, MCP, and bounded `route` context queries expose the same region-to-area-to-route-to-state placement. The normalized version-one configuration is available from `GET /atlas/organization`, while the derived scene and route records carry exact membership.

Components also organize automatically from common feature, module, route-local, shared, and component directories. Add source-root-relative POSIX prefixes only when the project should use its own domain language:

```ts
export default {
  atlas: {
    componentGroups: {
      customer-workspace: {
        label: "Customer workspace",
        order: 10,
        prefixes: ["src/features/customers"],
      },
      design-system: {
        label: "Design system",
        order: 20,
        prefixes: ["src/components/ui"],
      },
    },
  },
};
```

The most specific configured prefix wins, duplicate exact ownership is rejected, and unmatched components stay automatically grouped. The searchable sidebar collapses inactive source groups around the selected component, expands search matches, and reveals a newly selected item automatically. The Pixi scene, daemon, MCP, and bounded component context records all expose the same exact membership and coverage counts.

## Preview parameterized routes

Topo keeps a discovered route such as `/customers/[customerId]` or `/jobs/:jobId` as its canonical identity. Give the browser one concrete local example without changing that identity:

```ts
export default {
  preview: {
    routes: {
      "/customers/[customerId]": "/customers/acme-plumbing",
      "/jobs/:jobId": "/jobs/rf-1042?panel=summary",
    },
  },
};
```

Keys must be absolute canonical route patterns. Values must be same-application absolute paths with every parameter replaced; query strings are allowed, while origins and hashes are rejected. The mapping is used by captures, live frames, and runtime diagnostics. An unresolved parameterized route remains visible in the graph but is blocked from browser execution, and `topo scan`, Doctor, and Studio explain the missing entry.

## Preview a required-prop component

In connected Studio, open **Atlas → Components**, select a missing component, and choose **Create preview draft**. Topo creates only the conventional sibling `<Component>.topo.tsx`; it never overwrites an existing file. A required-prop component receives an inactive, typed fixture draft. Fill it with deterministic local values and export the prepared zero-argument preview function before Topo reports the component as renderable. Until then, the draft remains visible as a finding to both Studio and agents.

Create a normal zero-prop wrapper in your repository, then connect it without an adapter:

```ts
export default {
  preview: {
    components: {
      "src/components/CustomerSummaryCard.tsx": {
        source: "src/previews/CustomerSummaryCard.preview.tsx",
        exportName: "Owner",
        title: "Owner customer summary",
      },
    },
  },
};
```

The value may be an array for multiple variants. Topo checks the paths and export, records `configured` provenance, and renders the wrapper through the same capability-scoped runtime used by colocated `.topo.tsx` previews. Use `provenance: "ai-accepted"` only after reviewing a generated wrapper; Topo records that decision as `generated` provenance and never marks a draft accepted automatically.

## Give an agent project context

```powershell
node packages/cli/dist/index.js context export C:\path\to\your-app --json
node packages/cli/dist/index.js context query C:\path\to\your-app --kind route,flow,flow-step --limit 25 --json
node packages/cli/dist/index.js mcp C:\path\to\your-app
```

Continue with the [feature guide](./features.md), [CLI reference](./cli-reference.md), or [LLM interface](./LLM_INTERFACE.md).
