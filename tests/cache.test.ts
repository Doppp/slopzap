import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { clear, lookup, override, save } from '../src/cache/db';
import { classify } from '../src/classifier/local';
import { parseRequest } from '../src/messaging/protocol';

test('cache stores derived results, exact corrections and rejects old classifiers', async () => {
  await clear('results');
  const key = 'a'.repeat(64);
  const result = classify(
    {
      platform: 'reddit',
      kind: 'reply',
      id: '1',
      parentId: null,
      text: 'A substantive explanation with specific measurements would be useful here.',
      parentText: '',
      rootText: '',
      quotedText: '',
    },
    key,
  );
  await save([result]);
  expect((await lookup([key])).results).toEqual([result]);
  await override(key, 'not_slop');
  expect((await lookup([key])).overrides[key]).toBe('not_slop');
  await save([{ ...result, version: 'obsolete' }]);
  expect((await lookup([key])).results).toEqual([]);
  await clear('overrides');
  expect((await lookup([key])).overrides).toEqual({});
});
test('message boundary rejects bad keys and malicious numeric results', () => {
  expect(
    parseRequest({ type: 'CACHE_GET', keys: ['https://private-page'] }),
  ).toBeNull();
  expect(parseRequest({ type: 'CACHE_CLEAR', store: 'everything' })).toBeNull();
});
