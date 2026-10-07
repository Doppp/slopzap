import { expect, test } from 'vitest';
import {
  parseRequest,
  validResult,
  validUnit,
} from '../src/messaging/protocol';
import { classify } from '../src/classifier/local';
const unit = {
  platform: 'reddit' as const,
  kind: 'reply' as const,
  id: '',
  parentId: null,
  text: 'I measured the cache latency yesterday because it was warm.',
  parentText: '',
  rootText: '',
  quotedText: '',
};
test('cache boundaries cannot authorize automatic hiding in the alpha', () => {
  const result = classify(unit, 'a'.repeat(64));
  expect(validResult(result)).toBe(true);
  expect(validResult({ ...result, automaticHide: true })).toBe(false);
  expect(
    parseRequest({
      type: 'CACHE_SAVE',
      results: [{ ...result, automaticHide: true }],
    }),
  ).toBeNull();
});
test('classification schemas cap context and reject undeclared metadata', () => {
  expect(validUnit(unit)).toBe(true);
  expect(validUnit({ ...unit, parentText: 'x'.repeat(801) })).toBe(false);
  expect(validUnit({ ...unit, rootText: 'x'.repeat(501) })).toBe(false);
  expect(validUnit({ ...unit, quotedText: 'x'.repeat(601) })).toBe(false);
  expect(validUnit({ ...unit, author: 'invented identity' })).toBe(false);
});
test('circular or oversized untrusted requests are rejected without throwing', () => {
  const circular: Record<string, unknown> = { type: 'SETTINGS_SET' };
  circular.self = circular;
  expect(parseRequest(circular)).toBeNull();
  expect(
    parseRequest({
      type: 'SETTINGS_SET',
      settings: { text: 'x'.repeat(256_001) },
    }),
  ).toBeNull();
  expect(
    parseRequest({
      type: 'SETTINGS_SET',
      settings: { text: '界'.repeat(100_000) },
    }),
  ).toBeNull();
});
