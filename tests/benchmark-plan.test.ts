import { expect, test } from 'vitest';
import { benchmarkPlan } from '../scripts/benchmark-plan.mjs';

test('short CI plan retains twelve processing controls and bounded duration', () => {
  const plan = benchmarkPlan(['--duration=1']);
  expect(plan).toMatchObject({
    long: false,
    seconds: 1,
    chrome: false,
    mode: 'short',
  });
  expect(plan.scenarios).toHaveLength(12);
  expect(new Set(plan.scenarios.map((value) => value.units))).toEqual(
    new Set([100, 500, 1000]),
  );
});
test('paired long plan has both processing controls at both renderer CPU rates', () => {
  expect(benchmarkPlan(['--paired-long', '--chrome'])).toEqual({
    long: true,
    seconds: 1800,
    chrome: true,
    mode: 'paired-long',
    scenarios: [
      { enabled: false, throttle: 1, units: 1000 },
      { enabled: true, throttle: 1, units: 1000 },
      { enabled: false, throttle: 4, units: 1000 },
      { enabled: true, throttle: 4, units: 1000 },
    ],
  });
});
test('legacy single long diagnostic remains explicit and can be smoked briefly', () => {
  expect(benchmarkPlan(['--long', '--duration=1']).scenarios).toEqual([
    { enabled: true, throttle: 1, units: 1000 },
  ]);
  expect(benchmarkPlan(['--paired-long', '--duration=1']).seconds).toBe(1);
});
test.each(
  [
    ['--paired-long', '--long'],
    ['--unknown'],
    ['--duration=0'],
    ['--duration=3601'],
    ['--duration=NaN'],
    ['--duration=1', '--duration=2'],
    ['--chrome', '--chrome'],
  ].map((flags) => ({ flags })),
)('rejects ambiguous or invalid benchmark flags $flags', ({ flags }) => {
  expect(() => benchmarkPlan(flags)).toThrow();
});
