# Performance verification

`pnpm test:e2e` includes a 1,000-comment feed test: initial inference must remain under 40 units, then a distant visible comment must receive its own result. Other tests assert no inference on mode changes, zero new inference after a cached reload, and no retained bindings after feed removal.

The runtime caps candidate registrations at 1,000, trims inactive bindings above 300, slices discovery at 200 traversed elements or five milliseconds, batches local compute at 16, and keeps optional model prompts separate from local response latency.

These CI invariants do not establish the frame/CPU/RAM budgets in SPEC.md. Before public release, use a fixed reference laptop, Chrome stable, extension enabled/disabled controls and a 30-minute virtualized feed. Record Chrome traces, long tasks, p95 frames, CPU, GC/heap plateau, dropped frames, cache latency and provider resources at 100/500/1,000 items. Repeat at 4× CPU throttling. Fail release if extension-attributable long tasks or growing detached-node retention remain.

Use the packaged synthetic test feed from Settings to reproduce local scrolling behavior. It supports batch insertion, nested replies, removal and route changes. It contains no real browsing text.

## Automated runners

`pnpm benchmark --duration=5` runs paired enabled/disabled-processing controls at 100, 500 and 1,000 invented units under 1× and 4× CPU throttling. The extension stays installed in both controls; the disabled control turns off processing, rather than claiming the extension is absent. It emits numeric JSON and Playwright trace artifacts under `.output/benchmarks`. CI uses one-second runs for deterministic candidate, viewport-inference and cleanup regressions, not frame/heap acceptance.

`pnpm benchmark --long --duration=1800` performs a 30-minute, 1,000-unit local virtualization diagnostic with periodic forced GC, CDP heap/DOM counters, bounded frame samples and binding counts. It reports the final heap relative to the first sample at or after ten minutes. This single enabled run is not a paired reference-machine acceptance. Run the full dedicated protocol in SPEC.md before approving release.

## Reference machine handoff

The available development computer on 8 October 2026 was an Apple M5 Pro with 15 cores and 24 GiB RAM. It does not match SPEC.md §30's roughly 2021 four-core reference laptop. Four one-second installed-Chrome controls passed on this computer, but they are runner smoke tests, not 30-minute or reference-hardware acceptance.

On the reference machine, install Node 24+, the repository's pnpm version and current desktop Chrome, then run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm benchmark --paired-long --chrome --duration=1
pnpm benchmark --paired-long --chrome --duration=1800
```

The final command runs four separate disposable profiles: processing disabled/enabled at 1×, then disabled/enabled at 4× renderer CPU throttling, each with 1,000 invented units for thirty minutes. Allow about two hours plus startup/cleanup. `--chrome` uses installed windowed Chrome's developer loading command over a private debugging pipe, retains normal browser services and leaves the normal user profile untouched. It must be supported by the installed Chrome; no eligibility or access-control overrides are used. Omitting `--chrome` retains bundled headless Chromium. `--long` remains the legacy single enabled diagnostic.

Each report records browser version, generic CPU/RAM metadata, a SHA-256 fingerprint of the packaged build and renderer-only throttle scope. The runner aborts if that package changes between scenarios or before export. Settings use the trusted extension message protocol. A final post-run GC sample supplements periodic samples, and missing runtime snapshots fail regression checks. Compare enabled/disabled results within the same backend/report; headed and headless frame rates are not interchangeable.

These are processing-disabled controls with the extension still installed, not extension-absent baselines. Renderer throttling/heap metrics do not measure service-worker CPU/heap or prove zero detached-node retention. Complete the extension-absent baseline, worker/resource attribution, reviewed heap snapshots, idle CPU and every SPEC budget separately before signing off. `referenceHardwareAcceptance` remains false automatically, including on a matching laptop; reviewed evidence belongs in `docs/release-evidence.json`.

Timing diagnostics are opt-in in Settings and contain at most 128 recent samples per metric. Mutation/discovery/render timings measure callback/slice duration. Cache/classify timings include extension IPC and therefore are not pure worker-compute benchmarks. CDP heap counters and zero runtime bindings do not prove zero retained detached DOM nodes; use a reviewed heap snapshot on the reference machine for that requirement. Benchmark traces must contain invented fixtures only; never enable tracing in a live-site smoke check.

`pnpm reproducibility` builds twice and compares SHA-256 for every packaged file, saving `.output/verification/reproducibility.json`. It does not claim ZIP-byte equality, since archive metadata can differ. `pnpm release:check` requires explicit reviewed evidence and will remain unsuccessful for local smoke results alone.
