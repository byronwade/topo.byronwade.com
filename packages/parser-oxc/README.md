# `@topo/parser-oxc`

Native Oxc parser module for imports, re-export dependencies, runtime exports, source locations, required-prop hints, and recoverable diagnostics. `parseModule()` uses Oxc's direct ESM metadata and compiler-grade JS/JSX/TS/TSX AST, while a bounded source-identity cache keeps unchanged daemon rescans inexpensive. Callers receive a small, versioned, serializable read model rather than Oxc AST implementation details.
