# Classification evaluation

`pnpm eval` reports precision, recall, false-positive/negative rates and slice misses at the Slop Only threshold. The 24-example seed corpus is invented development material, authored by the implementation agent. Labels describe intended low-information slop, not proven authorship. It is deliberately small and cannot establish detector accuracy or satisfy release gates.

The shipped scorer is an untrained, transparent heuristic. All its results have `automaticHide: false`. Chrome Prompt results also retain this restriction. Manual exact-item corrections exercise Blocker safely.

Before enabling automatic hiding, collect the independently reviewed ≥2,000-item corpus in SPEC.md, group paraphrases/templates by source before splitting, reserve a held-out test set, report protected-slice confidence intervals and abstention, and record the exact scorer/provider version. Do not use this seed as training data and then report its training performance as validation.

Do not upload browsing feedback. Corpus contributions need deliberate author/licensing consent and removal of identifying data. Real platform comments are not implicitly licensed training material.

## Reviewed corpus commands

`pnpm train reviewed.jsonl experimental-model.json` fits logistic weights on train rows and calibration on validation rows. `pnpm eval:corpus reviewed.jsonl [experimental-model.json]` reports the held-out metrics and exits nonzero if statistical release gates fail. Output models are experimental and are never automatically deployed. Existing output files and the input corpus cannot be overwritten.

JSONL contains one object per line (a JSON array file is also accepted). Required fields are `id`, `splitGroup`, `split` (`train`, `validation`, `test`), `platform`, `kind`, `text`, `language`, `provenance` (`synthetic`, `consented`, `licensed`), `permission`, `slop` (0/1), `slices` and `reviews`. Optional `parent` is capped at 800 characters. Each review is `{ "reviewer": "opaque_review_id", "slop": 0 }`; two distinct agreed reviewers are required for counted ground truth. Use opaque reviewer IDs rather than names. Disagreement belongs in the `ambiguous` slice. Metadata cannot itself verify independence or permissions.

The controlled slice vocabulary is defined in `schema.ts`; protected slices are `non_native`, `polished`, `technical` and `short`. Source/template groups and duplicate normalized text cannot cross splits. All examples must be deliberately supplied and reviewed, never harvested from browsing. Reports contain aggregate metrics, not example text, identities or source URLs. See `docs/classification.md` for scoring, uncertainty and deployment restrictions.
