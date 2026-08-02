# `@topo/storage`

Durable local project state for the graph, route snapshots, component preview artifacts, interaction-probe artifacts, findings, and jobs. The first adapter uses atomic JSON in `.topo/state.json`; additive arrays rehydrate safely from older version-1 state. Probe replacement is scoped to the routes actually rerun so unrelated evidence survives. The interface remains ready for a SQLite adapter without changing daemon or Studio callers.
