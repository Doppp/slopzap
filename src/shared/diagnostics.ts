import { METRICS } from '../content/metrics';
import { parseSettings } from './types';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, 1e9)
    : 0;
export function diagnostics(value: unknown) {
  const input = object(value),
    stats = object(input.stats),
    health = object(input.health),
    timings = object(input.timings);
  return {
    platform: [
      'reddit',
      'youtube',
      'linkedin',
      'x',
      'medium',
      'synthetic',
    ].includes(String(input.platform))
      ? input.platform
      : 'unknown',
    settings: parseSettings(input.settings),
    stats: {
      bound: count(stats.bound),
      candidates: count(stats.candidates),
      classifications: count(stats.classifications),
    },
    health: {
      code: [
        'adapter_parse_failures',
        'adapter_parse_exception',
        'classifier_unavailable',
      ].includes(String(health.code))
        ? health.code
        : null,
      sampled: count(health.sampled),
      rejected: count(health.rejected),
      consecutiveFailures: count(health.consecutiveFailures),
    },
    timings: Object.fromEntries(
      METRICS.filter((name) => Object.hasOwn(timings, name)).map((name) => {
        const sample = object(timings[name]);
        return [
          name,
          {
            count: count(sample.count),
            p50: count(sample.p50),
            p95: count(sample.p95),
            max: count(sample.max),
          },
        ];
      }),
    ),
  };
}
