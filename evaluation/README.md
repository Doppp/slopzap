# Classification evaluation

`pnpm eval` reports precision, recall, false-positive/negative rates and slice misses at the Slop Only threshold. The 24-example seed corpus is invented development material, authored by the implementation agent. Labels describe intended low-information slop, not proven authorship. It is deliberately small and cannot establish detector accuracy or satisfy release gates.

The shipped scorer is an untrained, transparent heuristic. All its results have `automaticHide: false`. Chrome Prompt results also retain this restriction. Manual exact-item corrections exercise Blocker safely.

The packaged reference guide is invented classifier/prompt guidance, not additional validation data. Keep new test examples separate from guidance and do not count retrieved references as held-out evaluation. Experimental model exports declare the exact feature version and incompatible prior exports are rejected. See `docs/reference-guidance.md`.

Before enabling automatic hiding, collect the independently reviewed ≥2,000-item corpus in SPEC.md, group paraphrases/templates by source before splitting, reserve a held-out test set, report protected-slice confidence intervals and abstention, and record the exact scorer/provider version. Do not use this seed as training data and then report its training performance as validation.

Do not upload browsing feedback. Corpus contributions need deliberate author/licensing consent and removal of identifying data. Real platform comments are not implicitly licensed training material.

## Reviewed corpus commands

`pnpm train reviewed.jsonl experimental-model.json` fits logistic weights on train rows and calibration on validation rows. `pnpm eval:corpus reviewed.jsonl [experimental-model.json]` reports the held-out metrics and exits nonzero if statistical release gates fail. Output models are experimental and are never automatically deployed. Existing output files and the input corpus cannot be overwritten.

JSONL contains one object per line (a JSON array file is also accepted). Required fields are `id`, `splitGroup`, `split` (`train`, `validation`, `test`), `platform`, `kind`, `text`, `language`, `provenance` (`synthetic`, `consented`, `licensed`), `permission`, `slop` (0/1), `slices` and `reviews`. Optional `parent` is capped at 800 characters. Each review is `{ "reviewer": "opaque_review_id", "slop": 0 }`; two distinct agreed reviewers are required for counted ground truth. Use opaque reviewer IDs rather than names. Disagreement belongs in the `ambiguous` slice. Metadata cannot itself verify independence or permissions.

The controlled slice vocabulary is defined in `schema.ts`; protected slices are `non_native`, `polished`, `technical` and `short`. Source/template groups and duplicate normalized text cannot cross splits. All examples must be deliberately supplied and reviewed, never harvested from browsing. Reports contain aggregate metrics, not example text, identities or source URLs. See `docs/classification.md` for scoring, uncertainty and deployment restrictions.

## Classification release evidence

The corpus evaluator now exports schema version 2, with platform/type counts and shared gate calculations. Reports must cover all eighteen required SPEC §29 slices, not just the four protected slices. The gate requires 2,000 agreed held-out rows, 500 distinct protected negatives, at least fifty negatives in each protected slice, fixed 0.85/0.70 thresholds and the original precision, recall and FPR limits. Excluded ambiguous or unreviewed rows remain explicit and prevent held-out approval under the current all-reviewed gate.

For release review, start with [the unapproved wrapper](../docs/classification-review-template.json). Put the complete schema-version-2 evaluator output in `evaluationReport` and the complete file-name/SHA-256 map of the package actually evaluated in `files`. Save the wrapper under `.output/verification/classification-review.json`, then point `classification.report` in `docs/release-evidence.json` to it. Preserve the tested map when comparing another candidate; replacing it with new hashes does not validate a changed classifier. Leave `independentReviewApproved:false` until the corpus, provenance, reviewer independence, split isolation and exact deployed classifier have been reviewed.

`pnpm release:check` validates the wrapper and current package, rejects experimental or mismatched classifier versions, and recomputes gate decisions from validated integer confusion counts. Declared rates must agree with those counts within numerical serialization tolerance; gate comparisons use the recomputed rates, not rounded declarations. Counts, abstentions, label totals and prediction ordering must agree between thresholds; slice counts cannot exceed overall counts. Platform and type totals must match the reviewed sample count. Protected-union counts must be consistent with overlapping slice counts without summing overlaps as distinct examples.

The checker also validates ranking fields, confidence interval shape and the Wilson bound recomputed from the negative count. It requires the evaluator's source-group bootstrap configuration: seed 42, 1,000 overall resamples and 300 per slice. The bootstrap FPR upper bound must remain at most 0.05. Aggregate counts cannot reproduce bootstrap intervals or ranking statistics, establish permissions or prove human independence; retain the approved corpus and reproducible evaluation procedure for reviewer verification. Do not copy the fabricated passing aggregate distributions in unit tests into release evidence. The wrapper template contains no approved report.

Schema-version-1 reports and standalone `statisticalGatesPass:true` flags cannot satisfy release acceptance. Passing validation never deploys a model, changes thresholds or enables automatic hiding. The shipped provisional scorer remains capped below the Blocker threshold, so its statistical gate is not expected to pass; independent evidence and a separately reviewed production model are still required.
