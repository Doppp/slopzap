import { expect, test, vi } from 'vitest';
import {
  MockRemoteCoordinator,
  REMOTE_PRODUCTION_ENABLED,
  TransportFailure,
} from '../src/providers/remote-contract';
import type { ProviderInput } from '../src/providers/types';
const input: ProviderInput = {
  id: 'original',
  unit: {
    text: 'Invented test reply that does not leave the unit test.',
    parentText: '',
    rootText: '',
    quotedText: '',
    kind: 'reply',
    platform: 'reddit',
  },
};
const result = (items: ProviderInput[]) => ({
  results: items.map((item) => ({
    id: item.id,
    score: 0.5,
    evidence: 0.8,
    reasons: [],
  })),
});
test('production stays disabled; duplicate keys fan out with opaque request IDs', async () => {
  expect(REMOTE_PRODUCTION_ENABLED).toBe(false);
  vi.useFakeTimers();
  const transport = vi.fn(async (items) => result(items));
  const queue = new MockRemoteCoordinator(transport);
  const one = queue.enqueue(
    'a'.repeat(64),
    input,
    new AbortController().signal,
  );
  const two = queue.enqueue(
    'a'.repeat(64),
    { ...input, id: 'second' },
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(80);
  expect((await one).id).toBe('original');
  expect((await two).id).toBe('second');
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0]![0]).toHaveLength(1);
  expect(JSON.stringify(transport.mock.calls[0]![0])).not.toContain(
    'a'.repeat(64),
  );
  queue.close();
  vi.useRealTimers();
});
test('transient failures retry once but authentication errors never retry', async () => {
  for (const status of [429, 401]) {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new TransportFailure(status))
      .mockImplementation(async (items) => result(items));
    const queue = new MockRemoteCoordinator(transport, async () => {});
    const promise = queue.enqueue(
      'b'.repeat(64),
      input,
      new AbortController().signal,
    );
    const outcome = promise.then(
      (value) => value,
      () => null,
    );
    await vi.advanceTimersByTimeAsync(80);
    expect(await outcome).toEqual(
      status === 429 ? expect.objectContaining({ id: 'original' }) : null,
    );
    expect(transport).toHaveBeenCalledTimes(status === 429 ? 2 : 1);
    queue.close();
    vi.useRealTimers();
  }
});
test('cancelled queued requests never dispatch and closing releases waiters', async () => {
  vi.useFakeTimers();
  const transport = vi.fn();
  const queue = new MockRemoteCoordinator(transport);
  const controller = new AbortController();
  const outcome = queue
    .enqueue('c'.repeat(64), input, controller.signal)
    .catch(() => null);
  controller.abort();
  await vi.advanceTimersByTimeAsync(100);
  expect(await outcome).toBeNull();
  expect(transport).not.toHaveBeenCalled();
  queue.close();
  vi.useRealTimers();
});
