import { expect, test } from 'vitest';
import template from '../docs/performance-review-template.json';
import {
  performanceLimits,
  performanceMatchesPackage,
} from '../evaluation/performance-evidence';
import { readiness } from '../evaluation/readiness';
import {
  inventedFiles,
  inventedPerformanceReport,
} from './fixtures/performance-evidence';

test('complete invented reviewed evidence passes only the performance gate', () => {
  const report = inventedPerformanceReport();
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(true);
  report.scenarios.reverse();
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(true);
  const result = readiness(
    {
      performance: {
        referenceHardwareApproved: true,
        pairedControls: true,
        cpu1xAnd4x: true,
        detachedRetentionZero: true,
        allSpecBudgetsPassed: true,
      },
    },
    { benchmark: report, packagedFiles: inventedFiles },
  );
  expect(result.checks.referencePerformance).toBe(true);
  expect(result.releaseReady).toBe(false);
});

test('unfilled review template cannot approve performance even with its approvals flipped', () => {
  expect(performanceMatchesPackage(template, inventedFiles)).toBe(false);
  const report = structuredClone(template);
  report.referenceHardwareAcceptance = true;
  for (const key of Object.keys(report.methods))
    (report.methods as Record<string, unknown>)[key] = true;
  report.files = inventedFiles;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
});

test('sparse scenario arrays fail closed instead of throwing', () => {
  const report = inventedPerformanceReport();
  delete report.scenarios[0];
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
});

test.each([
  ['mutationP95Ms', 0.5],
  ['localBatch16MedianMs', 1],
])('inconsistent percentile summaries fail: %s', (key, value) => {
  const report = inventedPerformanceReport();
  report.scenarios[2]!.metrics[key as string] = value;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
});

test.each(Object.entries(performanceLimits))(
  'SPEC boundary for %s is preserved',
  (key, [limit, inclusive]) => {
    const report = inventedPerformanceReport();
    report.scenarios[2]!.metrics[key] = limit;
    expect(performanceMatchesPackage(report, inventedFiles)).toBe(inclusive);
    report.scenarios[2]!.metrics[key] = limit + 0.01;
    expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  },
);

test.each([undefined, null, '0', false, NaN, Infinity, -Infinity, -1, {}])(
  'all measured budget fields reject unavailable/coerced/nonfinite values %#',
  (value) => {
    for (const key of Object.keys(performanceLimits)) {
      const report = inventedPerformanceReport();
      report.scenarios[5]!.metrics[key] = value;
      expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
    }
  },
);
test.each([
  'attributableLongTasks',
  'detachedBoundElementsAfterGc',
  'networkMaxConcurrent',
  'networkPerItemCalls',
])('count %s cannot be fractional', (key) => {
  const report = inventedPerformanceReport();
  report.scenarios[2]!.metrics[key] = 0.5;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
});
test.each(Object.keys(inventedPerformanceReport().methods))(
  'missing method review %s blocks approval',
  (key) => {
    const report = inventedPerformanceReport();
    delete (report.methods as Record<string, unknown>)[key];
    expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  },
);

test('method attestations require literal true and outer approval is still required', () => {
  const report = inventedPerformanceReport();
  (report.methods as Record<string, unknown>).actualDroppedFrames = 'true';
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  const result = readiness(
    {},
    { benchmark: inventedPerformanceReport(), packagedFiles: inventedFiles },
  );
  expect(result.checks.referencePerformance).toBe(false);
});
test.each([
  undefined,
  null,
  [],
  {},
  { durationSeconds: 1800, referenceHardwareAcceptance: true },
  { durationSeconds: '1800', referenceHardwareAcceptance: true },
  { durationSeconds: Infinity, referenceHardwareAcceptance: true },
  { schemaVersion: 4, referenceHardwareAcceptance: true, results: [] },
  { ...inventedPerformanceReport(), schemaVersion: 2 },
  { ...inventedPerformanceReport(), kind: 'smoke' },
  { ...inventedPerformanceReport(), referenceHardwareAcceptance: false },
])(
  'legacy flags, raw diagnostics and malformed envelopes fail closed %#',
  (report) => {
    expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  },
);
test.each([
  undefined,
  {},
  { 'invented.js': 'b'.repeat(64) },
  { ...inventedFiles, 'added.js': 'b'.repeat(64) },
])('reviewed evidence must match the entire current package %#', (files) => {
  expect(performanceMatchesPackage(inventedPerformanceReport(), files)).toBe(
    false,
  );
});
test.each([
  ['control', 'other'],
  ['control', null],
  ['throttle', '4'],
  ['throttle', 2],
  ['units', 500],
  ['scrollDurationSeconds', 1799.99],
  ['scrollDurationSeconds', '1800'],
  ['scrollDurationSeconds', Infinity],
  ['scrollDurationSeconds', null],
  ['evidenceId', ''],
  ['evidenceId', '../private'],
  ['frameP95Ms', null],
  ['droppedFramePercent', 101],
  ['droppedFramePercent', -1],
])('invalid scenario field %s fails %#', (key, value) => {
  const report = inventedPerformanceReport();
  (report.scenarios[0]! as Record<string, unknown>)[key as string] = value;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
});
test.each(['missing', 'extra', 'duplicate', 'metrics', 'array'])(
  'all six distinct paired scenarios and enabled metrics are required: %s',
  (mode) => {
    const report = inventedPerformanceReport();
    if (mode === 'missing') report.scenarios.pop();
    if (mode === 'extra') report.scenarios.push(report.scenarios[0]!);
    if (mode === 'duplicate') report.scenarios[5] = report.scenarios[2]!;
    if (mode === 'metrics') report.scenarios[5]!.metrics = {};
    if (mode === 'array') (report as Record<string, unknown>).scenarios = {};
    expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  },
);
test.each([
  ['frameP95Ms', 17.99, true],
  ['frameP95Ms', 18, false],
  ['frameP95Ms', 15, true],
  ['droppedFramePercent', 0.99, true],
  ['droppedFramePercent', 1, false],
])('paired disabled comparison %s = %s', (key, value, accepted) => {
  const report = inventedPerformanceReport();
  // Make absent control unhelpfully slow: it must not replace the disabled baseline.
  report.scenarios[3]!.frameP95Ms = 100;
  report.scenarios[3]!.droppedFramePercent = 100;
  (report.scenarios[5]! as Record<string, unknown>)[key as string] = value;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(accepted);
});
test.each([0, null, '10', Infinity, -1])(
  'ten-minute heap requires a positive numeric baseline %#',
  (value) => {
    const report = inventedPerformanceReport();
    report.scenarios[2]!.metrics.heapAtTenMinutesMiB = value;
    expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  },
);
test('plateau accepts exactly 15% growth but rejects more or increasing detached bindings', () => {
  const report = inventedPerformanceReport();
  report.scenarios[2]!.metrics.heapAtThirtyMinutesMiB = 11.5;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(true);
  report.scenarios[2]!.metrics.heapAtThirtyMinutesMiB = 11.501;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  report.scenarios[2]!.metrics.heapAtThirtyMinutesMiB = 10;
  report.scenarios[2]!.metrics.detachedBoundElementsIncreasing = true;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
});
test('remote-disabled requires explicit null; enabled requires measured dispatch <=100ms', () => {
  const report = inventedPerformanceReport(),
    scenario = report.scenarios[2]!;
  scenario.metrics.remoteP0DispatchMaxMs = 0;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  scenario.remoteEnabled = true;
  scenario.metrics.remoteP0DispatchMaxMs = 100;
  expect(performanceMatchesPackage(report, inventedFiles)).toBe(true);
  for (const value of [null, '100', Infinity, 100.01]) {
    scenario.metrics.remoteP0DispatchMaxMs = value;
    expect(performanceMatchesPackage(report, inventedFiles)).toBe(false);
  }
});
