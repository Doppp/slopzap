# SlopZap contributor instructions

Read SPEC.md before changing architecture. Use pnpm. Run `pnpm check` before committing runtime changes and `pnpm test:e2e` when changing DOM/runtime behavior.

Keep page content out of persistent storage and production logs. Never process messaging or editors. Cache/settings/providers belong to extension contexts; adapters must not import those modules. Fail open on ambiguous parsing or unavailable classification. Rendering must never trigger inference. Tests must use invented/sanitized content.

Changes should be focused commits with verification recorded. Do not lower classifier safety gates to claim a release is ready. Treat unvalidated local heuristics as provisional and prevent automatic hiding unless a user explicitly corrects an item.
