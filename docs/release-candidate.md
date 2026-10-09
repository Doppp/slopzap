# Release candidate packaging and handoff

Milestone 15 now verifies the distributed ZIP against the current unpacked build and its reproducibility report. CI uploads only the verified archive, not every ZIP left in `.output`. This is development-alpha packaging evidence; the classifier, live-platform, reference-hardware and manual review gates still prevent public-release acceptance.

## Build and verify

Run from a trusted local checkout, without concurrent package or evidence writes:

```sh
pnpm check
pnpm test:e2e
pnpm reproducibility
pnpm zip
pnpm archive:check
pnpm release:check
```

`pnpm zip` rebuilds before archiving. The archive check therefore requires the ZIP's complete file map to match both the current `.output/chrome-mv3` and the earlier reproducibility report. A rebuild that changes any file fails that comparison. Missing or stale reproducibility evidence also fails. The manifest must satisfy the existing permission/context policy, contain a supported numeric version, and include all seven required packaged entrypoints. The version selects the exact `.output/slopzap-<version>-chrome.zip` candidate; an older or unrelated ZIP cannot substitute.

Successful verification saves `.output/verification/archive.json`, including the candidate path, SHA-256 of the whole archive, packaged-build fingerprint and complete per-file hash map. It explicitly retains `releaseReady:false` and `archiveByteEqualityClaimed:false`. The archive SHA identifies those exact distributed bytes; it is not a claim that ZIP bytes reproduce across machines or runs. This report is not a substitute for the separate reproducibility report or reviewed release evidence.

In GitHub Actions, the checker publishes its verified path through [the step output mechanism](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-output-parameter). The subsequent `slopzap-chrome-alpha` artifact upload uses only that path and runs only after success. The verification artifact includes both hash reports. For a failed command, ignore any report left from an earlier local run and do not distribute that candidate.

## Archive contract

Verification reads at most 1,048,576 archive bytes, permits at most 1,000 entries and caps total decompressed content at 500,000 bytes. It never extracts files. The bounded reader rejects symlinked files/parents, non-regular inputs and observed identity, size or modification changes. The ZIP parser accepts the narrow stored/deflated format emitted by the pinned WXT packager, following the relevant [PKWARE ZIP record definitions](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT). Unsupported ZIP features fail closed rather than receiving partial validation.

Local and central headers must agree on filenames, flags, methods, timestamps, CRC and sizes. Local records must occupy the entire data region without gaps or overlaps. Decompression is bounded by declared size and checked against actual size, consumed compressed bytes, CRC and SHA-256. Paths reject traversal, absolute/drive paths, separators with empty components, control/non-ASCII characters, Windows device names, duplicate/case-alias entries and file/directory collisions. Encryption, descriptors, ZIP64, split archives, directory/special-file entries, extra fields, comments and trailing data are unsupported.

The shared reader and parser have 103 new unit/CLI/workflow regressions using invented content. Local verification passes 756 unit tests and 58 Chromium tests. The actual WXT archive contains the same 28 reproducible files as the preceding build, with no production runtime, permissions or dependency changes.

## Release acceptance

Archive verification establishes a checked snapshot, not a signed release or atomic publication. Repository/filesystem integrity, CI provenance and the authenticity of reviewed evidence remain trusted. Compare the downloaded archive's SHA-256 with its trusted verification report; changing the archive after verification invalidates that handoff. The checker cannot establish classification accuracy, consent, live compatibility, reference hardware, native resource attribution or manual audits.

`pnpm release:check` must still pass all independent/manual gates before public release. The current manifest and listing remain development-alpha claims. Store publication requires the owner's developer account, final listing assets and confirmed submission details; this workflow neither submits nor pays fees. See [milestone status](milestones.md) and the [Store disclosure draft](store-disclosure-draft.md) for remaining acceptance.
