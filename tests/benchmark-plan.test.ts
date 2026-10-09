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
    workerHeap: false,
    detachedDom: false,
    idleCpu: false,
    idleSeconds: 0,
    mode: 'paired-long',
    scenarios: [
      { installed: true, enabled: false, throttle: 1, units: 1000 },
      { installed: true, enabled: true, throttle: 1, units: 1000 },
      { installed: true, enabled: false, throttle: 4, units: 1000 },
      { installed: true, enabled: true, throttle: 4, units: 1000 },
    ],
  });
});
test('legacy single long diagnostic remains explicit and can be smoked briefly', () => {
  expect(benchmarkPlan(['--long', '--duration=1']).scenarios).toEqual([
    { installed: true, enabled: true, throttle: 1, units: 1000 },
  ]);
  expect(benchmarkPlan(['--paired-long', '--duration=1']).seconds).toBe(1);
});
test('idle CPU gets six separate controls and a bounded independent observation duration', () => {
  const flags = ['--paired-long', '--with-absent', '--idle-cpu'];
  expect(benchmarkPlan([])).toMatchObject({ idleCpu: false, idleSeconds: 0 });
  expect(benchmarkPlan(flags)).toMatchObject({
    idleCpu: true,
    idleSeconds: 10,
  });
  const plan = benchmarkPlan([...flags, '--idle-seconds=60', '--duration=1']);
  expect(plan.scenarios).toHaveLength(6);
  expect(plan.idleSeconds).toBe(60);
  expect(plan.seconds).toBe(1);
});
test.each(
  [
    ['--idle-cpu'],
    ['--paired-long', '--idle-cpu'],
    ['--idle-seconds=1'],
    ...[
      '--worker-heap',
      '--detached-dom',
      '--idle-seconds=0',
      '--idle-seconds=61',
      '--idle-seconds=1.5',
      '--idle-cpu',
    ].map((flag) => ['--paired-long', '--with-absent', '--idle-cpu', flag]),
    [
      '--paired-long',
      '--with-absent',
      '--idle-cpu',
      '--idle-seconds=1',
      '--idle-seconds=2',
    ],
  ].map((flags) => ({ flags })),
)(
  'idle CPU rejects mixed probes, absent controls and invalid/duplicate quiet durations %#',
  ({ flags }) => {
    expect(() => benchmarkPlan(flags)).toThrow();
  },
);
test('worker heap diagnostics are opt-in and do not change the scenario matrix', () => {
  expect(benchmarkPlan([]).workerHeap).toBe(false);
  const plan = benchmarkPlan([
    '--paired-long',
    '--with-absent',
    '--worker-heap',
  ]);
  expect(plan.workerHeap).toBe(true);
  expect(plan.scenarios).toHaveLength(6);
  expect(() => benchmarkPlan(['--worker-heap', '--worker-heap'])).toThrow();
});
test('detached DOM diagnostics are opt-in, composable and retain paired controls', () => {
  expect(benchmarkPlan([]).detachedDom).toBe(false);
  const plan = benchmarkPlan([
    '--paired-long',
    '--with-absent',
    '--detached-dom',
    '--worker-heap',
  ]);
  expect(plan.detachedDom).toBe(true);
  expect(plan.workerHeap).toBe(true);
  expect(plan.scenarios).toHaveLength(6);
  expect(() => benchmarkPlan(['--detached-dom', '--detached-dom'])).toThrow();
});
test('absent short controls match every size/rate without replacing disabled processing', () => {
  const plan = benchmarkPlan(['--with-absent', '--duration=1']);
  expect(plan.scenarios).toHaveLength(18);
  for (let index = 0; index < plan.scenarios.length; index += 3) {
    const group = plan.scenarios.slice(index, index + 3);
    expect(
      group.map(({ installed, enabled }) => ({ installed, enabled })),
    ).toEqual([
      { installed: false, enabled: false },
      { installed: true, enabled: false },
      { installed: true, enabled: true },
    ]);
    expect(
      new Set(group.map(({ units, throttle }) => `${units}/${throttle}`)).size,
    ).toBe(1);
  }
});
test('absent paired long controls cover both CPU rates and legacy long gets a pair', () => {
  const plan = benchmarkPlan(['--paired-long', '--with-absent', '--chrome']);
  expect(plan.scenarios).toHaveLength(6);
  expect(plan.scenarios.filter((scenario) => !scenario.installed)).toEqual([
    { installed: false, enabled: false, throttle: 1, units: 1000 },
    { installed: false, enabled: false, throttle: 4, units: 1000 },
  ]);
  expect(benchmarkPlan(['--long', '--with-absent']).scenarios).toEqual([
    { installed: false, enabled: false, throttle: 1, units: 1000 },
    { installed: true, enabled: true, throttle: 1, units: 1000 },
  ]);
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
