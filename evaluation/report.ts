import { classify } from '../src/classifier/local';
import { CLASSIFIER_VERSION } from '../src/shared/types';
import { agreed, unit, SLICES, type Example } from './schema';
import { confidence, metrics, ranking, type Prediction } from './metrics';
import { score, type Model } from './model';
export function report(rows: Example[], model?: Model) {
  const test = rows.filter((row) => row.split === 'test'),
    reviewed = test.filter(agreed);
  const predictions: Prediction[] = reviewed.map((row) => {
    const local = classify(unit(row), 'evaluation-only');
    return {
      label: row.slop,
      group: row.splitGroup,
      score: model
        ? score(model, row)
        : local.status === 'classified'
          ? local.score
          : null,
    };
  });
  const blocker = metrics(predictions, 0.85),
    only = metrics(predictions, 0.7),
    bounds = confidence(predictions, 0.85);
  const slices = Object.fromEntries(
    SLICES.filter((slice) =>
      reviewed.some((row) => row.slices.includes(slice)),
    ).map((slice) => {
      const selected = predictions.filter((_, index) =>
        reviewed[index]!.slices.includes(slice),
      );
      return [
        slice,
        {
          blocker: metrics(selected, 0.85),
          only: metrics(selected, 0.7),
          confidence: confidence(selected, 0.85, 300),
        },
      ];
    }),
  );
  const protectedNames = ['non_native', 'polished', 'technical', 'short'];
  const protectedNegatives = reviewed.filter(
    (row) =>
      row.slop === 0 &&
      protectedNames.some((name) => row.slices.includes(name)),
  ).length;
  const checks = {
    independentlyReviewedHeldOut:
      test.length === reviewed.length && reviewed.length >= 2000,
    protectedNegatives: protectedNegatives >= 500,
    blockerPrecision: blocker.precision !== null && blocker.precision >= 0.9,
    blockerFpr: blocker.fpr !== null && blocker.fpr <= 0.03,
    fprConfidence:
      bounds.fprWilsonUpper !== null &&
      bounds.fprWilsonUpper <= 0.05 &&
      Array.isArray(bounds.intervals.fpr) &&
      Number(bounds.intervals.fpr[1]) <= 0.05,
    onlyPrecision: only.precision !== null && only.precision >= 0.75,
    onlyRecall: only.recall !== null && only.recall >= 0.65,
    protectedSlices: protectedNames.every((name) => {
      const slice = slices[name]?.blocker;
      return (
        !!slice &&
        slice.fp + slice.tn >= 50 &&
        slice.fpr !== null &&
        slice.fpr <= 0.05
      );
    }),
    platformCoverage: ['reddit', 'youtube', 'linkedin', 'x', 'medium'].every(
      (platform) => reviewed.some((row) => row.platform === platform),
    ),
    kindCoverage: [
      'post',
      'comment',
      'reply',
      'quote_commentary',
      'article',
      'article_response',
    ].every((kind) => reviewed.some((row) => row.kind === kind)),
  };
  return {
    schemaVersion: 1,
    classifierVersion: model?.version ?? CLASSIFIER_VERSION,
    heldOutSamples: test.length,
    reviewedSamples: reviewed.length,
    excludedAmbiguousOrUnreviewed: test.length - reviewed.length,
    protectedNegatives,
    blocker,
    only,
    ranking: ranking(predictions),
    confidence: bounds,
    slices,
    checks,
    statisticalGatesPass: Object.values(checks).every(Boolean),
    automaticHide: false,
    note: 'Metadata and metrics cannot prove independent human review. Trained models are experimental and not loaded by the extension; deployment needs separate review.',
  };
}
