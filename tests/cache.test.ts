import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
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
  await expect(save([{ ...result, version: 'obsolete' }])).rejects.toThrow(
    'Invalid cached result',
  );
  expect((await lookup([key])).results).toEqual([result]);
  await clear('overrides');
  expect((await lookup([key])).overrides).toEqual({});
});
test('message boundary rejects bad keys and malicious numeric results', () => {
  expect(
    parseRequest({ type: 'CACHE_GET', keys: ['https://private-page'] }),
  ).toBeNull();
  expect(parseRequest({ type: 'CACHE_CLEAR', store: 'everything' })).toBeNull();
});

test('expired scores are unavailable and raw text cannot enter cache messages', async () => {
  const key = 'b'.repeat(64);
  const result = classify(
    {
      platform: 'reddit',
      kind: 'comment',
      id: 'expired',
      parentId: null,
      text: 'We measured the performance of the configuration yesterday using a repeatable benchmark.',
      parentText: '',
      rootText: '',
      quotedText: '',
    },
    key,
  );
  expect(
    parseRequest({
      type: 'CACHE_SAVE',
      results: [{ ...result, rawText: 'sensitive content' }],
    }),
  ).toBeNull();
  await save([result]);
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Date.now() + 91 * 86400000);
  try {
    expect((await lookup([key])).results).toEqual([]);
  } finally {
    clock.mockRestore();
  }
});

test('corrupt stored records fail open and are removed without refreshing unknown fields', async () => {
  const opened = indexedDB.open('slopzap', 2);
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(opened.error);
  });
  const result = classify(
    {
      platform: 'reddit',
      kind: 'reply',
      id: 'invented-corruption',
      parentId: null,
      text: 'The invented cache example contains measurements rather than private content.',
      parentText: '',
      rootText: '',
      quotedText: '',
    },
    'c'.repeat(64),
  );
  const now = Date.now();
  const records = [
    {
      key: 'f'.repeat(64),
      result: { ...result, fingerprint: 'f'.repeat(64), version: 'obsolete' },
      accessed: now,
      expires: now + 86400000,
    },
    {
      key: 'c'.repeat(64),
      result: { ...result, fingerprint: 'd'.repeat(64) },
      accessed: now,
      expires: now + 86400000,
    },
    {
      key: 'd'.repeat(64),
      result: { ...result, fingerprint: 'd'.repeat(64) },
      accessed: now,
      expires: now + 86400000,
      rawText: 'invented extra field',
    },
    {
      key: 'e'.repeat(64),
      result: { ...result, fingerprint: 'e'.repeat(64) },
      accessed: now,
      expires: NaN,
    },
  ];
  const write = connection.transaction(['results', 'overrides'], 'readwrite');
  const writeDone = new Promise<void>((resolve, reject) => {
    write.oncomplete = () => resolve();
    write.onabort = () => reject(write.error);
  });
  for (const record of records) write.objectStore('results').put(record);
  write.objectStore('overrides').put({
    key: records[0]!.key,
    verdict: 'invalid',
    accessed: now,
    expires: now + 86400000,
  });
  await writeDone;
  expect(await lookup(records.map((record) => record.key))).toEqual({
    results: [],
    overrides: {},
  });
  const read = connection.transaction(['results', 'overrides']);
  const remaining = await Promise.all(
    records.map(
      (record) =>
        new Promise<unknown>((resolve) => {
          const request = read.objectStore('results').get(record.key);
          request.onsuccess = () => resolve(request.result);
        }),
    ),
  );
  expect(remaining).toEqual([undefined, undefined, undefined, undefined]);
  const override = await new Promise<unknown>((resolve) => {
    const request = connection
      .transaction('overrides')
      .objectStore('overrides')
      .get(records[0]!.key);
    request.onsuccess = () => resolve(request.result);
  });
  expect(override).toBeUndefined();
  connection.close();
});
