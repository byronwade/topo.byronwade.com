---
title: "Adapter authoring"
description: "How Topo route, API-endpoint, flow-discovery, component-preview, and application-runtime adapters extend narrow, versioned seams."
public: true
order: 50
updated: 2026-08-02
---

# Topo adapter authoring

Framework, API endpoint, and flow-discovery adapters are small packages around deep read-only interfaces: one workspace snapshot goes in, normalized route, operation, or transition descriptors come out. Topo owns file walking, graph node construction, deduplication, hierarchy and flow edges, journey inference, component indexing, persistence, daemon refresh, and rendering.

This contract extends discovery. To add or remove Studio destinations and commands, use the separate [Studio extension API](./STUDIO_EXTENSIONS.md).

## Built-in framework adapters

Topo ships six independent route-discovery adapters behind the same version-one contract:

| Adapter         | Project forms                       | Discovery authority                                                                                                  |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `topo.next`     | Next.js App Router and Pages Router | Public route-file conventions, including loading, error, not-found, and dynamic states                               |
| `topo.tanstack` | TanStack Router and TanStack Start  | Generated route-tree `fullPath` values first; conservative file-route fallback                                       |
| `topo.react`    | Ordinary React and React Router     | Static absolute JSX `<Route path>` and route-object literals; a concrete root entry for routerless apps              |
| `topo.vue`      | Ordinary Vue and Vue Router         | Static absolute router-record paths; a concrete `App.vue` or main entry for routerless apps                          |
| `topo.nuxt`     | Nuxt pages applications             | Nuxt package/config markers plus public `pages` conventions, route groups, dynamic, optional, and catch-all segments |
| `topo.svelte`   | SvelteKit and ordinary Svelte       | SvelteKit `+page` and `+error` conventions or a concrete `App.svelte` entry                                          |

React and Vue intentionally do not guess relative child paths without their parent route structure. Nuxt does not claim an arbitrary `pages` directory, and TanStack does not claim an arbitrary `routes` directory. Ambiguous or executable route factories remain extension territory until an adapter can emit source-backed normalized paths without running the application. Vue and Svelte single-file components enter the shared source snapshot and component catalog; JavaScript and TypeScript compiler parsing remains scanner-owned and separate from framework route discovery.

## Scaffold a local adapter

Create a contract-valid local adapter without installing an SDK or copying boilerplate:

```powershell
topo adapters create . --kind framework --id acme.remix --name "Remix"
topo adapters create . --kind api-endpoint --id acme.trpc --name "tRPC endpoints"
topo adapters create . --kind flow-discovery --id acme.checkout --name "Checkout flow conventions"
topo adapters create . --kind component-preview --id acme.preview --name "Acme previews"
topo adapters create . --kind application-runtime --id acme.runtime --name "Acme runtime"
```

Use `--dry-run --json` to inspect the complete plan. A real `--json` create emits one result only after the directory exists. The default output is `topo/adapters/<adapter-id>/`; `--output topo/adapters/<directory>` selects another one-level catalog entry. Keeping every scaffold in this bounded catalog makes complete LLM and MCP discovery deterministic. Topo rejects absolute paths, traversal, linked ancestors, invalid IDs, missing or unknown CLI options, and any target that already exists. It writes the four files into a temporary sibling and renames the complete directory into place only after every write succeeds.

Each scaffold contains:

- `adapter.json`, a version-one machine-readable identity and registration record;
- `index.mjs`, a zero-dependency ESM adapter with named and default exports;
- `index.test.mjs`, an executable `node:test` contract smoke test;
- `README.md`, exact registration, editing, and verification instructions.

The generated adapter intentionally returns no match until its owner implements project-specific discovery or runtime selection. This avoids claiming routes, endpoints, transitions, previews, or process commands that Topo did not observe. The command prints the exact `extensions.frameworkAdapters`, `extensions.apiEndpointAdapters`, `extensions.flowAdapters`, `extensions.componentPreviewAdapters`, or `extensions.applicationRuntimeAdapters` entry to merge into `topo.config.ts`.

Run the generated test, then exercise the actual Topo seam:

```powershell
node --test topo/adapters/acme-remix/index.test.mjs
topo adapters check . --id acme.remix --json
topo scan . --json
topo context query . --kind adapter --json
```

`topo adapters check` discovers every local manifest by default or selects one exact manifest ID with `--id`. Its schema-version-1 report contains four checks per adapter: manifest validity, ESM module loading, exact manifest-to-module identity, and execution through the selected family's public contract against an empty read-only context. Framework, API endpoint, and flow-discovery adapters run through their registries, preview adapters also resolve capture URLs for returned previews, and runtime adapters run through the process-free resolver. The command does not start the application or its development server, but it does import and execute local adapter code. Run it only for repositories you trust. Passing conformance proves the public boundary accepts the implementation; it does not prove that project-specific discovery, capture, or startup behavior is correct.

Valid manifests enter the canonical adapter inventory. Registration is verified by matching the manifest's exact module specifier against the corresponding `topo.config.ts` extension list; Topo does not infer registration from the existence of generated files. Malformed manifests become inventory issues and canonical `issue` records rather than disappearing from agent reads. Conformance reports are ephemeral verification evidence and never mutate this inventory.

## Adapter inventory

`@topo/adapter-inventory` is the shared read model for all five adapter families. It combines four evidence sources without loading arbitrary code:

1. the built-in framework, API-endpoint, flow-discovery, component-preview, and application-runtime catalog;
2. valid project manifests under `topo/adapters/*/adapter.json`;
3. module specifiers registered in `topo.config.ts` extension arrays;
4. framework, API-endpoint, flow-discovery, and component-preview adapter IDs observed in the normalized application graph.

Every schema-version-1 entry has a stable inventory ID, adapter ID, kind, display name, provenance, status, activation and registration booleans, non-negative route, endpoint, transition, inferred-journey, and preview counts, plus exact `screenIds`, `endpointIds`, `flowTransitionIds`, `inferredFlowIds`, and `componentIds`. Project manifests additionally retain their exact manifest path and registration record. The built-in route-discovery IDs are `topo.next`, `topo.tanstack`, `topo.react`, `topo.vue`, `topo.nuxt`, and `topo.svelte`; built-in endpoint IDs are `source-api` and `openapi`; the built-in flow ID is `source-flow`; application-runtime IDs remain separate because starting a development server and discovering its routes are independent seams. The status vocabulary is deliberately evidence-scoped:

- `active` means the current graph contains framework routes, API endpoints, flow transitions or inferred journeys, or component previews attributed to that adapter, or runtime activation was explicitly supplied;
- `registered` means the exact module specifier appears in the matching config extension list;
- `declared` means a valid local manifest exists but its module is not registered and no contribution was observed;
- `available` means a built-in adapter is shipped but not active in the current graph.

Configured modules without a local manifest remain visible as `configured` entries. Graph contributors without a built-in or local identity remain visible as `observed` entries, including third-party framework adapters that discovered routes. A configured module specifier and an observed adapter ID stay separate unless a local manifest proves that they are the same adapter. Invalid manifests appear in `issues` with their exact file and parse message. The summary counts known, active, registered, declared, and malformed entries independently, so an active registered adapter contributes to both active and registered totals.

The loopback daemon serves the fresh inventory at `GET /adapters`. Its watcher treats direct changes to `topo/adapters/*/adapter.json` as an `adapters` resource update, regenerates canonical LLM context, and emits `resource.updated` without pretending the application source graph changed. Studio validates the response through `@topo/protocol` and groups the exact entries under route discovery, flow discovery, API endpoints, component previews, and application runtime. Demo mode uses a schema-valid fixture; disconnected mode labels the inventory unavailable.

Agents receive the same information through context files, bounded CLI/daemon queries, and MCP:

```powershell
topo context query . --kind adapter --limit 25 --json
```

Scaffold records preserve the existing stable `adapter:<adapter-id>` identity. Built-in, configured, and observed records use their complete inventory identity to avoid collisions between adapter families. Active framework records relate only to routes formed from their exact `screenIds`; each route and screen relates back through `discovered-by`. Active endpoint records relate only to their exact `endpointIds`, and each endpoint relates back to every contributing adapter. Active flow-discovery records relate only to their exact `flowTransitionIds` and `inferredFlowIds`; those records relate back through `discovered-by`. Active component-preview records relate only to their exact `componentIds`, and each component relates back through `previewed-by`. Preview credentials, environment values, signed gateway sessions, headers, cookies, and local storage are never included.

## Package shape

Install `@topo/framework-adapter` as a peer dependency and export one adapter as `default` or `frameworkAdapter`. A package may instead export a `frameworkAdapters` array when one framework distribution has multiple independently detected routing modes.

```ts
import {
  FRAMEWORK_ADAPTER_API_VERSION,
  defineFrameworkAdapter,
} from "@topo/framework-adapter";

export const frameworkAdapter = defineFrameworkAdapter({
  apiVersion: FRAMEWORK_ADAPTER_API_VERSION,
  id: "acme.remix",
  displayName: "Remix",

  detect(context) {
    const packageMatch = context.packageNames.has("@remix-run/react");
    const routeMatch = context.files.some(({ filePath }) =>
      filePath.startsWith("app/routes/"),
    );
    if (!packageMatch && !routeMatch) return [];

    return [
      {
        framework: "remix",
        confidence: packageMatch ? 1 : 0.85,
        reasons: packageMatch
          ? ["@remix-run/react dependency"]
          : ["app/routes files"],
      },
    ];
  },

  scan(context) {
    return {
      routes: context.files
        .filter(
          ({ filePath }) =>
            filePath.startsWith("app/routes/") && filePath.endsWith(".tsx"),
        )
        .map(({ filePath }) => ({
          framework: "remix",
          filePath,
          routePath:
            filePath === "app/routes/_index.tsx"
              ? "/"
              : `/${filePath.slice(11, -4)}`,
          state: "default",
        })),
    };
  },
});

export default frameworkAdapter;
```

Register the installed module from the application workspace:

```ts
// topo.config.ts
export default {
  extensions: {
    frameworkAdapters: ["@acme/topo-adapter-remix"],
  },
};
```

Relative ESM files are also supported, such as `"./topo/remix-adapter.mjs"`. Relative paths resolve from the scanned workspace root. Adapter modules are normal ESM at runtime; publish compiled JavaScript rather than raw TypeScript.

## API endpoint adapters

API endpoint adapters are independent from route discovery. They receive the scanner's immutable file snapshot and return normalized HTTP operations plus explicit source issues. The built-ins cover two complementary authorities:

| Adapter | Evidence |
| --- | --- |
| `source-api` | Next.js App/Pages handlers, Nuxt server handlers, SvelteKit `+server`, literal Express/Hono/Fastify routes, and Nest controllers |
| `openapi` | Conventional OpenAPI or Swagger JSON/YAML contracts, including operation metadata, parameters, media types, responses, tags, and security declarations |

The contract has one required method:

```ts
import {
  API_ENDPOINT_ADAPTER_VERSION,
  type ApiEndpointAdapter,
} from "@topo/endpoint-adapter";

export const apiEndpointAdapter: ApiEndpointAdapter = {
  apiVersion: API_ENDPOINT_ADAPTER_VERSION,
  id: "acme.trpc",
  displayName: "tRPC endpoints",
  async scan(context) {
    const endpoints = [];
    for (const file of context.files) {
      if (!file.filePath.endsWith(".router.ts")) continue;
      const source = await context.readFile(file.filePath);
      // Parse only literal, source-backed operations here.
    }
    return { endpoints };
  },
};

export default apiEndpointAdapter;
```

Every endpoint must include `protocol: "http"`, a supported uppercase method or `ANY`, a normalized path without query or fragment text, a workspace-contained source location, a discovery kind, and confidence from 0 to 1. Optional metadata includes framework, title, operation ID, summary, description, tags, parameters, request content types, responses, and security declarations. Return a source-located issue when executable or malformed input cannot be represented; never hide it or invent a concrete path.

Register an installed module from `topo.config.ts`:

```ts
export default {
  extensions: {
    apiEndpointAdapters: ["@acme/topo-adapter-trpc"],
  },
};
```

The scanner runs all endpoint adapters over the same already-read snapshot, validates contributions, merges equal `method:path` operations, and retains every discovery record. A custom adapter should not walk the filesystem, start a process, call the application, or expose secrets. Runtime probing belongs in a separate diagnostic seam.

## Flow discovery adapters

Flow discovery runs after canonical screens, source dependencies, and API endpoints exist, but still reads from the same immutable scanner snapshot. The context includes all source descriptors, package names, a snapshot-backed `readFile`, and each screen's exact identity, route, route source, and statically reachable value dependencies. An adapter does not discover routes or walk the filesystem; it describes source-backed actions owned by known screens.

The built-in `source-flow` adapter recognizes literal `<a>`, `Link`, `NavLink`, `NuxtLink`, and `RouterLink` destinations; `push`, `replace`, `navigate`, `redirect`, `goto`, and `navigateTo` calls; form actions; `fetch`; and Axios methods. It strips query and fragment text for canonical path matching, excludes assets and remote URLs, and reports computed navigation targets as source issues. It never evaluates expressions or imports project code.

The public contract remains one method:

```ts
import {
  FLOW_DISCOVERY_ADAPTER_VERSION,
  defineFlowDiscoveryAdapter,
} from "@topo/flow-adapter";

export const flowDiscoveryAdapter = defineFlowDiscoveryAdapter({
  apiVersion: FLOW_DISCOVERY_ADAPTER_VERSION,
  id: "acme.checkout",
  displayName: "Checkout conventions",

  async scan(context) {
    const transitions = [];
    for (const screen of context.screens) {
      for (const filePath of screen.sourceFilePaths) {
        const source = await context.readFile(filePath);
        // Emit only literal actions proven by this source and screen ownership.
        void source;
      }
    }
    return { transitions };
  },
});

export default flowDiscoveryAdapter;
```

Each transition provides a known `sourceScreenId`, `navigation`, `redirect`, `submission`, or `request` kind, a normalized route or HTTP target, a human-readable action, a snapshot-contained source location, and confidence from 0 to 1. Return a source-located issue when an executable convention cannot be represented safely. The registry rejects unknown screens, escaping paths, invalid methods, query-bearing targets, missing evidence, and duplicate adapter IDs.

Register installed modules from the project root:

```ts
export default {
  extensions: {
    flowAdapters: ["@acme/topo-adapter-checkout"],
  },
};
```

Topo resolves literal routes against same-framework canonical patterns first, then other recognized screens, and resolves HTTP actions against normalized API endpoints. It preserves unresolved targets rather than dropping them. The graph derives bounded read-only journeys and adapter membership; a flow adapter never writes `.topo/flows`, marks a candidate verified, starts a runtime, or receives preview secrets.

## Component preview adapters

Component preview adapters are independent from route adapters. They map an exact component source to one or more constructible preview sources, then resolve each source against their own local runtime. A project-installed adapter exports `componentPreviewAdapter`, `componentPreviewAdapters`, or a default adapter.

Most projects do not need a custom adapter. Key an exact component path under `preview.components` and point it at one or more project-owned, zero-required-prop exports:

```ts
export default {
  preview: {
    components: {
      "src/components/CustomerSummaryCard.tsx": [
        {
          source: "src/previews/CustomerSummaryCard.preview.tsx",
          exportName: "Owner",
          title: "Owner customer summary",
        },
        {
          source: "src/previews/CustomerSummaryCard.generated.tsx",
          exportName: "AcceptedEmptyState",
          provenance: "ai-accepted",
        },
      ],
    },
  },
};
```

A single object may replace the array for one variant. Component and preview paths are source-root-relative POSIX paths; traversal and backslashes are rejected. The built-in Topo adapter verifies that both files and the named export exist and that the export is constructible without required props. A missing path, missing export, or required-prop preview wrapper fails with actionable source evidence instead of silently guessing a fixture. `ai-accepted` is an explicit trust decision: Topo never generates, writes, or accepts a stub on its own.

Studio's explicit **Create preview draft** action is a separate project-source mutation, not an adapter privilege or an AI acceptance decision. The daemon passes the selected component to `@topo/preview-scaffold`, which creates only the conventional sibling `.topo.tsx` path and refuses existing targets, traversal, and sources linked outside the source root. Safe zero-required-prop components receive an active wrapper. Required-prop components receive a typed but inactive fixture draft; the scanner emits a `Component preview fixture required` finding until a developer fills the values and exports the prepared zero-argument preview. Third-party preview adapters remain read-only and unchanged.

```ts
import {
  COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  defineComponentPreviewAdapter,
} from "@topo/preview-adapter";

export default defineComponentPreviewAdapter({
  apiVersion: COMPONENT_PREVIEW_ADAPTER_API_VERSION,
  id: "acme.preview",
  displayName: "Acme previews",
  scan(context) {
    return {
      previews: [
        {
          componentFilePath: "components/Badge.tsx",
          preview: {
            id: "acme.preview:components/Badge.preview.tsx#Healthy",
            title: "Healthy",
            adapterId: "acme.preview",
            source: {
              filePath: "components/Badge.preview.tsx",
              line: 3,
            },
            exportName: "Healthy",
            locator: "components/Badge.preview.tsx#Healthy",
            priority: 300,
            readiness: {
              readySelector: '[data-preview-state="ready"]',
              errorSelector: '[data-preview-state="error"]',
              timeoutMs: 10_000,
            },
          },
        },
      ],
    };
  },
  resolveCaptureUrl(preview, { baseUrl }) {
    const url = new URL("preview", baseUrl);
    url.searchParams.set("export", preview.exportName ?? "default");
    return url.toString();
  },
});
```

Register the module and its external runtime origin:

```ts
export default {
  extensions: {
    componentPreviewAdapters: ["@acme/topo-preview-adapter"],
  },
  preview: {
    componentBaseUrls: {
      "acme.preview": "http://127.0.0.1:6100",
    },
  },
};
```

Lower `priority` values are preferred. The built-in chain is Storybook (`100`), colocated `.topo` exports (`200`), configured exports (`300`), safe automatic exports (`400`), and accepted generated exports (`500`). Other adapters without an explicit priority use `500`. Readiness is optional for external systems, but supplying it prevents a loading or failed document from becoming a successful artifact. Built-in colocated, configured, automatic, and accepted-generated sources use the daemon-managed runtime and require no configured origin. Every source records its `discovery` provenance in the graph and canonical LLM context.

## Application runtime adapters

Application runtime adapters are a third independent family. They do not discover routes or render component variants; they resolve how an unavailable loopback `preview.baseUrl` should be started through the application's native development command. `@topo/application-runtime` owns package-manager detection, HTTP probing, readiness timeout, bounded output evidence, unexpected-exit reporting, Windows process-shim handling, and owned process-tree shutdown behind one `startApplicationRuntime()` interface.

An adapter has one operation and returns either no match or one confidence-ranked command plan:

```ts
import {
  APPLICATION_RUNTIME_ADAPTER_API_VERSION,
  defineApplicationRuntimeAdapter,
} from "@topo/application-runtime";

export const applicationRuntimeAdapter = defineApplicationRuntimeAdapter({
  apiVersion: APPLICATION_RUNTIME_ADAPTER_API_VERSION,
  id: "acme.runtime",
  displayName: "Acme runtime",
  resolve(context) {
    if (!context.dependencies.has("@acme/framework")) return undefined;
    return {
      confidence: 0.9,
      reasons: ["The application declares @acme/framework."],
      command: {
        type: "package-script",
        script: "dev:topo",
        args: ["--host", context.host, "--port", String(context.port)],
      },
    };
  },
});
```

Register the package or relative ESM module independently from discovery adapters. Package and relative module resolution begins at the Topo project root—the directory containing `topo.config.ts`—even when `rootDir` selects a nested application. Runtime detection and the resulting command still operate on that nested source package:

```ts
export default {
  extensions: {
    frameworkAdapters: ["@acme/topo-routes"],
    applicationRuntimeAdapters: ["@acme/topo-runtime"],
  },
  preview: {
    baseUrl: "http://localhost:4400",
    server: { mode: "auto", readyTimeoutMs: 60_000 },
  },
};
```

Next.js, TanStack, Nuxt, Vite, and a generic `dev` package-script fallback are built in. Vite supplies the normal React, Vue, and Svelte development lifecycle; Nuxt has its own adapter because its CLI host and port flags differ. The highest confidence wins, with registration order as the deterministic tie-breaker. `preview.server.command` bypasses adapter selection with an explicit token array; it is not a shell command string. `auto` reuses a healthy server or starts one, `external` requires reuse, and `managed` requires ownership and rejects an occupied origin. Topo never starts a remote or HTTPS origin. Runtime adapter modules and package scripts execute local project code, so install and run only adapters and repositories you trust.

## Contract invariants

- `apiVersion` must equal the SDK's `FRAMEWORK_ADAPTER_API_VERSION`.
- Adapter and framework IDs use lowercase letters, numbers, dots, and hyphens. `mixed` and `unknown` are reserved graph aggregate IDs.
- `detect()` returns zero or more positive matches. Every match has a confidence greater than 0 and at most 1 plus at least one evidence reason.
- `scan()` runs only after a positive detection and may return routes only for frameworks declared by that detection.
- `filePath` is POSIX-style, relative to the workspace, and must identify a file in the immutable source snapshot.
- `routePath` is an absolute pathname beginning with `/`, without a query string or hash.
- `state` is one of `default`, `loading`, `error`, `not-found`, `empty`, or `unknown`.
- `readFile()` can read only files listed in `context.files`. Adapters do not receive a write capability.
- Results should be deterministic for the same snapshot. Topo normalizes ordering and deduplicates equivalent framework, route, and state tuples.

Contract violations fail the scan with `FrameworkAdapterContractError`. Exceptions from adapter code are wrapped as `FrameworkAdapterExecutionError` with the adapter ID and failing `detect` or `scan` stage.

Application runtime adapters use their own version constant and contract error. Their IDs are unique within that registry; match confidence, reasons, package-script names, process executables, and argument arrays are validated before process startup. `resolveApplicationRuntimeAdapter()` exposes this validation and deterministic highest-confidence selection without starting a process; `startApplicationRuntime()` reuses that resolver before it assumes process ownership. Runtime resolution never receives source-file reads or write capabilities.

Compiler parsing remains scanner-owned. Framework adapters receive file identities and bounded `readFile()` access; they do not receive Oxc ASTs or parser lifecycle hooks. This keeps the public adapter contract small and prevents compiler-version coupling for third-party adapters. Component-preview adapters remain independent of framework adapters; the built-in Topo preview adapter uses the compact parser read model only to make safe export and required-prop decisions.

## Testing

Start with `topo adapters check . --id <adapter-id> --json`. It gives every adapter family the same parseable baseline without requiring framework-specific test harness code.

For a framework adapter, also test through `createFrameworkAdapterRegistry()` using an in-memory context. This exercises the same runtime contract Topo uses and keeps tests independent from scanner internals. Component-preview adapters should test discovery plus capture-URL resolution. Application-runtime adapters should test process-free resolution separately from one owned-process lifecycle test.

Also include one workspace fixture test that installs or loads the compiled module and calls `@topo/workspace`'s `scanWorkspace()`. This proves package resolution, detection, source reads, and graph normalization together.

Topo's own suite includes six independent built-in implementations at this seam plus an external-style fixture adapter loaded from an ESM module.

The permanent `apps/playground-next-pages` fixture proves the legacy-but-supported Next.js Pages Router path with a native Next.js application rather than a synthetic file tree. Its workspace contract requires `/`, `/404`, `/customers`, `/customers/[customerId]`, and `/settings`, preserves the custom 404 state and dynamic source identity, excludes `pages/api/health.ts`, catalogs constructible and missing-preview components, and projects the checked-in `review-pages-customer` flow into one flow plus three independently queryable step records.

The permanent `apps/playground-tanstack-router` fixture adds an end-to-end TanStack contract. Its official Vite plugin generates `src/routeTree.gen.ts`; the workspace test requires `/`, `/jobs`, `/jobs/:jobId`, and `/settings/profile` to come from that generated source. Generated `fullPath` values take precedence over route-local `path` values, which prevents a nested route such as `/jobs/$jobId` from being misreported as `/$jobId`. Without a generated tree, filename fallback ignores root, excluded, route-group, and pathless-layout segments and retains the actual index source.

The permanent `apps/playground-tanstack-start` fixture covers the full-stack distribution through the current `@tanstack/react-start` package, generated route tree, Vite, and Nitro server integration. Topo still recognizes the deprecated `@tanstack/start` package as a compatibility alias. Its contract adds SSR, a deterministic server function, `/work-orders/:workOrderId`, component-preview coverage, and one three-step LLM-readable flow without giving the adapter any Start-specific scanner privileges.

`pnpm verify:framework-fixtures` runs all eight permanent routing projects through one reusable contract: the public workspace scanner, canonical LLM-context loader, managed native application runtime, real Chromium navigation, stable screen identity, error collection, and owned-process shutdown. The matrix covers Next.js App Router, Next.js Pages Router, TanStack Router, TanStack Start, React Router, Vue Router, Nuxt, and SvelteKit. The App Router fixture additionally declares its exact `default`, `loading`, and `not-found` graph screens separately from concrete browser visits, preserving multiple states for the same route without framework-specific verifier code. The schema-versioned JSON report keeps every check, graph-state expectation, and route result machine-readable. A new built-in adapter should add a permanent native fixture and enter this definition table instead of creating a separate private test path.

The permanent `apps/playground-storybook` fixture is the component-preview equivalent. `pnpm verify:storybook` builds its real Storybook 10 React/Vite index, scans three exported CSF states with source lines, resolves each state by import path plus export name, renders the returned iframe IDs in Chromium, and requires hash-addressed PNG artifacts. The verifier builds the benchmark dependency graph first so it cannot pass against stale adapter output.

## Compatibility

Additive fields may be introduced without changing `apiVersion`. Removing fields, changing invariants, or changing execution semantics requires a new API version with an explicit migration path. The registry rejects unsupported versions before adapter code runs.
