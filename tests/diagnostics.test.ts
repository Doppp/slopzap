import { expect, test } from 'vitest';
import { diagnostics } from '../src/shared/diagnostics';
import { Metrics } from '../src/content/metrics';
test('diagnostics whitelist fields and cannot copy content, URLs or exception messages', () => {
  const canary = 'private-canary';
  const input = {
    platform: 'reddit',
    text: canary,
    url: canary,
    fingerprint: canary,
    settings: { apiKey: canary },
    stats: { bound: 4, rawText: canary },
    health: { code: canary, message: canary },
    timings: { render: { count: 3, p95: 2, text: canary }, [canary]: canary },
  };
  const report = diagnostics(input);
  expect(JSON.stringify(report)).not.toContain(canary);
  expect(report.stats.bound).toBe(4);
  expect(report.health.code).toBeNull();
  expect(report.timings.render).toMatchObject({ count: 3, p95: 2 });
});
test('metrics have bounded samples and finite percentiles', () => {
  const metrics = new Metrics();
  for (let index = 0; index < 1000; index++) metrics.record('render', index);
  metrics.record('render', NaN);
  metrics.record('render', -1);
  expect(metrics.snapshot().render).toEqual({
    count: 1000,
    p50: 935,
    p95: 993,
    max: 999,
  });
});
