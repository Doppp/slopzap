import { CLASSIFIER_VERSION, type Result, type Verdict } from '../shared/types';

const MAX_RECORDS = 20_000;
const TTL = 90 * 24 * 60 * 60 * 1000;
interface RecordValue {
  key: string;
  result?: Result;
  verdict?: Verdict;
  accessed: number;
  expires: number;
}
let opened: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('slopzap', 2);
    request.onupgradeneeded = () => {
      for (const name of ['results', 'overrides']) {
        const store = request.result.objectStoreNames.contains(name)
          ? request.transaction!.objectStore(name)
          : request.result.createObjectStore(name, { keyPath: 'key' });
        if (!store.indexNames.contains('accessed'))
          store.createIndex('accessed', 'accessed');
        if (!store.indexNames.contains('expires'))
          store.createIndex('expires', 'expires');
      }
    };
    request.onsuccess = () => {
      const connection = request.result;
      connection.onversionchange = () => {
        connection.close();
        opened = undefined;
      };
      resolve(connection);
    };
    request.onerror = () => {
      opened = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      opened = undefined;
      reject(new Error('Cache blocked'));
    };
  });
  return opened;
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function lookup(
  keys: string[],
): Promise<{ results: Result[]; overrides: Record<string, Verdict> }> {
  const connection = await db();
  const transaction = connection.transaction(
    ['results', 'overrides'],
    'readwrite',
  );
  const completion = completed(transaction);
  const now = Date.now();
  const values = await Promise.all(
    keys.map(async (key) => {
      const [result, override] = await Promise.all([
        requestValue(transaction.objectStore('results').get(key)) as Promise<
          RecordValue | undefined
        >,
        requestValue(transaction.objectStore('overrides').get(key)) as Promise<
          RecordValue | undefined
        >,
      ]);
      for (const [name, record] of [
        ['results', result],
        ['overrides', override],
      ] as const)
        if (record) {
          if (record.expires <= now) transaction.objectStore(name).delete(key);
          else if (now - record.accessed > 3600000)
            transaction.objectStore(name).put({ ...record, accessed: now });
        }
      return {
        key,
        result:
          result &&
          result.expires > now &&
          result.result?.version === CLASSIFIER_VERSION
            ? result.result
            : undefined,
        override:
          override && override.expires > now ? override.verdict : undefined,
      };
    }),
  );
  await completion;
  return {
    results: values.flatMap((value) => (value.result ? [value.result] : [])),
    overrides: Object.fromEntries(
      values.flatMap((value) =>
        value.override ? [[value.key, value.override]] : [],
      ),
    ),
  };
}
export async function save(results: Result[]): Promise<void> {
  const connection = await db();
  const transaction = connection.transaction('results', 'readwrite');
  const completion = completed(transaction);
  for (const result of results)
    transaction.objectStore('results').put({
      key: result.fingerprint,
      result,
      accessed: Date.now(),
      expires:
        Date.now() + (result.status === 'classified' ? TTL : 7 * 86400000),
    } satisfies RecordValue);
  await completion;
  await evict('results', MAX_RECORDS);
}
export async function override(key: string, verdict: Verdict): Promise<void> {
  const connection = await db();
  const transaction = connection.transaction('overrides', 'readwrite');
  const completion = completed(transaction);
  transaction.objectStore('overrides').put({
    key,
    verdict,
    accessed: Date.now(),
    expires: Date.now() + 365 * 86400000,
  } satisfies RecordValue);
  await completion;
  await evict('overrides', 5000);
}
export async function clear(store: 'results' | 'overrides'): Promise<void> {
  const transaction = (await db()).transaction(store, 'readwrite');
  const completion = completed(transaction);
  transaction.objectStore(store).clear();
  await completion;
}
async function evict(
  name: 'results' | 'overrides',
  maximum: number,
): Promise<void> {
  const connection = await db();
  const transaction = connection.transaction(name, 'readwrite');
  const completion = completed(transaction);
  const store = transaction.objectStore(name);
  const expired = store
    .index('expires')
    .openCursor(IDBKeyRange.upperBound(Date.now()));
  expired.onsuccess = () => {
    const entry = expired.result;
    if (entry) {
      entry.delete();
      entry.continue();
    }
  };
  const count = await requestValue(store.count());
  if (count > maximum) {
    let remaining = count - Math.floor(maximum * 0.8);
    const cursor = store.index('accessed').openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (entry && remaining-- > 0) {
        entry.delete();
        entry.continue();
      }
    };
  }
  await completion;
}
