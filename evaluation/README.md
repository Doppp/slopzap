# Classification evaluation

`pnpm eval` reports precision, recall, false-positive/negative rates and slice misses at the Slop Only threshold. The 24-example seed corpus is invented development material, authored by the implementation agent. Labels describe intended low-information slop, not proven authorship. It is deliberately small and cannot establish detector accuracy or satisfy release gates.

The shipped scorer is an untrained, transparent heuristic. All its results have `automaticHide: false`. Chrome Prompt results also retain this restriction. Manual exact-item corrections exercise Blocker safely.

Before enabling automatic hiding, collect the independently reviewed ≥2,000-item corpus in SPEC.md, group paraphrases/templates by source before splitting, reserve a held-out test set, report protected-slice confidence intervals and abstention, and record the exact scorer/provider version. Do not use this seed as training data and then report its training performance as validation.

Do not upload browsing feedback. Corpus contributions need deliberate author/licensing consent and removal of identifying data. Real platform comments are not implicitly licensed training material.
