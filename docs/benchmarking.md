# Performance verification

`pnpm test:e2e` includes a 1,000-comment feed test: initial inference must remain under 40 units, then a distant visible comment must receive its own result. Other tests assert no inference on mode changes, zero new inference after a cached reload, and no retained bindings after feed removal.

The runtime caps candidate registrations at 1,000, trims inactive bindings above 300, slices discovery at 200 traversed elements or five milliseconds, batches local compute at 16, and keeps optional model prompts separate from local response latency.

These CI invariants do not establish the frame/CPU/RAM budgets in SPEC.md. Before public release, use a fixed reference laptop, Chrome stable, extension enabled/disabled controls and a 30-minute virtualized feed. Record Chrome traces, long tasks, p95 frames, CPU, GC/heap plateau, dropped frames, cache latency and provider resources at 100/500/1,000 items. Repeat at 4× CPU throttling. Fail release if extension-attributable long tasks or growing detached-node retention remain.

Use the packaged synthetic test feed from Settings to reproduce local scrolling behavior. It supports batch insertion, nested replies, removal and route changes. It contains no real browsing text.

## Automated runners

`pnpm benchmark --duration=5` runs twelve paired enabled/disabled-processing controls at 100, 500 and 1,000 invented units under 1× and 4× CPU throttling. Add `--with-absent` for eighteen scenarios: extension absent, installed with processing disabled, and installed with processing enabled at each size/rate. CI runs this expanded matrix for one second per scenario to check installation, candidate limits, viewport-driven inference and cleanup, not frame/heap acceptance. Numeric JSON and Playwright action traces go under `.output/benchmarks`.

`pnpm benchmark --long --duration=1800` performs a 30-minute, 1,000-unit local virtualization diagnostic with periodic forced GC, CDP heap/DOM counters, full-interval frame statistics and binding counts. It reports the final heap relative to the first sample at or after ten minutes. This single enabled run is not a paired reference-machine acceptance. Run the full dedicated protocol in SPEC.md before approving release.

Report schema v4 distinguishes all three controls and adds optional idle-CPU samples. An absent scenario never loads the package or opens its Settings page; runtime counters remain `null`, not fabricated zeros. The runner requires an empty unpacked-extension registry and no injected annotations at both ends. Installed controls require the exact loaded package ID/path to remain enabled in Chrome, independently of the processing preference. [CDP's unpacked-extension list](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json) excludes built-in browser components; their aggregate target count may be nonzero and does not indicate SlopZap installation. IDs, names and paths are not exported.

Frames use a fixed 40,004-byte histogram with 0.1 ms bins across the entire scripted-scroll observation interval, including benchmark GC/IPC work. Early slow frames no longer disappear after 1,200 samples. `p95Ms` is the bin's upper bound; lower/upper bounds are exported for comparisons. Frames at or above 1,000 ms enter an explicit overflow bucket; an overflowing p95 is `null`, not capped to a passing value. The over-33-ms ratio is a fixed-threshold jank proxy, not a measured dropped-frame rate, especially on high-refresh displays. Long-task observations include the fixture and harness, not just extension-attributed work. Playwright action traces are not Chrome performance traces.

Installed scenarios create their own blank fixture tab through the trusted extension page and retain the returned tab ID in memory. Snapshot requests target that ID, not whichever tab happens to be active. The driver retries initial content-listener readiness up to fifty times with 100 ms spacing, plus message overhead; unavailable snapshots still fail checks. No tab-reading permission is added and no tab ID is exported.

### Worker heap diagnostics

Add `--worker-heap` to a separate diagnostic run to collect post-GC counters from the exact packaged SlopZap service-worker target. For example:

```sh
pnpm benchmark --paired-long --with-absent --worker-heap --chrome --duration=1
```

Each sample discovers the current worker, attaches, invokes GC, reads [CDP JavaScript heap usage](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json), and immediately detaches. The export projects numeric used/allocated V8 heap, embedder heap and backing-storage bytes; it contains no raw objects, target IDs, URLs or browser error text. The V8 figure covers the corresponding isolate, not a particular Runtime. Do not add the counters together as a total-RAM estimate.

Absent extensions produce `not_installed` with a null heap. Stopped workers produce `not_running` with a null heap; the probe does not deliberately wake them. Missing/invalid counters and command failures remain `unavailable`, and duplicate or malformed target identities remain `ambiguous`. Unavailable/ambiguous states fail evidence-availability checks; later stopped-worker samples stay null rather than counting as measured coverage. Installed scenarios must begin with a valid measured sample. Target discovery, attachment, GC/heap commands and detachment each have five-second deadlines. Discovery timeout yields an unavailable null heap; attachment/detachment failure aborts the scenario and closes its disposable profile.

Deadlines stop waiting, not the underlying Chrome command. A delayed attachment can still complete, so failed or closed sessions cannot reconnect or register late response listeners. Closing during an attachment reports uncertain cleanup, not success; callers abort and close the disposable browser. Repeated close calls retain the first cleanup outcome and do not issue repeated detach commands. The same transport protects the real-toolbar probe. Probe deadlines must be integer milliseconds from 1 to 60,000; invalid configuration fails before discovery or attachment. This hardens diagnostic control flow without establishing normal service-worker lifecycle or release acceptance.

Debugger attachment and forced GC perturb lifecycle and timing, even though attachment lasts only for a sample. The report marks this explicitly. Keep unprobed frame/lifecycle runs separate from worker-heap diagnostics; CI runs both short controls. These counters do not measure worker CPU, process RAM, cold initialization, model cost, IndexedDB disk usage or detached DOM retention. Reference-hardware/resource approval remains a separate reviewed gate.

### Detached DOM diagnostics

Add `--detached-dom` to a separate invented-fixture diagnostic:

```sh
pnpm benchmark --paired-long --with-absent --detached-dom --chrome --duration=1
```

The probe forces GC and calls Chrome's experimental [DOM.getDetachedDomNodes command](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json) immediately before feed cleanup and again after removal and runtime cleanup. Each sample uses a fresh page debugger session, detached immediately to release inspector-side references. The export contains only detached-tree and unique retained-node counts. DOM text, attributes, IDs, trees and browser errors are not exported. Validation bounds projection work to 10,000 trees and 100,000 retained-ID entries; malformed or unavailable responses yield null counts and fail evidence-availability checks. Commands, attachment and detachment have five-second deadlines; attachment/detachment failure aborts the disposable scenario.

These are renderer-wide counts, including fixture/browser retention, not attribution to SlopZap bindings or a heap retainer-path review. Probes occur outside frame observation but perturb memory with forced GC and inspector tracking. Zero counts in a short run do not establish thirty-minute or reference-machine acceptance; nonzero counts require investigation rather than automatic attribution. Keep unprobed controls separate. The positive/negative browser test deliberately retains a two-node invented tree, verifies its detection, releases it, and requires zero counts afterward. That test disables Playwright tracing because DOM snapshots introduced additional retained trees; benchmark action traces already disable snapshots. CI keeps an unprobed eighteen-scenario run and a separate six-scenario combined worker/DOM diagnostic.

### Idle renderer CPU diagnostics

Run idle CPU separately from heap/DOM probes, with all three controls at both renderer rates:

```sh
pnpm benchmark --paired-long --with-absent --idle-cpu --idle-seconds=60 --chrome --duration=1
```

`--idle-cpu` requires `--paired-long --with-absent` and rejects `--worker-heap` or `--detached-dom` in the same run. `--idle-seconds` accepts integer windows from one to sixty seconds, defaulting to ten. CI uses a separate one-second window smoke run, not CPU-budget acceptance.

After scripted scrolling stops and the final heap sample finishes, the runner allows two seconds to settle, checks visibility and pending work, attaches a fresh page debugger session and enables [CDP thread-tick metrics](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json). [Chromium's implementation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/inspector/inspector_performance_agent.cc) exposes cumulative renderer-thread CPU as `ThreadTime`, monotonic wall time as `Timestamp`, and rejects unsupported thread timing. The runner computes `100 × delta(ThreadTime) / delta(Timestamp)`, representing one thread's utilization of one core, not a percentage of all CPU cores. Task CPU time is exported separately and must not be added to thread CPU time.

The runner resets renderer CPU emulation to 1× before settling; the collector also explicitly sets 1× before accounting. Scenario rates of 1×/4× still apply to the preceding scroll, not to the idle window. [Chromium's POSIX throttler](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/scheduler/common/thread_cpu_throttler.cc) delays the renderer using a busy-wait signal handler. An initial one-minute run measured about 76% of one core in every 4× idle control, including extension absent; a focused reset-to-1× control removed that load. Those original results are retained as contaminated observations, not extension CPU attribution. No division or baseline subtraction turns them into a passing budget.

The quiet wait is a Node timer: no page script, scrolling, forced GC, runtime snapshot, polling or worker-debugger attachment occurs inside it. Counter reads bracket that wait; inspector overhead and browser work still contribute. The page debugger detaches immediately afterward. Missing/duplicate/non-finite/reset counters, unsupported timing and implausible utilization remain unavailable with null values; they do not become measured zero. Attachment/detachment failures abort the disposable scenario. Command/attachment/cleanup deadlines are five seconds; the wait has its requested duration plus five seconds of grace.

Visible endpoints, zero pending items and unchanged classification counts are regression guards, not continuous proof of visibility or quiescence. These are renderer-wide main-thread samples, not SlopZap-only attribution, service-worker CPU, whole-process/system CPU, model cost or reference-hardware approval. The prior benchmark GC and debugger instrumentation also perturb the environment. Collect dedicated reference-machine profiles and attribution before accepting SPEC's idle-CPU budget. The positive browser control deliberately injects invented busy-loop work and verifies advancing CPU counters; ordinary measurement windows inject no such work.

`scrollDurationSeconds` ends when the frame probe stops. The legacy total `durationSeconds` also includes subsequent cleanup and the idle window; it must not be mistaken for thirty minutes of scrolling. `referenceHardwareAcceptance` remains false, regardless of measured utilization.

## Reference machine handoff

The available development computer on 8 October 2026 was an Apple M5 Pro with 15 cores and 24 GiB RAM. It does not match SPEC.md §30's roughly 2021 four-core reference laptop. Six one-second installed-Chrome scenarios, including two absent controls, passed on this computer; they are runner smoke tests, not 30-minute or reference-hardware acceptance.

On the reference machine, install Node 24+, the repository's pnpm version and current desktop Chrome, then run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm benchmark --paired-long --with-absent --chrome --duration=1
pnpm benchmark --paired-long --with-absent --chrome --duration=1800
```

The final command runs six separate disposable profiles: absent/processing disabled/processing enabled at 1×, then the same three states at 4× renderer CPU throttling, each with 1,000 invented units for thirty minutes. Allow about three hours plus startup/cleanup. `--chrome` uses installed windowed Chrome's developer loading command over a private debugging pipe, retains normal browser services and leaves the normal user profile untouched. The installed browser must support `Extensions.loadUnpacked` and `Extensions.getExtensions`; unsupported commands fail rather than silently skip installation checks. No eligibility or access-control overrides are used. Omitting `--chrome` retains bundled headless Chromium. `--long` remains the legacy single enabled diagnostic; adding `--with-absent` supplies its matching absent control. Omitting `--with-absent` preserves the previous four-scenario paired plan.

Each report records browser version, generic CPU/RAM metadata, a SHA-256 fingerprint of the packaged build and renderer-only throttle scope. The runner aborts if that package changes between scenarios or before export. Settings use the trusted extension message protocol. A final post-run GC sample supplements periodic samples, and missing runtime snapshots fail regression checks. Compare enabled/disabled results within the same backend/report; headed and headless frame rates are not interchangeable.

The full reference-machine absent and processing-control runs still need to be performed. Renderer throttling/heap metrics do not measure service-worker CPU or prove zero detached-node retention. The optional worker probe supplies separate isolate heap counters, not complete resource attribution or normal lifecycle evidence. Complete worker/resource attribution, reviewed heap snapshots, idle CPU, actual dropped-frame measurements and every SPEC budget separately before signing off. `referenceHardwareAcceptance` remains false automatically, including on a matching laptop; reviewed evidence belongs in `docs/release-evidence.json`.

Timing diagnostics are opt-in in Settings and contain at most 128 recent samples per metric. Mutation/discovery/render timings measure callback/slice duration. Cache/classify timings include extension IPC and therefore are not pure worker-compute benchmarks. CDP heap counters and zero runtime bindings do not prove zero retained detached DOM nodes; use a reviewed heap snapshot on the reference machine for that requirement. Benchmark traces must contain invented fixtures only; never enable tracing in a live-site smoke check.

## Package reproducibility and release checks

`pnpm reproducibility` builds twice and compares SHA-256 for every packaged file, saving `.output/verification/reproducibility.json`. It does not claim ZIP-byte equality, since archive metadata can differ. Benchmarks, reproducibility and the release checker share a scanner that rejects symbolic-link roots/descendants and non-regular resources. Scans are bounded to 500,000 bytes, 1,000 directory entries across the tree and sixteen nested directory levels. Bounded reads and opened-file checks reject observed size or identity changes. The aggregate benchmark fingerprint preserves the original directory ordering, independently of JSON field order.

`pnpm release:check` requires a schema-v1 reproducibility report with an explicit file map, `packagedFilesIdentical:true` and `archiveByteEqualityClaimed:false`. It hashes the current `.output/chrome-mv3` package and requires the complete names and lowercase SHA-256 values to match that report. Missing/unreadable packages, added/removed files, changed bytes, malformed maps and a standalone “identical” flag fail the reproducibility gate. Reports from an earlier run remain usable only when their full file map matches the current package exactly.

Run the checker again against the final candidate after packaging; do not rebuild or edit the candidate concurrently. File comparison establishes a snapshot match, not a signed release, atomic publication or independent review. The other eight evidence gates remain separate, and local smoke results alone cannot approve release. Tests exercise the command-line checker with invented matching/modified/missing/added/symlinked packages and verify that fixture text and temporary paths stay out of its output.
