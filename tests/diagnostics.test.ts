import { expect, test, vi } from 'vitest';
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
test('diagnostic labels require primitive strings and never invoke coercion', () => {
  const toString = vi.fn(() => 'reddit');
  const platform = { toString, text: 'invented content canary' };
  const code = {
    toString: vi.fn(() => 'adapter_parse_failures'),
    text: 'invented content canary',
  };
  for (const [name, failure] of [
    [platform, code],
    [['reddit'], ['adapter_parse_failures']],
    [new String('reddit'), new String('adapter_parse_failures')],
  ]) {
    const report = diagnostics({ platform: name, health: { code: failure } });
    expect(report.platform).toBe('unknown');
    expect(report.health.code).toBeNull();
    expect(JSON.stringify(report)).not.toContain('invented content canary');
  }
  expect(toString).not.toHaveBeenCalled();
  expect(code.toString).not.toHaveBeenCalled();
  expect(
    diagnostics({
      platform: 'reddit',
      health: { code: 'adapter_parse_failures' },
    }),
  ).toMatchObject({
    platform: 'reddit',
    health: { code: 'adapter_parse_failures' },
  });
});
test('array-shaped diagnostic records cannot supply trusted fields', () => {
  const stats = Object.assign([], { bound: 7 });
  const report = diagnostics({
    stats,
    timings: { render: Object.assign([], { count: 9 }) },
  });
  expect(report.stats.bound).toBe(0);
  expect(report.timings.render?.count).toBe(0);
});
