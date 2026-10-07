import { expect, test } from 'vitest';
import { readiness } from '../evaluation/readiness';
import { CLASSIFIER_VERSION } from '../src/shared/types';
test('missing evidence and development smoke results cannot become release approval', () => {
  const result = readiness({}, {});
  expect(result.releaseReady).toBe(false);
  expect(result.missing).toContain('classification');
  expect(result.missing).toContain('livePlatforms');
});
test('experimental model reports and non-reference benchmarks do not qualify', () => {
  const result = readiness(
    {
      schemaVersion: 1,
      classification: { independentReviewApproved: true },
      performance: {
        referenceHardwareApproved: true,
        pairedControls: true,
        cpu1xAnd4x: true,
        detachedRetentionZero: true,
        allSpecBudgetsPassed: true,
      },
    },
    {
      classification: {
        classifierVersion: 'experimental-logistic-v1',
        statisticalGatesPass: true,
      },
      benchmark: { durationSeconds: 1800, referenceHardwareAcceptance: false },
      reproducibility: { packagedFilesIdentical: true },
    },
  );
  expect(result.checks.classification).toBe(false);
  expect(result.checks.referencePerformance).toBe(false);
  expect(result.checks.reproducibility).toBe(true);
  expect(CLASSIFIER_VERSION).toContain('provisional');
});
