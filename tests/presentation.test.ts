import { expect, test } from 'vitest';
import {
  aggregate,
  presentations,
  type ScoredItem,
} from '../src/scoring/presentation';
import {
  DEFAULT_SETTINGS,
  CLASSIFIER_VERSION,
  type Result,
} from '../src/shared/types';
const result = (fingerprint: string, score: number): Result => ({
  fingerprint,
  status: 'classified',
  score,
  evidence: 0.8,
  reasons: [],
  version: CLASSIFIER_VERSION,
  automaticHide: false,
});
test('Blocker fails open for provisional classifiers, but respects local feedback', () => {
  const items: ScoredItem[] = [
    { key: '1', parent: null, result: result('a', 0.99), verdict: undefined },
    { key: '2', parent: null, result: result('b', 0.2), verdict: 'slop' },
  ];
  expect([
    ...presentations(items, 'blocker', DEFAULT_SETTINGS).values(),
  ]).toEqual(['visible', 'hidden']);
});
test('Slop Only keeps ancestor context, tolerates cycles and uncertain items', () => {
  const items: ScoredItem[] = [
    { key: '1', parent: null, result: result('a', 0.1), verdict: undefined },
    { key: '2', parent: '1', result: result('b', 0.9), verdict: undefined },
  ];
  expect(presentations(items, 'only', DEFAULT_SETTINGS).get('1')).toBe(
    'context',
  );
});
test('aggregate deduplicates items, excludes corrections, requires three samples', () => {
  const item: ScoredItem = {
    key: '1',
    parent: null,
    result: result('same', 0.5),
    verdict: undefined,
  };
  expect(aggregate([item, { ...item, key: '2' }], 0)).toMatchObject({
    analysed: 1,
    score: null,
  });
});
