import { expect, test, vi } from 'vitest';
import { modelComparison } from '../src/evaluation/model-comparison';
import { COMPARISON_CASES } from '../src/evaluation/comparison-cases';
import { REFERENCE_PAIRS } from '../src/classifier/reference-guide';
import { validUnit } from '../src/messaging/protocol';

test('comparison examples are valid, balanced and separate from guide text', () => {
  expect(COMPARISON_CASES).toHaveLength(12);
  expect(COMPARISON_CASES.filter((row) => row.label)).toHaveLength(6);
  expect(COMPARISON_CASES.every((row) => validUnit(row.unit))).toBe(true);
  const references = REFERENCE_PAIRS.flatMap((pair) => [
    pair.useful.text,
    pair.lowInformation.text,
  ]);
  expect(
    COMPARISON_CASES.every((row) => !references.includes(row.unit.text)),
  ).toBe(true);
});

test('paired runs alternate arm order, hide labels from prompts and project numeric reports', async () => {
  const calls: boolean[] = [];
  const report = await modelComparison(async (input, references) => {
    calls.push(references);
    expect(Object.keys(input)).toEqual(['id', 'unit']);
    expect(input.id).not.toContain('filler');
    expect(input.unit).not.toHaveProperty('label');
    return {
      id: input.id,
      score: references ? 0.75 : 0.5,
      evidence: 0.9,
      reasons: [],
    };
  }, new AbortController().signal);
  expect(calls.slice(0, 4)).toEqual([false, true, true, false]);
  expect(report.status).toBe('complete');
  expect(report.pairedCases).toBe(12);
  expect(report.attemptedCalls).toBe(24);
  expect(report.metrics[0]!.guided.raw.fp).toBe(6);
  expect(report.metrics[0]!.baseline.raw.fp).toBe(0);
  expect(report.metrics[0]!.guided.composed.abstained).toBeGreaterThan(0);
  expect(report.releaseReady).toBe(false);
  expect(report.automaticHide).toBe(false);
  expect(JSON.stringify(report)).not.toContain(COMPARISON_CASES[0]!.unit.text);
  expect(JSON.stringify(report)).not.toContain('parentText');
});

test('incomplete arms never enter paired metrics or retain raw output/errors', async () => {
  let call = 0;
  const report = await modelComparison(async (input) => {
    if (call++ === 0) throw new Error('private-error-canary');
    if (call === 2)
      return {
        id: input.id,
        score: 1,
        evidence: 1,
        reasons: [],
        raw: 'private-response-canary',
      };
    return { id: input.id, score: 0.4, evidence: 0.9, reasons: [] };
  }, new AbortController().signal);
  expect(report.status).toBe('incomplete');
  expect(report.pairedCases).toBe(11);
  expect(report.metrics[0]!.guided.raw.samples).toBe(11);
  expect(report.rows[0]!.baseline.status).toBe('failed');
  expect(report.rows[0]!.guided.status).toBe('invalid');
  expect(JSON.stringify(report)).not.toContain('private-');
});

test('missing and low-evidence outputs cannot turn into perfect performance', async () => {
  const missing = await modelComparison(
    async () => undefined,
    new AbortController().signal,
  );
  expect(missing.status).toBe('incomplete');
  expect(missing.metrics[0]!.baseline.raw.fpr).toBeNull();
  expect(missing.metrics[0]!.baseline.raw.precision).toBeNull();
  const uncertain = await modelComparison(
    async (input) => ({ id: input.id, score: 1, evidence: 0.1, reasons: [] }),
    new AbortController().signal,
  );
  expect(uncertain.metrics[0]!.guided.raw.abstained).toBe(12);
  expect(uncertain.metrics[0]!.guided.raw.precision).toBeNull();
});

test('cancellation stops new calls and reports partial results explicitly', async () => {
  const controller = new AbortController();
  const report = await modelComparison(async (input) => {
    controller.abort();
    return { id: input.id, score: 1, evidence: 1, reasons: [] };
  }, controller.signal);
  expect(report.status).toBe('cancelled');
  expect(report.attemptedCalls).toBe(1);
  expect(report.rows[0]!.baseline.status).toBe('cancelled');
  expect(report.rows[0]!.guided.status).toBe('not_run');
});

test('ignored provider cancellation is bounded by the per-arm deadline', async () => {
  vi.useFakeTimers();
  try {
    const pending = modelComparison(
      async () => new Promise(() => {}),
      new AbortController().signal,
      () => {},
      10,
    );
    await vi.runAllTimersAsync();
    const report = await pending;
    expect(report.status).toBe('incomplete');
    expect(
      report.rows.every(
        (row) =>
          row.baseline.status === 'timeout' && row.guided.status === 'timeout',
      ),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
