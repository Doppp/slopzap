import { metrics } from '../../evaluation/metrics';
import { classify } from '../classifier/local';
import { REFERENCE_VERSION } from '../classifier/reference-patterns';
import { ChromePromptProvider, factory } from '../providers/chrome-prompt';
import { compose, PROVIDER_VERSION } from '../providers/compose';
import { validateOutput, type ProviderInput } from '../providers/types';
import { abortable } from '../shared/async';
import { CLASSIFIER_VERSION } from '../shared/types';
import { COMPARISON_CASES, COMPARISON_CASE_VERSION } from './comparison-cases';

type Arm = 'baseline' | 'guided';
export type RunArm = (
  input: ProviderInput,
  references: boolean,
  signal: AbortSignal,
) => Promise<unknown>;
interface Outcome {
  status:
    | 'ok'
    | 'missing'
    | 'invalid'
    | 'failed'
    | 'timeout'
    | 'cancelled'
    | 'not_run';
  score: number | null;
  evidence: number | null;
  composedScore: number | null;
  elapsedMs: number;
}
interface Row {
  caseId: string;
  label: 0 | 1;
  baseline: Outcome;
  guided: Outcome;
}
const empty = (status: Outcome['status']): Outcome => ({
  status,
  score: null,
  evidence: null,
  composedScore: null,
  elapsedMs: 0,
});
export const chromeArm: RunArm = async (input, references, signal) => {
  const provider = new ChromePromptProvider(factory(), references);
  try {
    return (await provider.classify([input], signal))[0];
  } finally {
    provider.close();
  }
};

export async function modelComparison(
  run: RunArm,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void = () => {},
  deadlineMs = 8000,
) {
  const rows: Row[] = [];
  let calls = 0;
  const deadline = Number.isFinite(deadlineMs)
    ? Math.max(1, Math.min(8000, deadlineMs))
    : 8000;
  for (
    let index = 0;
    index < COMPARISON_CASES.length && !signal.aborted;
    index++
  ) {
    const example = COMPARISON_CASES[index]!;
    const { text, parentText, rootText, quotedText, platform, kind } =
      example.unit;
    const input: ProviderInput = {
      id: crypto.randomUUID(),
      unit: { text, parentText, rootText, quotedText, platform, kind },
    };
    const row: Row = {
      caseId: example.id,
      label: example.label,
      baseline: empty('not_run'),
      guided: empty('not_run'),
    };
    const local = classify(example.unit, '0'.repeat(64));
    // Alternate first arm to reduce systematic order/warm-start bias. Each arm
    // creates and closes a fresh provider; neither can reuse another's context.
    for (const arm of (index % 2
      ? ['guided', 'baseline']
      : ['baseline', 'guided']) as Arm[]) {
      if (signal.aborted) break;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener('abort', cancel, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, deadline);
      const started = performance.now();
      let outcome: Outcome;
      try {
        const candidate = await abortable(
          run(input, arm === 'guided', controller.signal),
          controller.signal,
        );
        const result =
          candidate === undefined
            ? undefined
            : validateOutput({ results: [candidate] }, [input])[0];
        if (!result)
          outcome = empty(candidate === undefined ? 'missing' : 'invalid');
        else {
          const application = compose(local, result);
          outcome = {
            status: 'ok',
            score: result.score,
            evidence: result.evidence,
            composedScore:
              application.status === 'classified' && application.evidence >= 0.6
                ? application.score
                : null,
            elapsedMs: 0,
          };
        }
      } catch {
        // Never retain exception messages, response prose or prompt text.
        outcome = empty(
          signal.aborted ? 'cancelled' : timedOut ? 'timeout' : 'failed',
        );
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
      }
      outcome.elapsedMs =
        Math.round(Math.max(0, performance.now() - started) * 100) / 100;
      row[arm] = outcome;
      onProgress(++calls, COMPARISON_CASES.length * 2);
    }
    rows.push(row);
  }
  const paired = rows.filter(
    (row) => row.baseline.status === 'ok' && row.guided.status === 'ok',
  );
  const summary = (arm: Arm, composed: boolean, threshold: number) =>
    metrics(
      paired.map((row) => ({
        label: row.label,
        group: row.caseId,
        score: composed
          ? row[arm].composedScore
          : row[arm].evidence! >= 0.6
            ? row[arm].score
            : null,
      })),
      threshold,
    );
  return {
    schemaVersion: 1,
    protocolVersion: 'paired-reference-comparison-v1',
    status: signal.aborted
      ? 'cancelled'
      : paired.length === COMPARISON_CASES.length
        ? 'complete'
        : 'incomplete',
    scope:
      'invented development comparison; not independent accuracy or release evidence',
    corpusVersion: COMPARISON_CASE_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    guidedPromptVersion: PROVIDER_VERSION,
    referenceVersion: REFERENCE_VERSION,
    modelSnapshot: 'not exposed or pinned by this experiment',
    releaseReady: false,
    automaticHide: false,
    plannedCases: COMPARISON_CASES.length,
    pairedCases: paired.length,
    attemptedCalls: calls,
    metrics: [0.7, 0.85].map((threshold) => ({
      threshold,
      baseline: {
        raw: summary('baseline', false, threshold),
        composed: summary('baseline', true, threshold),
      },
      guided: {
        raw: summary('guided', false, threshold),
        composed: summary('guided', true, threshold),
      },
    })),
    // Closed projection: static invented IDs/labels, numeric outcomes and codes.
    // No page text, hashes, source URLs, identities, settings or raw output.
    rows,
  };
}
export type ComparisonReport = Awaited<ReturnType<typeof modelComparison>>;
