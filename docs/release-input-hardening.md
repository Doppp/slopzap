# Release evidence input hardening

The Milestone 14 hardening pass bounds the development release checker's JSON reads and prevents malformed evidence from leaking parser excerpts or filesystem paths. It changes no packaged extension code, permissions, classifier policy or review approvals. Independent/manual release acceptance remains pending.

## Accepted inputs

The manifest remains `docs/release-evidence.json`. Referenced artifacts must be direct `.json` files under `.output/verification`, `.output/benchmarks` or `evaluation/reports`, with a filename containing only ASCII letters, digits, underscores, dots or hyphens. Artifact paths are at most 256 characters. Absolute paths, traversal, nested directories, other extensions and references back to the manifest are rejected.

Each input must be a nonempty regular file of at most 1,048,576 bytes containing valid UTF-8 and one JSON object. Arrays, primitives, malformed JSON, invalid encoding and trailing JSON fail closed. The limit applies to encoded bytes, including whitespace, not characters. It is an evidence-summary limit, not a corpus-ingestion limit; raw corpora and browser traces do not belong in these summaries.

The reader checks the repository root and each input's parent directories for symlinks, then checks the file type and size before opening. It uses read-only flags, final-symlink protection and nonblocking mode, where supported by Node's [file-open constants](https://nodejs.org/api/fs.html#file-open-constants). Opened-file identity, size and modification metadata must match the initial check. Reads allocate at most the allowed file size plus one sentinel byte; observed truncation or growth is rejected. File and parent-directory identities are checked again before parsing, and opened handles are closed even on validation or parsing failure.

## Failure behavior

Missing, unreadable or invalid inputs become unavailable evidence, never successful checks. An invalid manifest produces the normal structured readiness report with the schema gate false and exit status 1. An invalid referenced report fails its corresponding gate. Parser and filesystem exceptions are not logged or copied into output. Valid reviewed artifacts still pass their existing statistical, performance and exact-package checks; no acceptance threshold changes.

## Verification and limits

Three pre-fix CLI regressions reproduced a content-bearing parser error, a crash on a `null` manifest and acceptance of a symlinked reproducibility report. Seventy new unit/CLI cases cover those failures, manifest/report symlinks and parent links, unopened FIFOs, byte-limit boundaries, invalid encoding, path allowlists, partial reads, observed file replacement/mutation and handle cleanup. Fixtures contain invented data only. The full development suite passes 653 unit tests and 58 Chromium tests; all 28 packaged files reproduce with the unchanged build fingerprint.

These checks are not an atomic filesystem snapshot or protection against an attacker actively swapping parent directories and restoring them between observations. Repository-root ancestors, filesystem integrity and report authenticity remain trusted. Nonblocking open rejects ordinary pipe inputs without waiting for a writer; it does not establish a wall-clock deadline for a stalled regular file on a broken filesystem. Run from a trusted local checkout without concurrent evidence/package writes, then rerun against the final candidate. The checker cannot establish independent labeling, consent, reference hardware, native resource attribution or manual security signoff. All eight outstanding release gates remain unapproved.
