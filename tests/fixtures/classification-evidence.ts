import {
  metrics,
  confidence,
  ranking,
  type Prediction,
} from '../../evaluation/metrics';
import {
  classificationChecks,
  REQUIRED_SLICES,
  PLATFORMS,
  KINDS,
} from '../../evaluation/classification-evidence';
import { CLASSIFIER_VERSION } from '../../src/shared/types';

export const inventedClassificationFiles = { 'invented.js': 'a'.repeat(64) };
const rows: Prediction[] = Array.from({ length: 2000 }, (_, i) => ({
  label: i < 1000 ? 1 : 0,
  score:
    i < 900 || (i >= 1000 && i < 1010)
      ? 0.9
      : i < 950 || (i >= 1010 && i < 1020)
        ? 0.75
        : 0.1,
  group: `invented-group-${i % 20}`,
}));
const slice = [...rows.slice(0, 100), ...rows.slice(1100, 1350)];
const evaluationReport = {
  schemaVersion: 2,
  classifierVersion: CLASSIFIER_VERSION,
  heldOutSamples: 2000,
  reviewedSamples: 2000,
  excludedAmbiguousOrUnreviewed: 0,
  protectedNegatives: 500,
  platformCounts: Object.fromEntries(
    PLATFORMS.map((name, i) => [name, i < 5 ? 400 : 0]),
  ),
  kindCounts: Object.fromEntries(
    KINDS.map((name, i) => [name, i < 5 ? 300 : 500]),
  ),
  blocker: metrics(rows, 0.85),
  only: metrics(rows, 0.7),
  ranking: ranking(rows),
  confidence: confidence(rows, 0.85),
  slices: Object.fromEntries(
    REQUIRED_SLICES.map((name) => [
      name,
      {
        blocker: metrics(slice, 0.85),
        only: metrics(slice, 0.7),
        confidence: confidence(slice, 0.85, 300),
      },
    ]),
  ),
  automaticHide: false,
};
// Invented aggregate distributions, not labeled corpus or scientific/release evidence.
export function inventedClassificationReport() {
  return structuredClone({
    schemaVersion: 1,
    kind: 'reviewed-classification',
    files: inventedClassificationFiles,
    evaluationReport: {
      ...evaluationReport,
      checks: classificationChecks(evaluationReport),
      statisticalGatesPass: true,
    },
  });
}
