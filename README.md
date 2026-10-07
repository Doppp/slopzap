# ⚡ SlopZap

Zap AI-style social noise. SlopZap is an open-source Chrome extension that scores individual social posts, comments, and replies and gives you reversible ways to inspect a discussion.

**Development alpha:** the extension runs and is tested against invented platform fixtures. Scores are provisional heuristics, not proof of AI authorship. Automatic Blocker classification is gated until independent evaluation; items you locally mark as slop can be hidden now. Live platform compatibility and the public-release performance gates are still under evaluation.

## Try it locally

Requires desktop Chrome 138+, Node 24+ and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `.output/chrome-mv3` inside this repository. On a fresh install, SlopZap opens quick setup automatically: learn what the score means, choose your browsing view, and select sites. Finish with the optional demo or start browsing. Pin SlopZap to your toolbar using Chrome's Extensions menu.

Setup opens automatically only once. Closing it unfinished leaves an **Open quick setup** reminder in the popup; finishing saves completion and preferences locally. Updates and browser restarts preserve your settings. Existing alpha installations can start setup from the popup, and **Settings & privacy → Review quick setup** opens it again whenever you want. The synthetic test feed also stays available in Settings.

`pnpm zip` creates a distributable archive in `.output/`. GitHub's Checks workflow also uploads a tested development-alpha archive. The extension has not been submitted to the Chrome Web Store.

## Modes

| Mode         | What happens                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- |
| Slop Goggles | Adds a Slop Score and local correction controls                                               |
| Slop Blocker | Hides eligible suspected content with a Show control; this alpha hides local corrections only |
| Slop Only    | Keeps matching units and ancestor context; uncertain units remain visible                     |
| Slopometer   | Shows an average item score and analyzed sample size in the popup                             |
| Normal       | Restores the page; mode switching reuses existing classifications                             |

Adapters target LinkedIn, X/Twitter, YouTube comments, desktop Reddit, and Medium. Selectors live in separate modules and fail open on unexpected markup. Medium custom publication domains and legacy Reddit are outside the current target.

If repeated parsing failures or a parser exception indicate incompatible markup, SlopZap removes its changes and pauses that page route. The popup explains the pause and offers **Retry page check** after markup is repaired. Navigating to a new discussion or reloading also resets the check; changing modes does not bypass it. Ambiguous authored-body matches are left untouched.

## Privacy and classification

Local analysis is the default. No accounts, API keys, backend, telemetry, inference network requests, browsing-history collection, or full-page uploads. The optional Chrome Prompt API uses a browser-managed on-device model; enabling it may download a large model, and availability depends on hardware/browser support. It is tested through provider mocks; model quality on real hardware is not yet validated.

Private messaging routes, forms, compose fields, and group routes are excluded. Raw target/context text exists only in active runtime memory. IndexedDB stores derived scores and local exact-item corrections, with expiry and bounded eviction. Corrections are never uploaded. See [PRIVACY.md](PRIVACY.md).

Very short, unsupported-language, and overly long article text can abstain. Technical detail, context, and specificity lower scores. The English heuristic is untrained; the 24-example invented corpus is development material and does not establish accuracy. See [evaluation/README.md](evaluation/README.md) and [SPEC.md](SPEC.md) for release gates.

## Development and verification

```sh
pnpm dev                     # development extension
pnpm check                   # strict types, lint, unit tests, build, permissions/bundle budget
pnpm format:check
pnpm exec playwright install chromium
pnpm test:e2e                # real Chromium + unpacked production extension
pnpm eval                    # seed evaluation metrics; no accuracy claim
node scripts/live-smoke.mjs   # optional public signed-out smoke; never a CI prerequisite
```

Browser tests cover the five adapter fixtures, nested branches, insert/remove/edit events, SPA routes, excluded composers, cache reuse, zero-inference mode changes, 1,000 loaded comments, synthetic-feed cleanup and axe accessibility checks. Traces contain invented fixtures only. See [docs/benchmarking.md](docs/benchmarking.md) for the remaining real-machine performance checks.

[ARCHITECTURE.md](ARCHITECTURE.md) explains module ownership. [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/adapter-maintenance.md](docs/adapter-maintenance.md) describe contributions. [SECURITY.md](SECURITY.md) covers vulnerability reporting. MIT licensed.
