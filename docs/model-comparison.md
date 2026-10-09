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

Each example is submitted once per condition using an opaque target ID; intended labels and semantic example IDs do not enter the model prompt. Both conditions share the same classification/output policy. Only the reference lesson instructions and retrieved pairs differ. Ordinary browsing and model preparation now omit the reference guide; guided prompts require explicit developer-experiment opt-in. No production setting exposes that control.

Arm order alternates across examples. Each arm creates a fresh provider/base session, clones it, then destroys the clone and closes the base. An eight-second deadline includes availability, session creation, cloning and inference; failures are controlled codes, never retained exception messages. Single-example calls isolate this developer experiment, rather than changing the runtime's normal batching policy.

Only examples with valid output from both arms enter paired metrics, at unchanged thresholds of 0.70 and 0.85. Low-evidence outputs abstain; the application-policy column additionally applies classifier disagreement/composition safeguards. Missing arms are shown explicitly and cannot become perfect performance. Timings include session and browser overhead, not pure inference latency.

The examples are separate from the original seed and reference-guide text, but the same implementation agent authored their intended labels. They are not independently labelled held-out ground truth. A single run is sensitive to sampling, warm state and Chrome model updates; the report cannot pin a model snapshot. Repeat on eligible hardware with separate reviewed examples before making improvement claims. Model results never enter the browsing cache or corrections.

## Session lifecycle

Provider close now cancels availability, creation, cloning and inference waits independently of the caller's signal. Each base session has its own abort controller, consistent with Chrome's [documented session cancellation](https://developer.chrome.com/docs/ai/prompt-api#create_a_session). Cancelled or failed bases are discarded, and late-created bases or clones receive cleanup without starting a prompt. An older rejected creation or late clone-cleanup error cannot clear a newer base. Overlapping calls return no refinement rather than starting another prompt; the runtime keeps its existing local result.

The sixty-second idle timer is suspended only when an eligible, available batch starts model work, then rearmed after that work settles. Empty/oversized/ineligible batches and unavailable follow-ups do not prolong an existing idle deadline; aborted calls discard the base immediately. Idle expiry and repeated close calls attempt cleanup once per owned base. A clone-cleanup exception invalidates its own base; cleanup errors are not logged with model or page data. Explicit model preparation and its user-download requirement are unchanged.

Sixteen unit regressions cover cancellation across all four phases, ignored aborts, late settlement, fresh-session ownership, overlapping calls, failures and timer behavior. Five initial cases reproduced failures before the fix. Two additional browser cases cancel the packaged comparison during mocked creation or cloning, then release the late handle and verify cleanup with zero prompts. These tests establish application cleanup behavior, not actual Chrome model memory, worker/process CPU or engine cooperation when abort/destroy fails. Independent quality and native resource acceptance remain pending; prompts, output validation, thresholds and automatic hiding are unchanged.

## Development verification

Unit tests cover balanced examples, label separation, alternating arm order, paired coverage, output redaction, cancellation and ignored-abort deadlines. Browser tests use mocked model responses to check no inference/download on render, trusted run clicks, unchanged preferences, exported fields, session release and accessible results. Mocked percentages are test fixtures, not Chrome model quality measurements.

`pnpm model:probe` performs a read-only check in an empty, disposable windowed installed-Chrome profile and loopback web page; add `--headless` for a windowless check. It never calls model `create()`, opens live sites or touches the user's profile. It retains Chrome's sandbox and normal model services without forcing feature or eligibility flags. Chrome's normal background component/network activity is allowed; the probe does not request a model download. The temporary profile is removed afterward.

On 8 October 2026, Chrome 155.0.8059.40 returned `downloadable` in both corrected probe modes. An earlier `unavailable` result was confounded by [Playwright's default launcher switches](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts), which suppress OptimizationHints, component updates and background networking. A separate isolated windowed diagnostic, using Chrome's [internal debugging page](https://developer.chrome.com/docs/ai/debug-built-in-model), reported device capability, sufficient VRAM/disk and no installed model. The read-only probe itself requested no creation/download.

## Real model findings

Three real runs on 8 October 2026 used the packaged extension at commit `9af2c09`, Chrome 155.0.8059.40 and an isolated windowed profile. Developer installation used Chrome's [Extensions.loadUnpacked command](https://chromium.googlesource.com/chromium/src.git/+/225b2eaa7f23c33b7c4e30c1bfc58f1bd99cbe1c%5E%21/) over a private debugging pipe with `--enable-unsafe-extension-debugging`; no model eligibility flags were forced. The Settings preparation button downloaded and initialized the model. Browsing analysis was then disabled before running the comparison. Each run exported numeric results through the comparison page. The temporary profile and its model were removed afterward.

The [numeric snapshot](../evaluation/reports/chrome-reference-2026-10-08.json) retains all outcomes, including missing outputs. At threshold 0.70, false positives below are counts among the intended useful examples with valid outputs in both arms:

| Run | Valid pairs | Baseline false positives | Guided false positives | Missing guided outputs |
| --- | ----------- | ------------------------ | ---------------------- | ---------------------- |
| 1   | 11/12       | 1/5                      | 2/5                    | 1                      |
| 2   | 9/12        | 2/4                      | 1/4                    | 3                      |
| 3   | 11/12       | 1/6                      | 4/6                    | 1                      |

All 36 baseline calls returned valid matched outputs; 31 of 36 guided calls did. No call reached the eight-second deadline. A `missing` outcome means no validated target result was returned, not a diagnosed model failure cause. All three reports remain `incomplete`. These are repetitions of the same 12 invented examples, not 36 independent examples; intended labels still come from the implementation agent.

The application composition abstained on every paired useful example in both conditions, producing no positive useful-example classifications at 0.70 in these runs. That is incomplete, conservative coverage—not proof of accuracy. Raw sarcasm scores were high in both conditions, and the guided arm also flagged useful quoted criticism, a question and a caveat in some runs. Reference benefit was not established, so guidance is now developer-only; ordinary prompts use the existing baseline policy and provider/cache suffix `chrome-prompt-v4`.

Valid calls took a median 1.889 seconds without references and 2.214 seconds with references; nearest-rank p95 was 2.564 and 4.776 seconds respectively. These timings include session/browser overhead and omit missing outputs; they are not CPU, RAM, battery or reference-hardware acceptance. The snapshot records the earlier `chrome-prompt-v3` comparison build. No prompt was tuned to these case labels, thresholds were not lowered, and automatic hiding remains disabled. Independent accuracy, minimum-device/resource profiling and live-platform acceptance remain open.
