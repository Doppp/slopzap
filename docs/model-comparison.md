# Paired reference comparison

The reference comparison page tests Chrome on-device judgments with and without reference guidance on 12 newly invented examples. It measures the model's outputs separately from SlopZap's conservative composition policy. It does not certify accuracy, update a classifier, approve a release or enable automatic hiding.

## Run the experiment

1. Build the extension with `pnpm build` and load `.output/chrome-mv3` through a normal permitted developer installation in Chrome.
2. Open Settings, then **Open reference comparison** under Local diagnostics. Model availability must be `available` before the run button works. The comparison page never downloads a model.
3. If necessary and supported, use the existing explicit model preparation action in Settings. That action can enable on-device browsing analysis; disable it afterward if you only want the comparison. The comparison itself never changes preferences and can use a prepared model with browsing analysis disabled.
4. Review the invented examples, then choose **Run paired comparison**. Cancel stops new calls and aborts the active arm. Results are marked incomplete or cancelled when valid pairs are missing.
5. Choose **Export numeric comparison** to request a local JSON download. Nothing is uploaded. Export contains static example IDs, intended labels, bounded numeric scores/timings, failure codes, aggregate metrics and software/reference versions—not example text, live content, URLs, identities, fingerprints, settings or raw model prose.

Availability is not an instruction to force support. Chrome's [Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) describes conditional hardware support and an explicitly activated model download. Do not bypass eligibility or add a remote fallback just to produce a report.

## Comparison controls

Each example is submitted once per condition using an opaque target ID; intended labels and semantic example IDs do not enter the model prompt. Both conditions share the same classification/output policy. Only the reference lesson instructions and retrieved pairs differ. The ordinary browsing provider remains guided by default; no production setting exposes the experimental control.

Arm order alternates across examples. Each arm creates a fresh provider/base session, clones it, then destroys the clone and closes the base. An eight-second deadline includes availability, session creation, cloning and inference; failures are controlled codes, never retained exception messages. Single-example calls isolate this developer experiment, rather than changing the runtime's normal batching policy.

Only examples with valid output from both arms enter paired metrics, at unchanged thresholds of 0.70 and 0.85. Low-evidence outputs abstain; the application-policy column additionally applies classifier disagreement/composition safeguards. Missing arms are shown explicitly and cannot become perfect performance. Timings include session and browser overhead, not pure inference latency.

The examples are separate from the original seed and reference-guide text, but the same implementation agent authored their intended labels. They are not independently labelled held-out ground truth. A single run is sensitive to sampling, warm state and Chrome model updates; the report cannot pin a model snapshot. Repeat on eligible hardware with separate reviewed examples before making improvement claims. Model results never enter the browsing cache or corrections.

## Development verification

Unit tests cover balanced examples, label separation, alternating arm order, paired coverage, output redaction, cancellation and ignored-abort deadlines. Browser tests use mocked model responses to check no inference/download on render, trusted run clicks, unchanged preferences, exported fields, session release and accessible results. Mocked percentages are test fixtures, not Chrome model quality measurements.

`pnpm model:probe` performs a read-only check in an empty, disposable headless installed-Chrome profile and loopback web page. It never calls model `create()`, opens live sites or touches the user's profile. On 8 October 2026, Chrome 155.0.8059.40 exposed the API but returned `unavailable` in this context. No creation/download was requested. This does not prove that a normal installed extension or every profile on the machine lacks support; real on-device comparison remains unverified.
