import { expect, test, vi } from 'vitest';
import { abortable } from '../src/shared/async';
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn() } },
}));
import { LocalClassifier } from '../src/classifier/client';
import { classify } from '../src/classifier/local';
const unit = {
  platform: 'reddit' as const,
  kind: 'reply' as const,
  id: '',
  parentId: null,
  text: 'I measured this latency yesterday because the cache was warm.',
  parentText: '',
  rootText: '',
  quotedText: '',
};
const items = [{ unit, fingerprint: 'a'.repeat(64) }];
test('abort releases a caller even when an underlying operation ignores its signal', async () => {
  const controller = new AbortController();
  const pending = abortable(new Promise(() => {}), controller.signal);
  const result = expect(pending).rejects.toThrow(/cancelled/);
  controller.abort();
  await result;
});
test('disposable worker transport failures retry once, while schema failures do not', async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('Worker stopped'))
    .mockResolvedValue([classify(unit, items[0]!.fingerprint)]);
  const client = new LocalClassifier(send);
  expect(await client.classify(items)).toHaveLength(1);
  expect(send).toHaveBeenCalledTimes(2);
  const invalid = vi.fn().mockResolvedValue([classify(unit, 'b'.repeat(64))]);
  await expect(new LocalClassifier(invalid).classify(items)).rejects.toThrow(
    /Invalid/,
  );
  expect(invalid).toHaveBeenCalledTimes(1);
  client.close();
});
test('closing a local classifier aborts pending work and prevents retries', async () => {
  const send = vi.fn(() => new Promise(() => {}));
  const client = new LocalClassifier(send);
  const pending = expect(client.classify(items)).rejects.toThrow();
  client.close();
  await pending;
  expect(send).toHaveBeenCalledTimes(1);
});
