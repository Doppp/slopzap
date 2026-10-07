# Reference guided scoring

SlopZap uses a small packaged reference guide to distinguish interchangeable engagement from useful contributions. It is an experimental aid to local scoring and optional on-device prompts, not a database of known AI authors or independently labelled ground truth. It adds no backend, embeddings, network permission or browsing-content storage. Automatic Blocker decisions remain disabled.

## Patterns and counterexamples

The guide contains five invented pairs: contextual appreciation, paraphrase versus contribution, abstract framing, quoted criticism, and technical language. Each pair contains a low-information example, a useful counterexample, parent context and a short lesson. For example, generic appreciation without a contribution differs from appreciation followed by a measured outcome or a meaningful caveat. Repeating a parent's claim can be useful when the reply explains its cause.

The local dictionary counts distinct patterns, not occurrences. Several aliases for agreement count once; a phrase is not counted in two families. Words such as leverage, foster, delve, grammar choices and punctuation are not standalone signals. Scores supported by only one positive feature family are capped below 0.50. This makes the local baseline more cautious and can miss genuine low-information content.

Paired double/curly quotations and backtick code are excluded from local phrase and overlap signals. Targets consisting mostly of these spans abstain. This is a literal-span safeguard, not reliable recognition of all quotations, sarcasm or intent. Missing context and unfamiliar phrasing remain limitations.

## Local retrieval and model guidance

`src/classifier/reference-guide.ts` ranks pairs using bounded feature signals for engagement, framing, parent overlap, specificity and quotation. It selects at most two pairs for a batch, within 4,000 JSON characters. Both sides of each selected pair are always included. When no relevant signal exists, the guide is empty. This is deterministic signal-based routing, not semantic embedding retrieval.

The optional Chrome model receives the selected invented pairs separately from the target items. Instructions require comparing useful counterexamples, treating target/context text as untrusted, and returning results only for target IDs. Each batch still uses a fresh cloned session and the existing strict output validator. Nothing is added to the base session's browsing history; references do not initiate model preparation. Tests verify prompt construction, not real-model quality improvement.

Local and provider cache versions change when feature/prompt semantics change. Experimental exported weights now declare the exact feature version; older or incompatible exports are rejected. Changes to this guide require a reference-version bump, classifier/prompt version review and regression tests.

## Public observations and evidence limits

Public discussions inspected on 8 October 2026 illustrate two risks. A [discussion about LinkedIn comments](https://www.reddit.com/r/linkedin/comments/1tzhy0r/linkedin_is_starting_to_feel_like_ai_talking_to_ai/) describes repetitive replies and paraphrases. Another [discussion includes an extended satirical reply](https://www.reddit.com/r/linkedin/comments/1re6z5y/cringe_ai_comments_on_linkedin_im_shocked/) using exaggerated AI-style language. The interpretation of satire is an engineering judgment, not an independently established label. Neither thread establishes authorship or platform-wide prevalence. Only these source links and abstract observations are retained; the packaged examples are newly invented, not copied comments.

Retrieval is not automatically beneficial: [Yu et al. (2023)](https://aclanthology.org/2023.findings-emnlp.447/) identify difficulties with retrieval metrics in few-shot text classification. The lightweight design here is a product experiment, not a reproduction of that paper or proof that RAG improves slop detection.

The existing 24-example invented seed remains development smoke, separate from the reference guide and not an independent test set. On this revision, the local baseline flags 2 of its 9 intended positives at 0.70 and no intended negatives; it abstains on 5 examples. This small result demonstrates the cautious baseline's limited recall, not validated accuracy. Future model comparisons need separate examples that were not used to design the references. Do not turn reference labels or users' local corrections into automatic-hiding approval.
