const platforms = ['reddit', 'youtube', 'linkedin', 'x', 'medium', 'synthetic'];
const failures = [
  'adapter_parse_failures',
  'adapter_parse_exception',
  'classifier_unavailable',
];
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown, limit: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= limit
  );
}

export function projectDom(value: unknown) {
  if (
    !record(value) ||
    !count(value.domCandidates, 1_000_000) ||
    !count(value.annotations, 1_000_000) ||
    typeof value.authRoute !== 'boolean' ||
    typeof value.challengeFramePresent !== 'boolean'
  )
    return null;
  return {
    domCandidates: value.domCandidates,
    annotations: value.annotations,
    authRoute: value.authRoute,
    challengeFramePresent: value.challengeFramePresent,
  };
}

// Export only controlled codes and counts, even if a future snapshot adds text.
export function projectSnapshot(value: unknown) {
  if (!record(value) || typeof value.supported !== 'boolean') return null;
  const { stats, health } = value;
  if (!record(stats) || !record(health)) return null;
  if (
    !count(stats.bound, 1000) ||
    !count(stats.candidates, 1000) ||
    !count(stats.classifications, 1_000_000_000) ||
    !count(health.sampled, 100) ||
    !count(health.rejected, health.sampled) ||
    !count(health.consecutiveFailures, health.sampled) ||
    !(health.code === null || failures.includes(health.code as string)) ||
    (value.supported && !platforms.includes(value.platform as string))
  )
    return null;
  return {
    supported: value.supported,
    platform: value.supported ? (value.platform as string) : null,
    stats: {
      bound: stats.bound,
      candidates: stats.candidates,
      classifications: stats.classifications,
    },
    health: {
      code: health.code as string | null,
      sampled: health.sampled,
      rejected: health.rejected,
      consecutiveFailures: health.consecutiveFailures,
    },
  };
}

export function observationOutcome(input: {
  navigationFailed: boolean;
  domSnapshotAvailable: boolean;
  status: number | null;
  authRoute: boolean;
  challengeFramePresent: boolean;
  domCandidates: number;
  runtime: ReturnType<typeof projectSnapshot>;
}) {
  if (input.navigationFailed) return 'navigation_unavailable';
  if (!input.domSnapshotAvailable) return 'dom_snapshot_unavailable';
  if (input.authRoute) return 'authentication_route';
  if (input.status !== null && input.status >= 400) return 'http_error';
  if (!input.domCandidates && input.challengeFramePresent)
    return 'possible_access_challenge';
  if (!input.domCandidates) return 'no_target_units';
  if (!input.runtime) return 'runtime_snapshot_unavailable';
  if (input.runtime.health.code) return 'runtime_paused';
  if (!input.runtime.stats.bound) return 'no_bound_units';
  return 'units_observed'; // Not manual authored-boundary or release approval.
}
