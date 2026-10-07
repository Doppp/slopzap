# Contributing

Read README.md, SPEC.md, ARCHITECTURE.md and AGENTS.md. Install with the frozen pnpm lockfile. Run `pnpm check`, `pnpm format:check`, and browser tests before proposing DOM changes.

Keep commits focused around observable behavior. Include the trigger, result and relevant verification in pull requests. Use invented or deliberately sanitized fixtures, never live private page content. Do not include credentials or cookies in issue reports.

Adapter changes belong in `src/adapters/<platform>.ts`, an updated fixture and browser tests. ESLint enforces the boundary against cache/provider/scoring imports. See the adapter maintenance guide.

Classifier changes require evaluation by type and protected slices, not just more matched “AI words.” Do not enable automatic hiding on the development seed corpus. User corrections stay local and are not training data.

Privacy-sensitive permission, storage or network changes need an updated data-flow description and tests. Package code locally. New dependencies should have a concrete purpose and remain outside the content-script bundle when possible.
