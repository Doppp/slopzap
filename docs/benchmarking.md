# Performance verification

`pnpm test:e2e` includes a 1,000-comment feed test: initial inference must remain under 40 units, then a distant visible comment must receive its own result. Other tests assert no inference on mode changes, zero new inference after a cached reload, and no retained bindings after feed removal.

The runtime caps candidate registrations at 1,000, trims inactive bindings above 300, slices discovery at 200 traversed elements or five milliseconds, batches local compute at 16, and keeps optional model prompts separate from local response latency.

These CI invariants do not establish the frame/CPU/RAM budgets in SPEC.md. Before public release, use a fixed reference laptop, Chrome stable, extension enabled/disabled controls and a 30-minute virtualized feed. Record Chrome traces, long tasks, p95 frames, CPU, GC/heap plateau, dropped frames, cache latency and provider resources at 100/500/1,000 items. Repeat at 4× CPU throttling. Fail release if extension-attributable long tasks or growing detached-node retention remain.

Use the packaged synthetic test feed from Settings to reproduce local scrolling behavior. It supports batch insertion, nested replies, removal and route changes. It contains no real browsing text.
