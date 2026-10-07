import { expect, test } from 'vitest';
import evidence from '../evaluation/reports/chrome-reference-2026-10-08.json';
import { metrics } from '../evaluation/metrics';

test('real model snapshot retains incomplete coverage and development scope', () => {
  expect(evidence.referenceBenefitEstablished).toBe(false);
  expect(evidence.releaseReady).toBe(false);
  expect(evidence.automaticHide).toBe(false);
  expect(evidence.resourceAcceptance).toBe(false);
  expect(evidence.runs.map(({ report }) => report.pairedCases)).toEqual([
    11, 9, 11,
  ]);
  for (const { report } of evidence.runs) {
    expect(report.status).toBe('incomplete');
    expect(report.attemptedCalls).toBe(24);
    expect(report.plannedCases).toBe(12);
    expect(report.releaseReady).toBe(false);
    expect(report.automaticHide).toBe(false);
    expect(report.chromeMajorVersion).toBe('155');
  }
});

test('real snapshot metrics reproduce from valid pairs without pooling repeats', () => {
  for (const { report } of evidence.runs) {
    const paired = report.rows.filter(
      (row) => row.baseline.status === 'ok' && row.guided.status === 'ok',
    );
    expect(paired).toHaveLength(report.pairedCases);
    for (const summary of report.metrics) {
      for (const arm of ['baseline', 'guided'] as const) {
        for (const composed of [false, true]) {
          const expected = metrics(
            paired.map((row) => ({
              label: row.label as 0 | 1,
              group: row.caseId,
              score: composed
                ? row[arm].composedScore
                : row[arm].evidence! >= 0.6
                  ? row[arm].score
                  : null,
            })),
            summary.threshold,
          );
          expect(summary[arm][composed ? 'composed' : 'raw']).toEqual(expected);
        }
      }
    }
  }
});

test('real model rows contain only static case labels and numeric outcomes', () => {
  const permittedStatuses = ['ok', 'missing', 'invalid', 'failed', 'timeout'];
  for (const { report } of evidence.runs) {
    for (const row of report.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'baseline',
        'caseId',
        'guided',
        'label',
      ]);
      for (const arm of ['baseline', 'guided'] as const) {
        expect(Object.keys(row[arm]).sort()).toEqual([
          'composedScore',
          'elapsedMs',
          'evidence',
          'score',
          'status',
        ]);
        expect(permittedStatuses).toContain(row[arm].status);
        expect(Number.isFinite(row[arm].elapsedMs)).toBe(true);
        for (const key of ['score', 'evidence', 'composedScore'] as const) {
          const value = row[arm][key];
          if (value !== null) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  }
});
