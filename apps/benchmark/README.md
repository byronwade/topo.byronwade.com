# Topo benchmark

Executable performance contract for Topo's local critical path. It measures a
real filesystem full scan, a reported one-file refresh through a persistent
scanner session, graph reconciliation, canonical LLM projection,
renderer-neutral Atlas layout, and shared camera interaction math.

```powershell
pnpm --filter @topo/benchmark build
pnpm benchmark --profile standard --check
pnpm benchmark --profile stress --format json --output artifacts/benchmarks/stress.json
pnpm benchmark --profile standard --format json --output artifacts/benchmarks/candidate.json --baseline artifacts/benchmarks/baseline.json --check
pnpm benchmark --browser --profile standard --check
pnpm benchmark --browser --profile stress --format json --output artifacts/benchmarks/browser-stress.json --check
pnpm benchmark:web -- --url http://127.0.0.1:3100 --output artifacts/benchmarks/website.json --iterations 5 --check
pnpm --filter @topo/benchmark studio:loading -- --output artifacts/benchmarks/studio-loading.json
pnpm --filter @topo/benchmark capture:performance -- --output artifacts/benchmarks/capture.json
pnpm --filter @topo/benchmark system:performance -- --output artifacts/benchmarks/system.json
```

Profiles are deterministic workload definitions. Timing reports include the
runtime and hardware context, every raw sample, median, p95, budget, latency
class, and exact workload dimensions. A saved-baseline comparison accepts only
the same runtime, profile, workloads, sample counts, and result identities. It
requires both median and p95 movement to name a trend, enforces a 50 ms ceiling
for hot operations, and preserves explicit cold/external budgets. `--check`
makes a workload or comparison failure machine-enforceable.

After the timed LLM projection samples, the runner parses the resulting
manifest and every generated record through the exported Zod schemas. This
keeps schema-conformance proof outside the timing interval while still making
it part of every successful CPU benchmark run.

Route and component organization use one immutable process-lifetime natural
text collator. The CPU profile therefore exercises the same constant-memory
sort path shared by Atlas scenes and canonical LLM projection.

The benchmark deliberately excludes fixture creation and cleanup from timed
samples. CPU/filesystem reports use contract version 2, default to 21 measured
samples, and name all six
workloads, including complete discovery and incremental refresh separately.
The incremental workload changes one source outside the timed interval, reuses
the session's unchanged source and loaded adapter registry, and still rebuilds
the complete normalized graph. Browser reports use contract version 2 and
exercise the actual Pixi renderer, texture upload,
bounded texture-cache pressure, 250 to 10,000 route-sized sprites, culled camera
frames, and four live iframes in Chromium. Version 3 runs the same on-demand
shared Pixi host used by Studio and separates sub-millisecond camera work from
display cadence. Its heap evidence separates the
baseline, active working set, and retained heap after Pixi teardown plus an
explicit CDP collection, so expected allocations are not mislabeled as leaks.
Every browser report names the renderer and GPU adapter; SwiftShader evidence
is never presented as native-GPU proof.

The website runner records five isolated Chromium navigations by default. It
budgets cold LCP and load milestones separately, requires CLS at or below 0.01,
and fails any measured main-thread task above the universal 50 ms hot-path
ceiling.

System report version 3 measures real 10,000-route framework adapters, daemon
startup and graph HTTP, a semantic one-route add/remove refresh over a
1,000-route workspace, complete manual rescan, and packaged CLI cold help.
Capture report version 1 separates local orchestration from external Chromium
batch time. Studio loading report version 3 separates isolated cold navigation
from cached-history destination switches and enforces the 50 ms ceiling only
on the hot class. Route-specific module-preload, browser-process reuse, state
batching, and coalesced derived writes must each be promoted through a retained
before/after comparison rather than an unpaired timing claim.
