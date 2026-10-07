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

Current fixtures are invented structural approximations. They verify extraction invariants, not current live-site compatibility. The release checklist requires dated live smoke results for all five platforms.

Run `node scripts/live-smoke.mjs` after a production build for a public, signed-out check. It uses a disposable Chromium profile and logs only status, route-auth flag, candidate count and annotation count. It does not bypass sign-in/access challenges, copy text or persist page HTML.

The 2026-10-07 environment check exposed no candidate units on Reddit or YouTube within the initial load window, reached a LinkedIn authentication route, could not complete X navigation, and received HTTP 403 from Medium. These results are inconclusive for authenticated, normally rendered feeds and do not count as successful live compatibility validation. The adapters correctly left these pages unchanged. Use a permitted signed-in manual smoke session before claiming support is release-ready.
