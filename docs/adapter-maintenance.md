# Adapter maintenance

Each adapter exports an `Adapter` from `src/adapters/types.ts`. It declares supported host/routes, smallest feed/thread roots, candidates, an authored body, identity, parent relationships and route key. Shared text helpers exclude sensitive UI. Adapters never import classification/providers/cache/rendering.

To fix an adapter:

1. Reproduce against an invented fixture or capture a minimal public DOM fragment with permission to use it.
2. Replace real text, names, handles and IDs. Remove scripts, cookies, hidden JSON and authentication metadata.
3. Confirm each target body's closest candidate is its own unit; exclude quoted X sources and child reply lists.
4. Add dynamic insertion/edit/recycling and ambiguous/missing-body cases to browser tests.
5. Run `pnpm check` and `pnpm test:e2e`.
6. Smoke test the live desktop route and record date, Chrome version, selected structure and parsing outcome without copying content into logs.

Selector preference is semantic attributes, stable IDs, accessible structure, then narrowly scoped platform classes. Return `null` when parsing is ambiguous. Never broaden to arbitrary text or hide a wrapper containing child units.

Shared extraction treats the body selectors as an ordered fallback chain. If the selected variant matches more than one eligible authored body for the same candidate, parsing returns `null` instead of choosing the first. Descendant replies, quoted sources and sensitive fields are excluded before this ambiguity check.

Runtime health samples the first near-viewport parse of each distinct candidate element, using a weak set so detached nodes are not retained and repeated edits do not inflate failures. It keeps only the latest 100 boolean outcomes. Twenty consecutive failures, or less than 50% success after at least 20 samples, pause that route. A parser exception pauses immediately. Pausing invalidates pending results, disconnects observers, clears queues/bindings and restores SlopZap-hidden bodies. It does not delete cached scores or local corrections.

The popup shows a fixed diagnostic code (`adapter_parse_failures` or `adapter_parse_exception`) and **Retry page check**. Counts/codes are ephemeral and contain no content, IDs, fingerprints, URLs or exception messages. Mode/provider/site/global-enable changes do not reset a pause; navigation to a new route, reload or explicit retry starts a new health session. If retry encounters the same failure, the route pauses again. Retry messages require the extension's own ID and an extension-page sender URL.

Current fixtures are invented structural approximations. They verify extraction invariants, not current live-site compatibility. The release checklist requires dated live smoke results for all five platforms.

Run `node scripts/live-smoke.mjs` after a production build for a public, signed-out check. It uses a disposable Chromium profile and logs only status, route-auth flag, candidate count and annotation count. It does not bypass sign-in/access challenges, copy text or persist page HTML.

The 2026-10-07 environment check exposed no candidate units on Reddit or YouTube within the initial load window, reached a LinkedIn authentication route, could not complete X navigation, and received HTTP 403 from Medium. These results are inconclusive for authenticated, normally rendered feeds and do not count as successful live compatibility validation. The adapters correctly left these pages unchanged. Use a permitted signed-in manual smoke session before claiming support is release-ready.
