# `@topo/studio-api`

The small, React-independent composition kernel behind Topo Studio. A Studio is
one immutable object containing keyed destinations and commands:

```ts
const studio = defineStudio({
  destinations: {
    atlas: {
      label: "Atlas",
      description: "Routes and flows",
      path: "/atlas/flows",
    },
  },
  commands: {},
});
```

Extend a definition with another keyed object. `false` removes an inherited
entry; `remove.destinations` and `remove.commands` provide readable removal
lists; an object adds or replaces one. Route roots and identifiers are validated
once, and the returned definition is frozen. The React-aware source-preview API
adds `customizeStudio()` and `useStudio()` from `apps/studio/src/api.ts` so most
custom Studio builds never need to call this lower-level package directly.

The same package exports the default product's inspectable visual contract:

```ts
import { findStudioBoard, studioBoards, studioFrame } from "@topo/studio-api";

const board = findStudioBoard("/atlas/flows?demo=1");
console.log(board?.id, studioBoards.length, studioFrame.width);
```

`studioBoards` is the 23-board Paper ledger, `studioFrame` contains the exact
1440 × 900 shell and pane measurements, and `findStudioBoard()` ignores
session-only query parameters. These exports describe and verify Topo's shipped
defaults; they do not restrict project-defined destinations.
