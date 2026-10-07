# Performance verification

`pnpm test:e2e` includes a 1,000-comment feed test: initial inference must remain under 40 units, then a distant visible comment must receive its own result. Other tests assert no inference on mode changes, zero new inference after a cached reload, and no retained bindings after feed removal.

The runtime caps candidate registrations at 1,000, trims inactive bindings above 300, slices discovery at 200 traversed elements or five milliseconds, batches local compute at 16, and keeps optional model prompts separate from local response latency.

These CI invariants do not establish the frame/CPU/RAM budgets in SPEC.md. Before public release, use a fixed reference laptop, Chrome stable, extension enabled/disabled controls and a 30-minute virtualized feed. Record Chrome traces, long tasks, p95 frames, CPU, GC/heap plateau, dropped frames, cache latency and provider resources at 100/500/1,000 items. Repeat at 4× CPU throttling. Fail release if extension-attributable long tasks or growing detached-node retention remain.

Use the packaged synthetic test feed from Settings to reproduce local scrolling behavior. It supports batch insertion, nested replies, removal and route changes. It contains no real browsing text.

## Automated runners

`pnpm benchmark --duration=5` runs paired enabled/disabled-processing controls at 100, 500 and 1,000 invented units under 1× and 4× CPU throttling. The extension stays installed in both controls; the disabled control turns off processing, rather than claiming the extension is absent. It emits numeric JSON and Playwright trace artifacts under `.output/benchmarks`. CI uses one-second runs for deterministic candidate, viewport-inference and cleanup regressions, not frame/heap acceptance.

`pnpm benchmark --long --duration=1800` performs a 30-minute, 1,000-unit local virtualization diagnostic with periodic forced GC, CDP heap/DOM counters, bounded frame samples and binding counts. It reports the final heap relative to the first sample at or after ten minutes. This single enabled run is not a paired reference-machine acceptance. Run the full dedicated protocol in SPEC.md before approving release.

Timing diagnostics are opt-in in Settings and contain at most 128 recent samples per metric. Mutation/discovery/render timings measure callback/slice duration. Cache/classify timings include extension IPC and therefore are not pure worker-compute benchmarks. CDP heap counters and zero runtime bindings do not prove zero retained detached DOM nodes; use a reviewed heap snapshot on the reference machine for that requirement. Benchmark traces must contain invented fixtures only; never enable tracing in a live-site smoke check.

`pnpm reproducibility` builds twice and compares SHA-256 for every packaged file, saving `.output/verification/reproducibility.json`. It does not claim ZIP-byte equality, since archive metadata can differ. `pnpm release:check` requires explicit reviewed evidence and will remain unsuccessful for local smoke results alone.
