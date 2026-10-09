import { classificationMatchesPackage } from './classification-evidence';
import { reproducibilityMatchesPackage } from './package-evidence';
import { performanceMatchesPackage } from './performance-evidence';
export function readiness(
  evidence: unknown,
  artifacts: {
    classification?: Record<string, unknown>;
    benchmark?: Record<string, unknown>;
    reproducibility?: Record<string, unknown>;
    packagedFiles?: Record<string, string>;
  },
) {
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
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
      classificationMatchesPackage(
        artifacts.classification,
        artifacts.packagedFiles,
      ),
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
      performanceMatchesPackage(artifacts.benchmark, artifacts.packagedFiles),
    reproducibility: reproducibilityMatchesPackage(
      artifacts.reproducibility,
      artifacts.packagedFiles,
    ),
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
