---
title: "Studio extensions"
description: "Add, replace, or remove Topo Studio destinations and commands through project config or one typed source definition."
public: true
order: 35
updated: 2026-08-02
---

# Studio extensions

Topo Studio has two deliberately small extension paths. An installed project adds a loopback web view and navigation command in `topo.config.ts`; a source build can add a React component and function command. Both use keyed additions, one-field built-in edits, explicit removal lists, and derived labels and paths.

The `component` field accepts either an ordinary React component or a `React.lazy(...)` component. Topo's five built-in destinations are lazy by default. The shell supplies the loading state and destination-scoped error boundary, so extensions do not need a second router, Suspense wrapper, or error overlay.

Advanced fields remain optional. Set `tools: "canvas"` to receive the standard Select, Pan, Fit, and Note rail, override `path` when the generated kebab-case path is not suitable, or supply custom icon and status functions. These controls call the same public runtime used by built-in views; an extension does not need to reach into Editor or Atlas internals.

Built-in evidence panes follow that same boundary. Editor updates the selected screen, component, note, or finding through the public runtime before navigating to the destination that owns the record. Extensions can therefore observe one exact addressable identity without depending on Editor's bounded presentation lists or copying its search model.

The source API has two layers:

- `@topo/studio-api` is the small React-independent composition and route-matching kernel.
- `apps/studio/src/api.ts` exports the React-aware `customizeStudio()` helper, runtime context, and `useStudio()` hook.

The kernel also exports `studioBoards`, `studioFrame`, and `findStudioBoard()`. They make the shipped 23-board visual contract inspectable to tests, tools, and agents without coupling those callers to React. A project extension does not edit that list: it composes its own destinations over the shipped defaults.

These source packages are not published yet. The `topo.config.ts` manifest below is the supported customization seam for an installed CLI tarball.

## Installed project API

Add a compact `studio` object to the project's existing `topo.config.ts`:

```ts
export default {
  studio: {
    defaultDestination: "reviews",
    remove: {
      destinations: ["editor"],
      commands: ["capture"],
    },
    destinations: {
      atlas: {
        label: "Map",
      },
      reviews: {
        url: "http://127.0.0.1:4400/reviews",
      },
    },
    commands: {
      doctor: {
        label: "Run checks",
      },
      openReviews: {
        to: "reviews",
        view: "assigned",
      },
    },
  },
};
```

That is enough to rename Atlas to **Map**, rename the existing Doctor command without copying its behavior, create the **Reviews** destination at `/reviews`, make it the default, remove Editor and Capture, and add an **Open reviews** command. Existing entries accept one-field patches. A new destination needs `url`; a new command needs `to`. `label`, `description`, `path`, `statusBar`, `shortcut`, and `view` are optional refinements.

Project destinations must use loopback HTTP (`localhost`, `127.0.0.0/8`, or `[::1]`). Studio renders them in a no-referrer sandboxed iframe and adds their validated origins to the local production host's frame policy. Remote URLs and malformed IDs or paths fail config validation. If individually valid entries form an ambiguous route tree or a command targets a missing destination, Studio keeps its complete built-in definition and shows the composition issue instead of rendering a blank shell.

The daemon exposes the normalized schema-version-1 manifest at `GET /studio`. The same sanitized object is included in the canonical project context record and context manifest, so agents can understand the visible Studio composition without inspecting pixels. Custom frame contents remain application-owned and should expose their own semantic or machine-readable data when they introduce durable concepts.

### Route organization

Atlas district organization is an adjacent config seam, not a Studio destination plugin. Add keyed rules under `atlas.routeGroups` when product language should replace framework-derived route areas:

```ts
export default {
  atlas: {
    routeGroups: {
      operations: {
        label: "Operations",
        order: 10,
        prefixes: ["/jobs", "/dispatch"],
      },
    },
  },
};
```

Each key is a stable district ID. Prefixes may merge route families, longest-prefix matching handles nested exceptions, and unmatched routes stay automatically organized. Duplicate prefix ownership is invalid. Topo composes the resulting exact districts into stable regions without rewriting them: related automatic descendants share a root region, remaining automatic roots use **Top level**, and each configured district remains an independent project-owned region. Studio hydrates the normalized policy with its local workspace resources, refreshes it on daemon resource updates, and computes every interaction from the same in-memory graph and policy without interaction-time requests. Its built-in Routes view presents that structure through explicit Area, Region, and Atlas focus levels; selected-region fit uses the shared axis-alignment API to keep the region near the top while preserving the next territory below. Daemon and MCP scenes expose region and district provenance, every represented prefix, exact region-to-district-to-route-to-screen membership, and selected area, region, and atlas focus bounds; canonical route context records expose the same placement for bounded LLM queries.

### Component organization

Components organize automatically from source structure, but a project can use the adjacent `atlas.componentGroups` seam when its product vocabulary is more useful than folder names:

```ts
export default {
  atlas: {
    componentGroups: {
      customer-workspace: {
        label: "Customer workspace",
        order: 10,
        prefixes: ["src/features/customers", "src/components/customer"],
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

Prefixes are source-root-relative POSIX paths. Each key is a stable group ID, the most specific configured prefix wins, and duplicate exact ownership is invalid. Unmatched components remain in deterministic automatic groups derived from common feature, module, route-local, shared, and component directories. This policy changes presentation only: component identity, source, preview evidence, and `usedBy` relationships remain graph authority.

The searchable Components sidebar, renderer-neutral scene, Pixi overview, daemon endpoint, MCP resource and tool, and schema-version-7 component records all consume the same organizer. The default sidebar collapses inactive groups around the selected domain, expands matches while searching, and automatically reveals a changed selection. Each group exposes exact membership, provenance, prefix ownership, aggregate preview status, preview count, distinct route usage, and focus bounds. A project can therefore customize one compact config object without replacing the renderer or creating an LLM-only taxonomy.

## Source API

Start from `apps/studio/src/examples/review-studio.tsx`:

```tsx
import { customizeStudio, useStudio } from "../api";

function ReviewDestination() {
  const { data } = useStudio();
  return <h1>{data.graph.findings.length} findings to review</h1>;
}

export const reviewStudio = customizeStudio({
  remove: {
    destinations: ["editor"],
    commands: ["capture"],
  },
  destinations: {
    reviews: {
      component: ReviewDestination,
    },
  },
  commands: {
    openReviews: ({ actions }) => actions.go("reviews"),
  },
});
```

That object creates the `/reviews` route, the **Reviews** navigation item, and the **Open reviews** command. `actions.go("reviews", "history")` navigates to `/reviews/history`; `actions.navigate("/any/absolute/path")` remains available for raw paths.

Customize one built-in field without copying its definition:

```tsx
const studio = customizeStudio({
  defaultDestination: "atlas",
  destinations: {
    atlas: { label: "Map" },
  },
});
```

Pass the result to `<App studio={reviewStudio} />`. The included fixture is already selectable with `?studio=review`; for example, `/reviews?demo=1&studio=review`.

For a large destination, the only change is the component value:

```tsx
import { lazy } from "react";

const ReviewDestination = lazy(() => import("./ReviewDestination"));
```

The rest of the keyed destination definition is unchanged.

## Composition rules

- `customizeStudio()` starts from Topo's built-ins automatically. The lower-level `defineTopoStudio({ extends })` remains available when every field must be explicit.
- New destination IDs become labels and kebab-case paths: `releaseNotes` becomes **Release notes** at `/release-notes`.
- New commands may be a runtime function; their ID becomes the command label.
- `remove.destinations` and `remove.commands` are the preferred removal syntax. `false` remains a compact compatible form inside keyed objects.
- A keyed object adds a new entry or replaces the inherited entry with that key.
- The first remaining destination becomes the fallback if the inherited default was removed. Set `defaultDestination` to choose explicitly.
- Destination paths must be absolute and must not share a first path segment.
- Definitions and entries are frozen after validation, so one extension cannot mutate shared defaults.
- Command and destination keys may use ordinary camelCase or kebab-case JavaScript identifiers.
- Synchronous and lazy destination components use the same API; loading and failure presentation belong to the shell.
- Installed project destinations use sandboxed loopback URLs; arbitrary local module loading and remote frames are not part of the config contract.

## Runtime available to extensions

`useStudio()` and command `run(runtime)` receive the same organized runtime:

- `data` — normalized graph, flows, notes, captures, probes, jobs, mode, and daemon actions;
- `location` — active destination, view, and overlay;
- `selection` — selected screen, flow, step, component, and note IDs;
- `actions` — `go(destinationId, view?)`, absolute-path navigation, overlays, note creation, and selection setters;
- `canvas` — the current `select` or `pan` mode, `setMode(mode)`, and `fit()`;
- `settings` and `setSettings` — local Studio preferences.

Extensions should consume normalized data through this runtime. They should not fetch scanner internals or invent a second graph model.

## Addressable selections

Studio keeps exact evidence selection in bounded URL query parameters so a human, test, or agent can open the same local view without reconstructing canvas state:

| Selection | Query parameter |
| --------- | --------------- |
| Screen    | `screen`        |
| Component | `component`     |
| Flow      | `flow`          |
| Flow step | `step`          |
| Note      | `note`          |

`@topo/studio-api` owns parsing, validation, and patching for this mapping. Each decoded identity is limited to 512 characters. Selection parameters survive ordinary destination navigation alongside the explicit demo or embed session, while selecting another entity updates the current history entry instead of creating one entry per canvas click. After resources hydrate, Studio keeps valid identities, replaces stale identities with deterministic local defaults, and requires a selected step to belong to the selected flow. Inbound identities are preserved while an inventory is still empty so daemon startup cannot erase a valid deep link.

These parameters are presentation pointers, not durable records or a second source of truth. Canonical routes, screens, components, flows, notes, findings, and their relationships remain available through the versioned context interface. Studio URLs never include preview cookies, headers, local storage, environment values, or signed capabilities.

## Adding another extension family

Destinations and commands are UI composition. Framework route discovery and component preview discovery remain separate versioned adapter families. Add new framework support through `@topo/framework-adapter`, preview support through `@topo/preview-adapter`, and durable product concepts through the canonical LLM context contract.
