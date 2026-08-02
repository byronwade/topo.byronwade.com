# @topo/cache

Owns inspection and cleanup of Topo's derived local cache.

The module's entire write authority is `<projectRoot>/.topo/cache`. It never
follows symbolic links and does not own snapshots, component previews, notes,
flows, LLM exports, or project state. Both the CLI and daemon use this module so
cache behavior has one implementation and one safety boundary.
