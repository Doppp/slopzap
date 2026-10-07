import { expect, test } from 'vitest';
import {
  parseRequest,
  parseContentRequest,
  validResult,
  validUnit,
} from '../src/messaging/protocol';
import { classify } from '../src/classifier/local';
import { DEFAULT_SETTINGS } from '../src/shared/types';
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
test('content control messages reject null, unknown and oversized envelopes', () => {
  for (const value of [
    null,
    [],
    false,
    1,
    'invented',
    {},
    { type: 'SETTINGS_CHANGED' },
    { type: 'SETTINGS_CHANGED', settings: null },
    { type: 'SETTINGS_CHANGED', settings: { enabled: false } },
    { type: 'SETTINGS_CHANGED', settings: { ...DEFAULT_SETTINGS, sites: {} } },
    {
      type: 'SETTINGS_CHANGED',
      settings: { ...DEFAULT_SETTINGS, onDevice: 'true' },
    },
    {
      type: 'SETTINGS_CHANGED',
      settings: { ...DEFAULT_SETTINGS, blockerThreshold: NaN },
    },
    { type: 'SNAPSHOT', text: 'invented' },
  ])
    expect(parseContentRequest(value)).toBeNull();
  expect(
    parseContentRequest({
      type: 'SETTINGS_CHANGED',
      settings: { text: '界'.repeat(100_000) },
    }),
  ).toBeNull();
  expect(parseContentRequest({ type: 'SNAPSHOT' })).toEqual({
    type: 'SNAPSHOT',
  });
  expect(parseContentRequest({ type: 'RETRY_ADAPTER' })).toEqual({
    type: 'RETRY_ADAPTER',
  });
  expect(
    parseContentRequest({
      type: 'SETTINGS_CHANGED',
      settings: DEFAULT_SETTINGS,
    }),
  ).toEqual({ type: 'SETTINGS_CHANGED', settings: DEFAULT_SETTINGS });
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
test('malformed batch entries, sparse arrays and undeclared envelopes fail closed', () => {
  for (const item of [null, undefined, true, 7, 'invented', [], {}]) {
    expect(() =>
      parseRequest({ type: 'CLASSIFY_LOCAL', items: [item] }),
    ).not.toThrow();
    expect(parseRequest({ type: 'CLASSIFY_LOCAL', items: [item] })).toBeNull();
  }
  for (const [type, field] of [
    ['CLASSIFY_LOCAL', 'items'],
    ['CACHE_GET', 'keys'],
    ['CACHE_SAVE', 'results'],
  ])
    expect(parseRequest({ type, [field!]: new Array(1) })).toBeNull();
  const item = { unit, fingerprint: 'a'.repeat(64) };
  expect(
    parseRequest({ type: 'CLASSIFY_LOCAL', items: [item] }),
  ).not.toBeNull();
  expect(
    parseRequest({
      type: 'CLASSIFY_LOCAL',
      items: [{ ...item, author: 'invented' }],
    }),
  ).toBeNull();
  expect(
    parseRequest({ type: 'SETTINGS_GET', text: 'invented extra content' }),
  ).toBeNull();
  expect(parseRequest({ type: 'CACHE_GET', keys: [], version: {} })).toBeNull();
  expect(
    parseRequest({ type: 'CACHE_GET', keys: [], version: 'x'.repeat(80) }),
  ).toBeNull();
  expect(parseRequest({ type: 'SETTINGS_SET', settings: null })).toBeNull();
  expect(parseRequest({ type: 'SETTINGS_SET', settings: [] })).toBeNull();
});
