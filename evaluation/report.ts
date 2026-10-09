import { classify } from '../src/classifier/local';
import { CLASSIFIER_VERSION } from '../src/shared/types';
import { agreed, unit, SLICES, type Example } from './schema';
import { confidence, metrics, ranking, type Prediction } from './metrics';
import { score, type Model } from './model';
import {
  classificationChecks,
  PROTECTED_SLICES,
  PLATFORMS,
  KINDS,
} from './classification-evidence';
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
  const protectedNegatives = reviewed.filter(
    (row) =>
      row.slop === 0 &&
      PROTECTED_SLICES.some((name) => row.slices.includes(name)),
  ).length;
  const result = {
    schemaVersion: 2,
    classifierVersion: model?.version ?? CLASSIFIER_VERSION,
    heldOutSamples: test.length,
    reviewedSamples: reviewed.length,
    excludedAmbiguousOrUnreviewed: test.length - reviewed.length,
    protectedNegatives,
    platformCounts: Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        reviewed.filter((row) => row.platform === platform).length,
      ]),
    ),
    kindCounts: Object.fromEntries(
      KINDS.map((kind) => [
        kind,
        reviewed.filter((row) => row.kind === kind).length,
      ]),
    ),
    blocker,
    only,
    ranking: ranking(predictions),
    confidence: bounds,
    slices,
    automaticHide: false,
    note: 'Metadata and metrics cannot prove independent human review. Trained models are experimental and not loaded by the extension; deployment needs separate review.',
  };
  const checks = classificationChecks(result);
  return {
    ...result,
    checks,
    statisticalGatesPass: Object.values(checks).every(Boolean),
  };
}
