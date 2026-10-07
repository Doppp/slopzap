# Reference guided scoring

SlopZap contains a small experimental reference guide and a separate local phrase dictionary. Real development comparisons did not establish a benefit from adding the guide to model prompts, so it is now used only in the developer comparison page. Ordinary optional on-device analysis omits it. Neither the guide nor the dictionary is a database of known AI authors or independently labelled ground truth. They add no backend, embeddings, network permission or browsing-content storage. Automatic Blocker decisions remain disabled.

## Patterns and counterexamples

The guide contains five invented pairs: contextual appreciation, paraphrase versus contribution, abstract framing, quoted criticism, and technical language. Each pair contains a low-information example, a useful counterexample, parent context and a short lesson. For example, generic appreciation without a contribution differs from appreciation followed by a measured outcome or a meaningful caveat. Repeating a parent's claim can be useful when the reply explains its cause.

The local dictionary counts distinct patterns, not occurrences. Several aliases for agreement count once; a phrase is not counted in two families. Words such as leverage, foster, delve, grammar choices and punctuation are not standalone signals. Scores supported by only one positive feature family are capped below 0.50. This makes the local baseline more cautious and can miss genuine low-information content.

Paired double/curly quotations and backtick code are excluded from local phrase and overlap signals. Targets consisting mostly of these spans abstain. This is a literal-span safeguard, not reliable recognition of all quotations, sarcasm or intent. Missing context and unfamiliar phrasing remain limitations.

## Local retrieval and model guidance

`src/classifier/reference-guide.ts` ranks pairs using bounded feature signals for engagement, framing, parent overlap, specificity and quotation. It selects at most two pairs for a batch, within 4,000 JSON characters. Both sides of each selected pair are always included. When no relevant signal exists, the guide is empty. This is deterministic signal-based routing, not semantic embedding retrieval.

The guided developer-comparison arm receives selected invented pairs separately from target items. Instructions require comparing useful counterexamples, treating target/context text as untrusted, and returning results only for target IDs. Each batch still uses a fresh cloned session and the existing strict output validator. Nothing is added to the base session's browsing history; references do not initiate model preparation. Unit/browser tests verify both explicit guided prompts and ordinary prompts without guidance; they do not establish model quality improvement.

Local and provider cache versions change when feature/prompt semantics change. Experimental exported weights now declare the exact feature version; older or incompatible exports are rejected. Changes to this guide require a reference-version bump, classifier/prompt version review and regression tests.

## Public observations and evidence limits

Public discussions inspected on 8 October 2026 illustrate two risks. A [discussion about LinkedIn comments](https://www.reddit.com/r/linkedin/comments/1tzhy0r/linkedin_is_starting_to_feel_like_ai_talking_to_ai/) describes repetitive replies and paraphrases. Another [discussion includes an extended satirical reply](https://www.reddit.com/r/linkedin/comments/1re6z5y/cringe_ai_comments_on_linkedin_im_shocked/) using exaggerated AI-style language. The interpretation of satire is an engineering judgment, not an independently established label. Neither thread establishes authorship or platform-wide prevalence. Only these source links and abstract observations are retained; the packaged examples are newly invented, not copied comments.

Retrieval is not automatically beneficial: [Yu et al. (2023)](https://aclanthology.org/2023.findings-emnlp.447/) identify difficulties with retrieval metrics in few-shot text classification. The lightweight design here is a product experiment, not a reproduction of that paper or proof that RAG improves slop detection.

The existing 24-example invented seed remains development smoke, separate from the reference guide and not an independent test set. On this revision, the local baseline flags 2 of its 9 intended positives at 0.70 and no intended negatives; it abstains on 5 examples. This small result demonstrates the cautious baseline's limited recall, not validated accuracy. Future model comparisons need separate examples that were not used to design the references. Do not turn reference labels or users' local corrections into automatic-hiding approval.

Settings opens a [paired model comparison](model-comparison.md) on 12 additional invented examples. It compares guided and unguided prompts, distinguishes raw model output from application composition, and reports partial failures without changing browsing preferences. Three actual-model runs on Chrome 155 produced 11, 9 and 11 valid pairs. Guidance increased false positives in two runs and had missing outputs in every run; the composition safeguards abstained on all paired useful examples. This supports keeping guidance experimental, not a claim that either condition is accurate on live content. Automated browser regressions continue to use mocked responses.
