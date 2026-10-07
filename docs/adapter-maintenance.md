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

## Public smoke procedure

Run `pnpm build`, then `pnpm live:smoke` for a public, signed-out check. It launches installed Chrome in a disposable windowed profile with normal browser services; `--headless` is an optional alternate context, not a substitute for manual desktop validation. The developer loading command installs only the packaged SlopZap build through a private debugging pipe. No eligibility, user-agent or access-control overrides are used. The normal user profile is untouched, model analysis/debug collection remain disabled, and cleanup removes the temporary profile even after launch or installation failure.

Before visiting live routes, an invented Reddit fixture is fulfilled locally at one exact test route. It must produce a healthy runtime snapshot with bindings and local classifications. This control proves injection/message/local-analysis plumbing; it is not live-platform evidence. A failed control stops the check instead of producing misleading site failures.

The probe reads active-tab numeric snapshots rather than matching tab URLs. The existing manifest does not grant URL metadata, while [Chrome's Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) supports selecting a tab and messaging its content script without that metadata. No new `tabs`, `activeTab` or host permission is added. Only validated counts, known platform/failure codes, HTTP status and route/challenge booleans are printed. Unknown fields, malformed counters and arbitrary codes are rejected or stripped; no page text, account details, URLs, HTML, screenshots, traces or raw exceptions are retained.

A `units_observed` result would show only that the declared structure bound units—not that authored boundaries, quotes, hierarchy, expanded replies or all dynamic behaviors have been manually validated. HTTP 200, zero candidates, missing snapshots and authentication/challenge outcomes never count as live acceptance. The runner exports `liveAcceptance:false` for every observation.

Known sign-in, signup and access-challenge route prefixes are explicitly excluded from adapters, including LinkedIn authwall/checkpoint and X login-flow routes. SPA navigation to them restores host content, releases bindings and stops further classification. Returning to a discussion resumes normal behavior. Prefix checks are anchored so public discussions about login are not excluded merely for mentioning it in their path.

## Current live observations

On 8 October 2026, installed Chrome 155.0.8059.40 parsed three invented control units successfully. All five signed-out public navigations returned HTTP 200, but none exposed a target unit within the bounded wait. Reddit and Medium contained possible challenge frames; LinkedIn reached an authentication route and its runtime was unsupported; YouTube and X exposed no target candidates. Every live snapshot had zero bindings/classifications and no health failure. No challenge was bypassed and no content was copied. The [numeric record](live-smoke-results-2026-10-08.json) retains these outcomes as inconclusive, not successful compatibility checks.

Remaining validation needs permitted public discussions that actually render posts/comments, with a normal developer installation and manual authored-boundary/dynamic checks. Authentication may be required to view some public surfaces, but private groups, messages and editors remain out of scope. Do not broaden selectors, bypass challenges or infer release readiness from inaccessible pages.
