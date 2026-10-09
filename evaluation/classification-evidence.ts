import { CLASSIFIER_VERSION } from '../src/shared/types';
import { packagedFilesMatch } from './package-evidence';
import { SLICES } from './schema';
import { wilsonFprUpper, type metrics } from './metrics';

type Metrics = ReturnType<typeof metrics>;
export const REQUIRED_SLICES = [
  'short',
  'generic_praise',
  'generic_disagreement',
  'parent_paraphrase',
  'slang',
  'sarcasm',
  'non_native',
  'polished',
  'messy',
  'technical',
  'lists',
  'em_dash',
  'obvious_ai',
  'subtle_ai',
  'edited_ai',
  'human_edited_ai',
  'ai_slang',
  'long_form',
] as const;
export const PROTECTED_SLICES = [
  'non_native',
  'polished',
  'technical',
  'short',
] as const;
export const PLATFORMS = [
  'reddit',
  'youtube',
  'linkedin',
  'x',
  'medium',
  'synthetic',
] as const;
export const KINDS = [
  'post',
  'comment',
  'reply',
  'quote_commentary',
  'article',
  'article_response',
] as const;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const probability = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;
const same = (value: unknown, expected: number | null) =>
  expected === null
    ? value === null
    : probability(value) && Math.abs(value - expected) <= 1e-12;
const ratio = (n: number, d: number) => (d ? n / d : null);

function readMetrics(value: unknown, threshold: number): Metrics | undefined {
  const m = object(value);
  if (
    m.threshold !== threshold ||
    !['samples', 'tp', 'fp', 'tn', 'fn', 'abstained'].every((key) =>
      count(m[key]),
    )
  )
    return;
  const { samples, tp, fp, tn, fn, abstained } = m as unknown as Metrics;
  if (
    tp + fp + tn + fn !== samples ||
    !count(tp + fp + tn + fn) ||
    abstained > tn + fn ||
    !same(m.precision, ratio(tp, tp + fp)) ||
    !same(m.recall, ratio(tp, tp + fn)) ||
    !same(m.fpr, ratio(fp, fp + tn)) ||
    !same(m.fnr, ratio(fn, tp + fn)) ||
    !same(m.coverage, ratio(samples - abstained, samples))
  )
    return;
  return {
    samples,
    threshold,
    tp,
    fp,
    tn,
    fn,
    abstained,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    fpr: ratio(fp, fp + tn),
    fnr: ratio(fn, tp + fn),
    coverage: ratio(samples - abstained, samples),
  };
}

function pair(
  value: Record<string, unknown>,
): { blocker: Metrics; only: Metrics } | undefined {
  const blocker = readMetrics(value.blocker, 0.85),
    only = readMetrics(value.only, 0.7);
  if (
    !blocker ||
    !only ||
    blocker.samples !== only.samples ||
    blocker.abstained !== only.abstained ||
    blocker.tp + blocker.fn !== only.tp + only.fn ||
    blocker.fp + blocker.tn !== only.fp + only.tn ||
    only.tp < blocker.tp ||
    only.fp < blocker.fp
  )
    return;
  return { blocker, only };
}

function confidenceValid(
  value: unknown,
  m: Metrics,
  repetitions: number,
): boolean {
  const source = object(value),
    intervals = object(source.intervals);
  if (
    source.method !== 'source-group bootstrap' ||
    source.repetitions !== repetitions ||
    source.seed !== 42 ||
    !same(source.fprWilsonUpper, wilsonFprUpper(m.fp, m.tn))
  )
    return false;
  return ['precision', 'recall', 'fpr'].every((key) => {
    const interval = intervals[key];
    if (m[key as 'precision' | 'recall' | 'fpr'] === null)
      return interval === null;
    return (
      Array.isArray(interval) &&
      interval.length === 2 &&
      probability(interval[0]) &&
      probability(interval[1]) &&
      interval[0] <= interval[1]
    );
  });
}

function coverageValid(
  value: unknown,
  names: readonly string[],
  samples: number,
): boolean {
  const source = object(value);
  return (
    Object.keys(source).length === names.length &&
    names.every((name) => Object.hasOwn(source, name) && count(source[name])) &&
    names.reduce((sum, name) => sum + (source[name] as number), 0) === samples
  );
}

// Shared by evaluation export and release acceptance: report flags never define these gates.
export function classificationChecks(value: unknown) {
  const source = object(value),
    parsed = pair(source),
    slices = object(source.slices);
  const blocker = parsed?.blocker,
    only = parsed?.only;
  const slicePairs = Object.fromEntries(
    Object.entries(slices).map(([name, value]) => [name, pair(object(value))]),
  );
  const protectedCounts = PROTECTED_SLICES.map((name) => {
    const m = slicePairs[name]?.blocker;
    return m ? m.fp + m.tn : 0;
  });
  const metadata =
    count(source.heldOutSamples) &&
    count(source.reviewedSamples) &&
    count(source.excludedAmbiguousOrUnreviewed) &&
    count(source.protectedNegatives) &&
    source.heldOutSamples ===
      source.reviewedSamples + source.excludedAmbiguousOrUnreviewed;
  const ranking = object(source.ranking);
  const shape =
    source.schemaVersion === 2 &&
    metadata &&
    !!blocker &&
    !!only &&
    blocker.samples === source.reviewedSamples &&
    (source.protectedNegatives as number) <= blocker.fp + blocker.tn &&
    (source.protectedNegatives as number) >= Math.max(...protectedCounts) &&
    (source.protectedNegatives as number) <=
      protectedCounts.reduce((sum, n) => sum + n, 0) &&
    (blocker.tp + blocker.fn
      ? probability(ranking.prAuc)
      : ranking.prAuc === null) &&
    (blocker.samples - blocker.abstained
      ? probability(ranking.calibrationErrorClassified)
      : ranking.calibrationErrorClassified === null) &&
    confidenceValid(source.confidence, blocker, 1000) &&
    coverageValid(source.platformCounts, PLATFORMS, blocker.samples) &&
    coverageValid(source.kindCounts, KINDS, blocker.samples) &&
    Object.entries(slices).every(([name, value]) => {
      const selected = slicePairs[name];
      return (
        (SLICES as readonly string[]).includes(name) &&
        !!selected &&
        selected.blocker.samples > 0 &&
        selected.blocker.samples <= blocker.samples &&
        ['blocker', 'only'].every((arm) => {
          const m = selected[arm as 'blocker' | 'only'],
            all = parsed[arm as 'blocker' | 'only'];
          return ['tp', 'fp', 'tn', 'fn', 'abstained'].every(
            (key) =>
              (m[key as keyof Metrics] as number) <=
              (all[key as keyof Metrics] as number),
          );
        }) &&
        confidenceValid(object(value).confidence, selected.blocker, 300)
      );
    });
  const intervals = object(object(source.confidence).intervals),
    fprInterval = intervals.fpr;
  return {
    reportStructure: !!shape,
    independentlyReviewedHeldOut:
      metadata &&
      source.heldOutSamples === source.reviewedSamples &&
      (source.reviewedSamples as number) >= 2000,
    protectedNegatives:
      metadata && (source.protectedNegatives as number) >= 500,
    blockerPrecision:
      !!blocker && blocker.precision !== null && blocker.precision >= 0.9,
    blockerFpr: !!blocker && blocker.fpr !== null && blocker.fpr <= 0.03,
    fprConfidence:
      !!blocker &&
      confidenceValid(source.confidence, blocker, 1000) &&
      (wilsonFprUpper(blocker.fp, blocker.tn) ?? Infinity) <= 0.05 &&
      Array.isArray(fprInterval) &&
      probability(fprInterval[1]) &&
      fprInterval[1] <= 0.05,
    onlyPrecision: !!only && only.precision !== null && only.precision >= 0.75,
    onlyRecall: !!only && only.recall !== null && only.recall >= 0.65,
    protectedSlices: PROTECTED_SLICES.every((name) => {
      const m = slicePairs[name]?.blocker;
      return !!m && m.fp + m.tn >= 50 && m.fpr !== null && m.fpr <= 0.05;
    }),
    requiredSlices: REQUIRED_SLICES.every(
      (name) => (slicePairs[name]?.blocker.samples ?? 0) > 0,
    ),
    platformCoverage: PLATFORMS.filter((name) => name !== 'synthetic').every(
      (name) =>
        count(object(source.platformCounts)[name]) &&
        (object(source.platformCounts)[name] as number) > 0,
    ),
    kindCoverage: KINDS.every(
      (name) =>
        count(object(source.kindCounts)[name]) &&
        (object(source.kindCounts)[name] as number) > 0,
    ),
  };
}

export function classificationMatchesPackage(
  value: unknown,
  currentFiles: unknown,
): boolean {
  const source = object(value),
    report = object(source.evaluationReport);
  const checks = classificationChecks(report),
    declared = object(report.checks);
  return (
    source.schemaVersion === 1 &&
    source.kind === 'reviewed-classification' &&
    packagedFilesMatch(source.files, currentFiles) &&
    report.classifierVersion === CLASSIFIER_VERSION &&
    report.automaticHide === false &&
    report.statisticalGatesPass === true &&
    Object.entries(checks).every(
      ([name, passed]) => passed && declared[name] === true,
    )
  );
}
