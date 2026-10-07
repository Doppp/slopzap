import { CLASSIFIER_VERSION } from '../src/shared/types';
export function readiness(
  evidence: unknown,
  artifacts: {
    classification?: Record<string, unknown>;
    benchmark?: Record<string, unknown>;
    reproducibility?: Record<string, unknown>;
  },
) {
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const source = object(evidence),
    classification = object(source.classification),
    performance = object(source.performance),
    live = object(source.live),
    reviews = object(source.reviews);
  const checks = {
    schema: source.schemaVersion === 1,
    classification:
      classification.independentReviewApproved === true &&
      artifacts.classification?.statisticalGatesPass === true &&
      artifacts.classification?.classifierVersion === CLASSIFIER_VERSION,
    livePlatforms: ['reddit', 'youtube', 'linkedin', 'x', 'medium'].every(
      (site) =>
        object(live[site]).passed === true &&
        typeof object(live[site]).evidence === 'string' &&
        String(object(live[site]).evidence).trim().length > 0,
    ),
    referencePerformance:
      performance.referenceHardwareApproved === true &&
      performance.pairedControls === true &&
      performance.cpu1xAnd4x === true &&
      performance.detachedRetentionZero === true &&
      performance.allSpecBudgetsPassed === true &&
      artifacts.benchmark?.referenceHardwareAcceptance === true &&
      Number(artifacts.benchmark?.durationSeconds) >= 1800,
    reproducibility: artifacts.reproducibility?.packagedFilesIdentical === true,
    onDeviceVerification:
      reviews.onDeviceHardwareAndComparativeEvaluation === true,
    accessibility: reviews.accessibilityManualAudit === true,
    securityPrivacy: reviews.securityPrivacy === true,
    storeDisclosures: reviews.storeDisclosures === true,
    architecture: reviews.architecture === true,
  };
  return {
    releaseReady: Object.values(checks).every(Boolean),
    checks,
    missing: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    note: 'Evidence attestations require maintainer review; an automated check cannot establish independent labeling, consent or manual audit.',
  };
}
