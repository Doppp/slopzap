# SlopZap architecture policy validation

The 8 October 2026 development checks enforce the existing execution-context boundaries and reviewed package wiring. They close two verification gaps: a missing required content script could pass the old manifest check, and direct-import lint rules did not inspect indirect helpers. These changes affect development tooling only; runtime ownership, permissions, classifiers and release approval are unchanged.

## Source dependency checks

| Boundary                                  | Enforced import reachability                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Site adapters                             | No cache, settings-state, provider, classifier, scoring, messaging, UI or runtime dependencies; no external packages |
| Renderer                                  | No classifier, provider, cache, settings-state, messaging, UI or runtime dependencies; no external packages          |
| Local computation                         | Pure local/shared helpers, without browser packages, DOM modules, providers or persistent storage                    |
| Content and synthetic runtime entrypoints | No persistent cache implementation                                                                                   |
| Every packaged entrypoint                 | No mock remote coordinator                                                                                           |

The TypeScript parser/resolver reads source imports, re-exports, type references and literal dynamic imports/requires using the repository's alias configuration. It follows local helper modules even outside the initial source folders, terminates cycles and rejects unresolved/computed module loads. Invented regression graphs and a temporary alias fixture verify indirect violations; comments and string literals do not count as imports. Adapter lint also blocks direct settings-state imports.

This is an import-graph check, not a full data-flow or capability audit. CSS and external-package implementations are not traversed. Global API calls and behavior injected through callbacks still require source/runtime review. The existing browser regressions, privacy review and manual approval remain separate evidence.

## Manifest and package checks

The build requires exactly the reviewed storage permission, six supported match patterns, one packaged content script at `document_idle`, the service worker, popup and Settings wiring, and the strict extension CSP. Unknown contexts/fields, extra permissions, remote/page-accessible resources, missing/duplicate origins and main-world/frame overrides fail the check. Chrome's omitted world/frame fields retain the isolated top-frame defaults documented in its [content-script manifest reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts).

All seven required packaged entrypoints must exist as regular files, including onboarding, the invented harness and developer comparison. Package scanning rejects symlinks without following them and retains the 500 KB budget. Thin invented package fixtures exercise complete output, each missing entrypoint, oversize output, a symlink cycle and a linked manifest. They test the build checker, not browser execution of fixture scripts.

## Release approval remains separate

Local verification passed `pnpm check` with 125 unit tests, all 53 Chromium tests, formatting checks and reproducible hashes for 28 packaged files. The package remains 151.2 KiB. Browser tests ran after the build completed; no production module or manifest change was needed.

The checks add 42 unit regressions to the development suite. Manual architecture/security/privacy signoff, independent classifier quality, permitted live-platform validation and reference-hardware acceptance are still required. `docs/release-evidence.json` remains unapproved; passing these policies cannot enable automatic hiding or mark a public release ready.
