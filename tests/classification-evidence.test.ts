import { expect, test } from 'vitest';
import {
  classificationChecks,
  classificationMatchesPackage,
  REQUIRED_SLICES,
  PROTECTED_SLICES,
  PLATFORMS,
  KINDS,
} from '../evaluation/classification-evidence';
import { metrics, wilsonFprUpper } from '../evaluation/metrics';
import { readiness } from '../evaluation/readiness';
import template from '../docs/classification-review-template.json';
import {
  inventedClassificationReport,
  inventedClassificationFiles as files,
} from './fixtures/classification-evidence';

test('complete invented aggregates pass only their approved, current-build classification gate', () => {
  const wrapper = inventedClassificationReport();
  expect(
    Object.values(classificationChecks(wrapper.evaluationReport)).every(
      Boolean,
    ),
  ).toBe(true);
  expect(classificationMatchesPackage(wrapper, files)).toBe(true);
  const result = readiness(
    { classification: { independentReviewApproved: true } },
    { classification: wrapper, packagedFiles: files },
  );
  expect(result.checks.classification).toBe(true);
  expect(result.releaseReady).toBe(false);
  expect(
    readiness({}, { classification: wrapper, packagedFiles: files }).checks
      .classification,
  ).toBe(false);
});
test.each([
  undefined,
  null,
  [],
  {},
  template,
  {
    classifierVersion: 'provisional-features-v4:reference-guide-v1',
    statisticalGatesPass: true,
  },
])('missing, flag-only and unfilled evidence fails closed %#', (value) => {
  expect(classificationMatchesPackage(value, files)).toBe(false);
});
test.each([
  undefined,
  {},
  { 'invented.js': 'b'.repeat(64) },
  { ...files, 'extra.js': 'c'.repeat(64) },
])(
  'classification evidence is bound to the complete current package %#',
  (current) => {
    expect(
      classificationMatchesPackage(inventedClassificationReport(), current),
    ).toBe(false);
  },
);
test.each([
  'schema',
  'raw-schema',
  'kind',
  'version',
  'automatic-hide',
  'declared-pass',
  'check',
])('incompatible report metadata fails: %s', (mode) => {
  const wrapper = inventedClassificationReport(),
    report = wrapper.evaluationReport;
  if (mode === 'schema') wrapper.schemaVersion = 2;
  if (mode === 'raw-schema') report.schemaVersion = 1;
  if (mode === 'kind') wrapper.kind = 'smoke';
  if (mode === 'version') report.classifierVersion = 'experimental-logistic-v2';
  if (mode === 'automatic-hide') report.automaticHide = true;
  if (mode === 'declared-pass') report.statisticalGatesPass = false;
  if (mode === 'check') report.checks.blockerFpr = false;
  expect(classificationMatchesPackage(wrapper, files)).toBe(false);
});
test.each([
  'samples',
  'tp',
  'fp',
  'tn',
  'fn',
  'abstained',
  'precision',
  'recall',
  'fpr',
  'fnr',
  'coverage',
  'threshold',
])(
  'metrics cannot be missing, string-valued, negative or nonfinite: %s',
  (key) => {
    for (const value of [undefined, null, '0', false, -1, NaN, Infinity, {}]) {
      const wrapper = inventedClassificationReport();
      (wrapper.evaluationReport.blocker as unknown as Record<string, unknown>)[
        key
      ] = value;
      expect(classificationMatchesPackage(wrapper, files)).toBe(false);
    }
  },
);
test.each([
  'fractional',
  'totals',
  'abstentions',
  'ratio',
  'only-monotonic',
  'labels',
  'heldout',
  'protected-union',
])('internally inconsistent aggregates fail despite true flags: %s', (mode) => {
  const wrapper = inventedClassificationReport(),
    report = wrapper.evaluationReport;
  if (mode === 'fractional') report.blocker.tp += 0.5;
  if (mode === 'totals') report.blocker.samples++;
  if (mode === 'abstentions') report.only.abstained++;
  if (mode === 'ratio') report.blocker.fpr = 0;
  if (mode === 'only-monotonic') {
    report.only = { ...report.blocker, threshold: 0.7 };
    report.only.tp--;
  }
  if (mode === 'labels') report.only.tn--;
  if (mode === 'heldout') report.heldOutSamples++;
  if (mode === 'protected-union') report.protectedNegatives = 1001;
  expect(classificationMatchesPackage(wrapper, files)).toBe(false);
});
test.each(REQUIRED_SLICES)('required slice %s cannot be omitted', (name) => {
  const wrapper = inventedClassificationReport();
  delete wrapper.evaluationReport.slices[name];
  expect(classificationMatchesPackage(wrapper, files)).toBe(false);
});
test.each([...PLATFORMS.filter((name) => name !== 'synthetic'), ...KINDS])(
  'platform/type %s needs counted coverage',
  (name) => {
    const wrapper = inventedClassificationReport();
    wrapper.evaluationReport.platformCounts[name] = 0;
    wrapper.evaluationReport.kindCounts[name] = 0;
    expect(classificationMatchesPackage(wrapper, files)).toBe(false);
  },
);
test.each([
  'interval-missing',
  'interval-order',
  'interval-string',
  'interval-overflow',
  'upper-fpr',
  'wilson',
  'repetitions',
  'method',
  'seed',
  'ranking',
])('invalid uncertainty/ranking cannot be an approval: %s', (mode) => {
  const wrapper = inventedClassificationReport(),
    report = wrapper.evaluationReport;
  if (mode === 'interval-missing') report.confidence.intervals.fpr = null;
  if (mode === 'interval-order') report.confidence.intervals.fpr = [0.04, 0.01];
  if (mode === 'interval-string')
    report.confidence.intervals.fpr = ['0', '0.01'] as unknown as number[];
  if (mode === 'interval-overflow')
    report.confidence.intervals.fpr = [0, Infinity];
  if (mode === 'upper-fpr') report.confidence.intervals.fpr = [0, 0.05001];
  if (mode === 'wilson') report.confidence.fprWilsonUpper = 0;
  if (mode === 'repetitions') report.confidence.repetitions = 10;
  if (mode === 'method') report.confidence.method = 'unreviewed';
  if (mode === 'seed') report.confidence.seed = 0;
  if (mode === 'ranking') report.ranking.prAuc = null;
  expect(classificationMatchesPackage(wrapper, files)).toBe(false);
});
test.each(PROTECTED_SLICES)(
  'protected %s needs fifty negatives and <=5%% FPR',
  (name) => {
    const wrapper = inventedClassificationReport();
    const selected = wrapper.evaluationReport.slices[name]!;
    for (const [negatives, falsePositives, accepted] of [
      [49, 0, false],
      [50, 0, true],
      [100, 5, true],
      [100, 6, false],
    ] as const) {
      const rows = Array.from({ length: negatives }, (_, i) => ({
        label: 0 as const,
        score: i < falsePositives ? 0.9 : 0.1,
        group: 'invented',
      }));
      selected.blocker = metrics(rows, 0.85);
      selected.only = metrics(rows, 0.7);
      expect(
        classificationChecks(wrapper.evaluationReport).protectedSlices,
      ).toBe(accepted);
    }
  },
);
test('rate gate decisions recompute exact ratios rather than trusting near-boundary rounding', () => {
  const wrapper = inventedClassificationReport(),
    report = wrapper.evaluationReport;
  const fp = 900_000_000_001,
    tn = 30_000_000_000_000 - fp;
  const summary = (threshold: number) => ({
    samples: fp + tn + 1000,
    threshold,
    tp: 900,
    fn: 100,
    fp,
    tn,
    abstained: 0,
    coverage: 1,
    precision: 900 / (900 + fp),
    recall: 0.9,
    fpr: 0.03,
    fnr: 0.1,
  });
  report.blocker = summary(0.85);
  report.only = summary(0.7);
  expect(classificationChecks(report).blockerFpr).toBe(false);
  expect(wilsonFprUpper(0, 0)).toBeNull();
});

const summary = (
  tp: number,
  fp: number,
  tn: number,
  fn: number,
  threshold: number,
) => ({
  samples: tp + fp + tn + fn,
  threshold,
  tp,
  fp,
  tn,
  fn,
  abstained: 0,
  coverage: 1,
  precision: tp + fp ? tp / (tp + fp) : null,
  recall: tp + fn ? tp / (tp + fn) : null,
  fpr: fp + tn ? fp / (fp + tn) : null,
  fnr: tp + fn ? fn / (tp + fn) : null,
});
test.each([
  ['blockerPrecision', 900, 100, 900, 100, 950, 100, 900, 50, true],
  ['blockerPrecision', 899, 101, 899, 101, 950, 101, 899, 50, false],
  ['blockerFpr', 900, 30, 970, 100, 950, 40, 960, 50, true],
  ['blockerFpr', 900, 31, 969, 100, 950, 40, 960, 50, false],
  ['onlyPrecision', 700, 200, 800, 300, 750, 250, 750, 250, true],
  ['onlyPrecision', 700, 200, 800, 300, 749, 251, 749, 251, false],
  ['onlyRecall', 600, 10, 990, 400, 650, 20, 980, 350, true],
  ['onlyRecall', 600, 10, 990, 400, 649, 20, 980, 351, false],
] as const)(
  'fixed rate gate %s preserves its boundary %#',
  (gate, tp, fp, tn, fn, ot, of, on, om, accepted) => {
    const report = inventedClassificationReport().evaluationReport;
    report.blocker = summary(tp, fp, tn, fn, 0.85);
    report.only = summary(ot, of, on, om, 0.7);
    expect(classificationChecks(report)[gate]).toBe(accepted);
  },
);

test('held-out size and protected union gates keep their fixed minima', () => {
  const report = inventedClassificationReport().evaluationReport;
  expect(classificationChecks(report).independentlyReviewedHeldOut).toBe(true);
  expect(classificationChecks(report).protectedNegatives).toBe(true);
  report.reviewedSamples = report.heldOutSamples = 1999;
  report.protectedNegatives = 499;
  expect(classificationChecks(report).independentlyReviewedHeldOut).toBe(false);
  expect(classificationChecks(report).protectedNegatives).toBe(false);
});
