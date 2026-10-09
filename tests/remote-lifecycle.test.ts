import { afterEach, expect, test, vi } from 'vitest';
import {
  MockRemoteCoordinator,
  TransportFailure,
} from '../src/providers/remote-contract';
import type { ProviderInput } from '../src/providers/types';

const input: ProviderInput = {
  id: 'invented',
  unit: {
    text: 'An invented reply for mock transport tests only.',
    parentText: '',
    rootText: '',
    quotedText: '',
    kind: 'reply',
    platform: 'reddit',
  },
};
const key = (n: number) => n.toString(16).padStart(64, '0');
const result = (items: ProviderInput[]) => ({
  results: items.map((item) => ({
    id: item.id,
    score: 0.5,
    evidence: 0.8,
    reasons: [],
  })),
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('partial cancellation removes an item from a retry payload', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const sleep = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const transport = vi
    .fn()
    .mockRejectedValueOnce(new TransportFailure(429))
    .mockImplementation(async (items: ProviderInput[]) => result(items));
  const queue = new MockRemoteCoordinator(transport, sleep),
    cancelled = new AbortController();
  const first = queue
    .enqueue(key(1), input, cancelled.signal)
    .catch(() => null);
  const second = queue.enqueue(
    key(2),
    {
      ...input,
      id: 'survivor',
      unit: { ...input.unit, text: 'A different invented surviving reply.' },
    },
    new AbortController().signal,
  );
  try {
    await vi.advanceTimersByTimeAsync(80);
    expect(sleep).toHaveBeenCalledTimes(1);
    cancelled.abort();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(await first).toBeNull();
    expect((await second).id).toBe('survivor');
    expect(transport.mock.calls[1]![0]).toHaveLength(1);
    expect(transport.mock.calls[1]![0][0].unit.text).toBe(
      'A different invented surviving reply.',
    );
  } finally {
    release?.();
    queue.close();
  }
});

test.each([
  null,
  408,
  429,
  500,
  503,
  599,
  400,
  401,
  403,
  499,
  600,
  Infinity,
  NaN,
  500.5,
  '503',
])(
  'retry status %s is strictly limited to the documented mock contract',
  async (status) => {
    vi.useFakeTimers();
    const retryable =
      status === null || [408, 429, 500, 503, 599].includes(status as number);
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new TransportFailure(status as number | null))
      .mockImplementation(async (items: ProviderInput[]) => result(items));
    const sleep = vi.fn(async () => {}),
      queue = new MockRemoteCoordinator(transport, sleep);
    const pending = queue
      .enqueue(key(1), input, new AbortController().signal)
      .catch(() => null);
    try {
      await vi.advanceTimersByTimeAsync(80);
      expect(await pending).toEqual(
        retryable ? expect.objectContaining({ id: input.id }) : null,
      );
      expect(transport).toHaveBeenCalledTimes(retryable ? 2 : 1);
      expect(sleep).toHaveBeenCalledTimes(retryable ? 1 : 0);
    } finally {
      queue.close();
    }
  },
);

test.each([NaN, Infinity, -1, 10001, '500', null])(
  'invalid retry delay %# never sleeps or retries',
  async (delay) => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockRejectedValue(new TransportFailure(503, delay as number));
    const sleep = vi.fn(async () => {}),
      queue = new MockRemoteCoordinator(transport, sleep);
    const pending = queue
      .enqueue(key(1), input, new AbortController().signal)
      .catch(() => null);
    try {
      await vi.advanceTimersByTimeAsync(80);
      expect(await pending).toBeNull();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    } finally {
      queue.close();
    }
  },
);

test.each([0, 10000])(
  'finite retry delay %s preserves jitter and the bounded Retry-After',
  async (delay) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new TransportFailure(429, delay))
      .mockImplementation(async (items: ProviderInput[]) => result(items));
    const sleep = vi
        .fn<(ms: number, signal: AbortSignal) => Promise<void>>()
        .mockResolvedValue(undefined),
      queue = new MockRemoteCoordinator(transport, sleep);
    const pending = queue.enqueue(key(1), input, new AbortController().signal);
    try {
      await vi.advanceTimersByTimeAsync(80);
      await pending;
      expect(sleep.mock.calls[0]![0]).toBe(Math.max(delay, 500));
    } finally {
      queue.close();
    }
  },
);

test('each attempt receives a fresh payload that cannot mutate later retries or matching', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async (items: ProviderInput[]) => {
    if (transport.mock.calls.length === 1) {
      items[0]!.unit.text = 'Invented changed transport copy.';
      items[0]!.id = 'changed';
      throw new TransportFailure(503);
    }
    expect(items[0]!.unit).toEqual(input.unit);
    expect(items[0]!.id).not.toBe('changed');
    return result(items);
  });
  const queue = new MockRemoteCoordinator(transport, async () => {});
  const pending = queue.enqueue(key(1), input, new AbortController().signal);
  try {
    await vi.advanceTimersByTimeAsync(80);
    expect((await pending).id).toBe(input.id);
  } finally {
    queue.close();
  }
});

test('one cancelled waiter cannot abort a shared in-flight target', async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  const transport = vi
    .fn<(items: ProviderInput[], signal: AbortSignal) => Promise<unknown>>()
    .mockImplementation(
      () =>
        new Promise<unknown>((yes) => {
          resolve = yes;
        }),
    );
  const queue = new MockRemoteCoordinator(transport),
    caller = new AbortController();
  const first = queue.enqueue(key(1), input, caller.signal).catch(() => null);
  const second = queue.enqueue(
    key(1),
    { ...input, id: 'survivor' },
    new AbortController().signal,
  );
  try {
    await vi.advanceTimersByTimeAsync(80);
    caller.abort();
    expect(transport.mock.calls[0]![1].aborted).toBe(false);
    resolve(result(transport.mock.calls[0]![0]));
    expect(await first).toBeNull();
    expect((await second).id).toBe('survivor');
  } finally {
    queue.close();
  }
});

test('invalid queue keys/priorities and inherited unit fields reject before dispatch', async () => {
  const transport = vi.fn(),
    queue = new MockRemoteCoordinator(transport);
  try {
    for (const invalidKey of [null, 123, {}, 'bad', 'A'.repeat(64)])
      await expect(
        queue.enqueue(
          invalidKey as string,
          input,
          new AbortController().signal,
        ),
      ).rejects.toThrow('Mock queue unavailable');
    for (const priority of [-1, 2, NaN, '0'])
      await expect(
        queue.enqueue(
          key(1),
          input,
          new AbortController().signal,
          priority as 0 | 1,
        ),
      ).rejects.toThrow('Mock queue unavailable');
    await expect(
      queue.enqueue(
        key(1),
        { ...input, unit: Object.create(input.unit) },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Mock input rejected');
    expect(transport).not.toHaveBeenCalled();
  } finally {
    queue.close();
  }
});

test('abort-handler reentrancy creates a fresh same-key job without old cleanup deleting it', async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  let next: Promise<unknown> | undefined;
  const transport = vi.fn(
    async (items: ProviderInput[], signal: AbortSignal) => {
      if (transport.mock.calls.length === 1) {
        signal.addEventListener(
          'abort',
          () => {
            next = queue
              .enqueue(
                key(1),
                {
                  ...input,
                  id: 'replacement',
                  unit: {
                    ...input.unit,
                    text: 'A new invented replacement target.',
                  },
                },
                new AbortController().signal,
              )
              .catch(() => null);
          },
          { once: true },
        );
        return new Promise(() => {});
      }
      return result(items);
    },
  );
  const queue = new MockRemoteCoordinator(transport);
  const first = queue.enqueue(key(1), input, caller.signal).catch(() => null);
  try {
    await vi.advanceTimersByTimeAsync(80);
    caller.abort();
    await first;
    await vi.advanceTimersByTimeAsync(80);
    expect(await next).toMatchObject({ id: 'replacement' });
    expect(transport).toHaveBeenCalledTimes(2);
  } finally {
    queue.close();
  }
});

test('the total deadline releases an ignored-abort backoff', async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const owner = new AbortController();
    setTimeout(() => owner.abort(), ms);
    return owner.signal;
  });
  const transport = vi.fn().mockRejectedValue(new TransportFailure(503));
  const queue = new MockRemoteCoordinator(
    transport,
    () => new Promise(() => {}),
  );
  let settled = false;
  const pending = queue
    .enqueue(key(1), input, new AbortController().signal)
    .catch(() => {
      settled = true;
    });
  try {
    await vi.advanceTimersByTimeAsync(80);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(true);
    await pending;
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    queue.close();
  }
});

test.each([
  null,
  undefined,
  [],
  {},
  { ...input, author: 'invented' },
  { ...input, id: '' },
  { ...input, id: 'x'.repeat(129) },
  { ...input, id: {} },
  { ...input, unit: null },
  { ...input, unit: { ...input.unit, text: 'x'.repeat(6001) } },
  { ...input, unit: { ...input.unit, parentText: 'x'.repeat(801) } },
  { ...input, unit: { ...input.unit, author: 'invented' } },
])(
  'malformed input %# rejects without dispatch or content-bearing errors',
  async (value) => {
    const transport = vi.fn(),
      queue = new MockRemoteCoordinator(transport);
    try {
      await expect(
        queue.enqueue(
          key(1),
          value as ProviderInput,
          new AbortController().signal,
        ),
      ).rejects.toThrow('Mock input rejected');
      expect(transport).not.toHaveBeenCalled();
    } finally {
      queue.close();
    }
  },
);

test('capacity is restored after success and closed coordinators never dispatch again', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async (items: ProviderInput[]) => result(items)),
    queue = new MockRemoteCoordinator(transport);
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      const pending = Array.from({ length: 128 }, () =>
        queue.enqueue(key(1), input, new AbortController().signal),
      );
      await vi.advanceTimersByTimeAsync(80);
      expect(await Promise.all(pending)).toHaveLength(128);
    }
    queue.close();
    queue.close();
    await expect(
      queue.enqueue(key(2), input, new AbortController().signal),
    ).rejects.toThrow('Mock queue unavailable');
    expect(transport).toHaveBeenCalledTimes(3);
  } finally {
    queue.close();
  }
});

test('ordinary dispatch keeps two batch slots and drains queued work in twelve-item batches', async () => {
  vi.useFakeTimers();
  const releases: (() => void)[] = [];
  let active = 0,
    maximum = 0;
  const transport = vi.fn(
    (items: ProviderInput[]) =>
      new Promise<unknown>((resolve) => {
        maximum = Math.max(maximum, ++active);
        releases.push(() => {
          active--;
          resolve(result(items));
        });
      }),
  );
  const queue = new MockRemoteCoordinator(transport);
  const pending = Array.from({ length: 36 }, (_, i) =>
    queue
      .enqueue(key(i + 1), input, new AbortController().signal)
      .catch(() => null),
  );
  try {
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([items]) => items.length === 12)).toBe(
      true,
    );
    releases[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(maximum).toBe(2);
    releases[1]!();
    releases[2]!();
    expect((await Promise.all(pending)).every(Boolean)).toBe(true);
  } finally {
    queue.close();
  }
});

test('estimated character limits and long-form isolation hold while all jobs complete', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async (items: ProviderInput[]) => result(items));
  const queue = new MockRemoteCoordinator(transport);
  const pending = Array.from({ length: 8 }, (_, i) =>
    queue.enqueue(
      key(i + 1),
      {
        ...input,
        unit: {
          ...input.unit,
          text: 'Invented bounded text. '.repeat(100),
          kind: i >= 6 ? 'article' : 'reply',
        },
      },
      new AbortController().signal,
    ),
  );
  try {
    await vi.advanceTimersByTimeAsync(80);
    await Promise.all(pending);
    for (const [items] of transport.mock.calls) {
      expect(items.length).toBeLessThanOrEqual(12);
      expect(
        items.reduce(
          (total, item) =>
            total +
            Object.values(item.unit).reduce(
              (sum, value) => sum + value.length,
              0,
            ),
          0,
        ),
      ).toBeLessThanOrEqual(12000);
      if (items.some((item) => item.unit.kind === 'article'))
        expect(items).toHaveLength(1);
    }
  } finally {
    queue.close();
  }
});

test('P0 arrival replaces the slower P1 debounce and sorts the urgent target first', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async (items: ProviderInput[]) => result(items));
  const queue = new MockRemoteCoordinator(transport);
  const background = queue.enqueue(
    key(1),
    input,
    new AbortController().signal,
    1,
  );
  try {
    await vi.advanceTimersByTimeAsync(50);
    const urgent = queue.enqueue(
      key(2),
      input,
      new AbortController().signal,
      0,
    );
    await vi.advanceTimersByTimeAsync(74);
    expect(transport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([background, urgent]);
    expect(transport.mock.calls[0]![0].map((item) => item.id)).toEqual([
      'request-2',
      'request-1',
    ]);
  } finally {
    queue.close();
  }
});

test('cancelling ignored-abort backoffs releases both slots for subsequent work', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async (items: ProviderInput[]) => {
    if (transport.mock.calls.length <= 2) throw new TransportFailure(503);
    return result(items);
  });
  const sleep = vi.fn(() => new Promise<void>(() => {}));
  const queue = new MockRemoteCoordinator(transport, sleep),
    caller = new AbortController();
  const cancelled = [
    queue.enqueue(key(1), input, caller.signal).catch(() => null),
  ];
  try {
    await vi.advanceTimersByTimeAsync(80);
    cancelled.push(
      queue.enqueue(key(2), input, caller.signal).catch(() => null),
    );
    await vi.advanceTimersByTimeAsync(80);
    expect(sleep).toHaveBeenCalledTimes(2);
    caller.abort();
    await Promise.all(cancelled);
    let resolved = false;
    const next = queue
      .enqueue(key(3), input, new AbortController().signal)
      .then(
        () => {
          resolved = true;
        },
        () => {},
      );
    await vi.advanceTimersByTimeAsync(80);
    expect(resolved).toBe(true);
    await next;
  } finally {
    queue.close();
  }
});

test('same-key fan-out requires identical authored units', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async (items: ProviderInput[]) => result(items));
  const queue = new MockRemoteCoordinator(transport);
  const first = queue
    .enqueue(key(1), input, new AbortController().signal)
    .catch(() => null);
  try {
    const conflicting = queue
      .enqueue(
        key(1),
        {
          ...input,
          unit: { ...input.unit, text: 'A conflicting invented target.' },
        },
        new AbortController().signal,
      )
      .then(
        () => 'accepted',
        () => 'rejected',
      );
    await vi.advanceTimersByTimeAsync(80);
    expect(await conflicting).toBe('rejected');
    await first;
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    queue.close();
  }
});

test('duplicate waiter fan-out is bounded and cancellation restores capacity', async () => {
  vi.useFakeTimers();
  const queue = new MockRemoteCoordinator(async (items) => result(items));
  const callers = Array.from({ length: 128 }, () => new AbortController());
  const waiters = callers.map((caller) =>
    queue.enqueue(key(1), input, caller.signal).catch(() => null),
  );
  try {
    let rejected = false;
    queue.enqueue(key(1), input, new AbortController().signal).catch(() => {
      rejected = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toBe(true);
    callers.forEach((caller) => caller.abort());
    await Promise.all(waiters);
    const next = queue.enqueue(key(1), input, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(80);
    expect((await next).id).toBe(input.id);
  } finally {
    queue.close();
  }
});
