# Classification model card

SlopZap scores formulaic, low-information social content, not AI authorship. The shipped `provisional-features-v3` scorer is an untrained English-oriented heuristic. It is a development aid, not an accurate or calibrated detector. Automatic Blocker decisions remain disabled; only exact-item local corrections authorize hiding in Blocker.

## Inputs and safeguards

The scorer receives one authored unit with bounded parent, root and quote context. It does not use authors, handles, avatars, profiles, engagement counts or browsing history. Context affects the fingerprint, so editing a parent invalidates contextual scores and corrections.

Features combine generic engagement, formulaic structure, parent overlap, diversity and specificity. Fewer than eight tokens, unsupported language signals and articles over 8,000 characters abstain. Short results are capped at 0.79 and other heuristic results at 0.84. Grammar, polished writing, slang, em dashes and non-native English are not reliable authorship evidence.

The optional Chrome model runs on-device, after explicit preparation. Articles eligible for model refinement use five deterministic chunks of at most 1,200 characters, require three valid chunk results and aggregate a median with bounded repetition. Social batches take priority. Disagreement lowers evidence and never authorizes automatic hiding. Articles beyond the alpha's local eligibility limit still abstain; chunking is not permission to bypass that gate.

## Evaluation and experimental training

`pnpm eval` runs 24 invented development examples. Its results do not establish general accuracy. Do not train on that seed and present its training performance as validation.

`pnpm eval:corpus reviewed.jsonl` validates a supplied corpus and evaluates held-out rows. Every row declares a source/template group, split, licensing or consent basis, language, slices and review metadata. Groups and duplicate normalized texts cannot cross splits. Disputed or insufficiently reviewed test rows are excluded from ground truth and reported separately. Metadata cannot prove genuine independent human review.

`pnpm train reviewed.jsonl experimental-model.json` fits small logistic weights on the training split and calibration on the validation split. Test labels affect neither step. Both fitting splits need at least 20 agreed rows with both labels. The output is experimental, refuses to overwrite existing files, contains derived weights only, and is not imported by the extension. Evaluate it with `pnpm eval:corpus reviewed.jsonl experimental-model.json`.

Reports include confusion matrices, precision, recall, false-positive/negative rates, coverage, PR-AUC, calibration error on classified rows and protected slices. PR-AUC treats abstentions as the lowest-ranked outputs; coverage reports their prevalence. Confidence intervals resample source groups, with a conservative Wilson upper bound guarding against a zero-false-positive bootstrap collapsing to zero uncertainty.

## Release requirements

SPEC.md §29 requires at least 2,000 independently reviewed held-out examples, 500 protected human/non-slop negatives, protected-slice coverage, and fixed Blocker/Only precision, recall and false-positive gates. The corpus evaluator exits unsuccessfully when its statistical gates fail. It does not deploy weights or turn on automatic hiding even when they pass.

Deployment requires a separate review of the actual classifier version, consent/licensing, independent labeling, held-out performance and bias slices. No browsing corrections are uploaded as training material. See `evaluation/README.md` for the corpus schema.
