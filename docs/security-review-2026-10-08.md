# SlopZap security boundary review

The 8 October 2026 implementation-agent review hardened cache metadata, diagnostic labels and dynamic editor/private DOM boundaries, and pinned CI dependencies. This is development hardening, not independent security/privacy signoff or public-release approval. Classifier safety gates and permission scope are unchanged.

## Fixed boundaries

Cache messages now accept only the deployed local and Chrome Prompt classifier versions. Arbitrary short version strings could previously retain content disguised as metadata. Obsolete versions, malformed reason arrays and corrupt records are rejected; valid exact-item corrections remain intact. A packaged-browser test sends an invented version canary and verifies rejection without an IndexedDB record.

Diagnostic platform and failure labels must be primitive allowlisted strings. Boxed strings, arrays and objects with custom coercion methods cannot survive projection or execute coercion. These tests establish the malformed-input contract; they do not establish that ordinary Chrome messages previously leaked page content.

A browser regression reproduced a corrected hidden body remaining hidden after becoming an editor. Runtime observers now watch privacy attributes and release unsafe bindings, restoring presentation. Dispatch, rendering and feedback recheck current containment and sensitive context, including a trusted click whose capture listener turns the body into an editor. Cosmetic class changes do not trigger extraction or inference; public transitions use bounded rediscovery. Ordinary public body replacement remains defensively reparsed. Four invented-content browser cases cover editor entry/recovery, private reparenting, messaging-class transitions and the click race, alongside the existing malformed-edit health regression.

## Source inspection scope

| Boundary                 | Inspected behavior                                                                              | Acceptance limit                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Messages and storage     | Sender checks, bounded envelopes, declared derived fields, correction/cache validation          | Targeted malformed-input regressions, not independent penetration testing |
| DOM lifecycle            | Identity/generation guards, current privacy checks, cleanup/restoration                         | Invented fixtures, not current authenticated live feeds                   |
| Optional on-device model | Fresh clones, deadlines, strict output schemas, no tools, developer-only guidance               | Independent model quality and resource acceptance remain pending          |
| Production data flow     | Generated manifest/CSP, storage permission, narrow content matches, no shipped remote inference | Mock remote provider is not production authentication                     |

Inspection covered background messaging, protocol/cache/shared validators, runtime, renderer, diagnostics, provider contracts and packaged build checks. No private profile, credentials, live editor drafts or message contents were used.

## Dependencies and CI

Both `pnpm audit --prod` and `pnpm audit` reported no known vulnerabilities on 8 October 2026. This is a locked registry-advisory snapshot, not a complete dependency-code audit.

CI uses immutable commits verified against each upstream repository's release tag. All four action manifests use Node 24. Checkout explicitly disables persisted credentials; the token remains read-only, and ordinary push/pull-request triggers remain unchanged. Full commit pins and least-privilege tokens follow [GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use). The release metadata and manifests were reviewed, not every bundled third-party implementation.

| Action                  | Release | Pinned commit                              |
| ----------------------- | ------- | ------------------------------------------ |
| actions/checkout        | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| pnpm/action-setup       | v6.1.0  | `ea17c68df8912ef543352723c149a84f56e3d413` |
| actions/setup-node      | v7.0.0  | `820762786026740c76f36085b0efc47a31fe5020` |
| actions/upload-artifact | v7.0.2  | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

## Verification and remaining gates

The final development build passed `pnpm check` with 83 unit tests, `pnpm test:e2e` with 43 Chromium tests, all twelve enabled/disabled short benchmark scenarios and reproducible hashes for 28 packaged files. ZIP byte equality is not claimed. The benchmark snapshot is `2026-10-08T01-44-51-863Z.json` under `.output/benchmarks`; this is short regression coverage, not reference-hardware acceptance.

Independent classifier quality, current permitted live-platform checks, paired reference-hardware profiling, manual accessibility, security/privacy review, disclosure approval and architecture signoff remain release gates. No score threshold, abstention policy or automatic-hide gate was relaxed.
