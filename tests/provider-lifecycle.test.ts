import { afterEach, expect, test, vi } from 'vitest';
import {
  ChromePromptProvider,
  type ModelFactory,
  type ModelSession,
} from '../src/providers/chrome-prompt';
import type { ProviderInput } from '../src/providers/types';

const inputs: ProviderInput[] = [
  {
    id: 'invented-target',
    unit: {
      platform: 'reddit',
      kind: 'reply',
      text: 'I measured the invented cache latency yesterday and kept the warm run separate.',
      parentText: '',
      rootText: '',
      quotedText: '',
    },
  },
];
const output = JSON.stringify({
  results: [{ id: inputs[0]!.id, score: 0.4, evidence: 0.8, reasons: [] }],
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const session = (): ModelSession => ({
  clone: vi.fn(),
  prompt: vi.fn(),
  destroy: vi.fn(),
});
afterEach(() => vi.useRealTimers());

test.each(['availability', 'create', 'clone', 'prompt'] as const)(
  'close cancels an ignored-abort %s without needing the caller to abort',
  async (phase) => {
    const availability = deferred<string>(),
      create = deferred<ModelSession>(),
      clone = deferred<ModelSession>(),
      prompt = deferred<string>();
    const child = session(),
      base = session();
    vi.mocked(child.prompt).mockImplementation(() =>
      phase === 'prompt' ? prompt.promise : Promise.resolve(output),
    );
    vi.mocked(base.clone).mockImplementation(() =>
      phase === 'clone' ? clone.promise : Promise.resolve(child),
    );
    const api: ModelFactory = {
      availability: vi.fn(() =>
        phase === 'availability'
          ? availability.promise
          : Promise.resolve('available'),
      ),
      create: vi.fn(() =>
        phase === 'create' ? create.promise : Promise.resolve(base),
      ),
    };
    const provider = new ChromePromptProvider(api),
      controller = new AbortController();
    let settled = false;
    let rejected = false;
    const result = provider.classify(inputs, controller.signal).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
        rejected = true;
      },
    );
    try {
      const entered =
        phase === 'availability'
          ? api.availability
          : phase === 'create'
            ? api.create
            : phase === 'clone'
              ? base.clone
              : child.prompt;
      await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(1));
      provider.close();
      provider.close();
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 });
      expect(rejected).toBe(true);
      availability.resolve('available');
      create.resolve(base);
      clone.resolve(child);
      prompt.resolve(output);
      await result;
      await vi.waitFor(() =>
        expect(base.destroy).toHaveBeenCalledTimes(
          phase === 'availability' ? 0 : 1,
        ),
      );
      expect(child.destroy).toHaveBeenCalledTimes(
        phase === 'clone' || phase === 'prompt' ? 1 : 0,
      );
      expect(
        await provider.classify(inputs, new AbortController().signal),
      ).toEqual([]);
    } finally {
      controller.abort();
      provider.close();
      availability.resolve('available');
      create.resolve(base);
      clone.resolve(child);
      prompt.resolve(output);
      await result;
    }
  },
);

test('an unavailable follow-up cannot cancel the existing idle eviction', async () => {
  vi.useFakeTimers();
  const child = session(),
    base = session();
  vi.mocked(child.prompt).mockResolvedValue(output);
  vi.mocked(base.clone).mockResolvedValue(child);
  const api: ModelFactory = {
    availability: vi.fn().mockResolvedValue('available'),
    create: vi.fn().mockResolvedValue(base),
  };
  const provider = new ChromePromptProvider(api);
  try {
    await provider.classify(inputs, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(30_000);
    vi.mocked(api.availability).mockResolvedValue('unavailable');
    expect(
      await provider.classify(inputs, new AbortController().signal),
    ).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(base.destroy).toHaveBeenCalledTimes(1);
    expect(child.prompt).toHaveBeenCalledTimes(1);
  } finally {
    provider.close();
  }
});

test('overlapping calls fail open without an extra availability check or prompt', async () => {
  const waiting = deferred<string>(),
    child = session(),
    base = session();
  vi.mocked(base.clone).mockResolvedValue(child);
  vi.mocked(child.prompt).mockReturnValue(waiting.promise);
  const api: ModelFactory = {
    availability: vi.fn().mockResolvedValue('available'),
    create: vi.fn().mockResolvedValue(base),
  };
  const provider = new ChromePromptProvider(api);
  const first = provider.classify(inputs, new AbortController().signal);
  try {
    await vi.waitFor(() => expect(child.prompt).toHaveBeenCalledTimes(1));
    expect(
      await provider.classify(inputs, new AbortController().signal),
    ).toEqual([]);
    expect(api.availability).toHaveBeenCalledTimes(1);
    waiting.resolve(output);
    expect(await first).toHaveLength(1);
  } finally {
    waiting.resolve(output);
    provider.close();
    await first.catch(() => {});
  }
});

test.each(['resolve', 'reject'] as const)(
  'an old cancelled create cannot replace or clear a newer base: %s',
  async (mode) => {
    const old = deferred<ModelSession>(),
      oldBase = session(),
      child = session(),
      nextBase = session();
    vi.mocked(child.prompt).mockResolvedValue(output);
    vi.mocked(nextBase.clone).mockResolvedValue(child);
    const api: ModelFactory = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValue(nextBase),
    };
    const provider = new ChromePromptProvider(api),
      caller = new AbortController();
    const first = provider.classify(inputs, caller.signal).catch(() => {});
    try {
      await vi.waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
      caller.abort();
      await first;
      await provider.classify(inputs, new AbortController().signal);
      if (mode === 'resolve') old.resolve(oldBase);
      else old.reject(new Error('invented sensitive error must not be logged'));
      await Promise.resolve();
      await Promise.resolve();
      await provider.classify(inputs, new AbortController().signal);
      expect(api.create).toHaveBeenCalledTimes(2);
      expect(nextBase.destroy).not.toHaveBeenCalled();
      expect(oldBase.destroy).toHaveBeenCalledTimes(mode === 'resolve' ? 1 : 0);
    } finally {
      old.resolve(oldBase);
      caller.abort();
      provider.close();
      await first;
    }
  },
);

test('late clone cleanup failure is scoped to its old base', async () => {
  const late = deferred<ModelSession>(),
    oldBase = session(),
    nextBase = session(),
    child = session(),
    oldChild = session();
  vi.mocked(oldBase.clone).mockReturnValue(late.promise);
  vi.mocked(nextBase.clone).mockResolvedValue(child);
  vi.mocked(child.prompt).mockResolvedValue(output);
  vi.mocked(oldChild.destroy).mockImplementation(() => {
    throw new Error('invented cleanup error');
  });
  const api: ModelFactory = {
    availability: vi.fn().mockResolvedValue('available'),
    create: vi.fn().mockResolvedValueOnce(oldBase).mockResolvedValue(nextBase),
  };
  const provider = new ChromePromptProvider(api),
    caller = new AbortController();
  const first = provider.classify(inputs, caller.signal).catch(() => {});
  try {
    await vi.waitFor(() => expect(oldBase.clone).toHaveBeenCalledTimes(1));
    caller.abort();
    await first;
    await provider.classify(inputs, new AbortController().signal);
    late.resolve(oldChild);
    await Promise.resolve();
    await Promise.resolve();
    await provider.classify(inputs, new AbortController().signal);
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(nextBase.destroy).not.toHaveBeenCalled();
    expect(oldChild.destroy).toHaveBeenCalledTimes(1);
  } finally {
    late.resolve(oldChild);
    caller.abort();
    provider.close();
    await first;
  }
});

test.each([
  'empty',
  'oversized',
  'short-article',
  'expanded-articles',
  'aborted',
] as const)(
  'ineligible %s calls never create a model or cancel idle eviction',
  async (mode) => {
    vi.useFakeTimers();
    const child = session(),
      base = session();
    vi.mocked(child.prompt).mockResolvedValue(output);
    vi.mocked(base.clone).mockResolvedValue(child);
    const api: ModelFactory = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue(base),
    };
    const provider = new ChromePromptProvider(api),
      caller = new AbortController();
    try {
      await provider.classify(inputs, caller.signal);
      await vi.advanceTimersByTimeAsync(30_000);
      const article = {
        ...inputs[0]!,
        unit: { ...inputs[0]!.unit, kind: 'article' as const },
      };
      const rejectedInputs =
        mode === 'empty'
          ? []
          : mode === 'oversized'
            ? Array.from({ length: 13 }, () => inputs[0]!)
            : mode === 'short-article'
              ? [article]
              : mode === 'expanded-articles'
                ? Array.from({ length: 3 }, (_, i) => ({
                    ...article,
                    id: `invented-article-${i}`,
                    unit: {
                      ...article.unit,
                      text: 'Invented article text. '.repeat(300),
                    },
                  }))
                : inputs;
      if (mode === 'aborted') {
        caller.abort();
        await expect(
          provider.classify(rejectedInputs, caller.signal),
        ).rejects.toThrow();
      } else
        expect(await provider.classify(rejectedInputs, caller.signal)).toEqual(
          [],
        );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(base.destroy).toHaveBeenCalledTimes(1);
      expect(api.create).toHaveBeenCalledTimes(1);
      expect(child.prompt).toHaveBeenCalledTimes(1);
    } finally {
      provider.close();
    }
  },
);

test('active inference suspends idle eviction and rearms it after cleanup', async () => {
  vi.useFakeTimers();
  const waiting = deferred<string>(),
    child = session(),
    base = session();
  vi.mocked(base.clone).mockResolvedValue(child);
  vi.mocked(child.prompt)
    .mockResolvedValueOnce(output)
    .mockReturnValue(waiting.promise);
  const api: ModelFactory = {
    availability: vi.fn().mockResolvedValue('available'),
    create: vi.fn().mockResolvedValue(base),
  };
  const provider = new ChromePromptProvider(api);
  let pending: Promise<unknown> | undefined;
  try {
    await provider.classify(inputs, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(59_000);
    pending = provider.classify(inputs, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(child.prompt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(base.destroy).not.toHaveBeenCalled();
    waiting.resolve(output);
    await pending;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(base.destroy).toHaveBeenCalledTimes(1);
  } finally {
    waiting.resolve(output);
    provider.close();
    await pending?.catch(() => {});
  }
});

test('failed creation, cloning and invalid outputs release the base before a fresh attempt', async () => {
  for (const stage of ['create', 'clone', 'output', 'destroy'] as const) {
    const child = session(),
      base = session();
    vi.mocked(child.prompt).mockResolvedValue(
      stage === 'output' ? 'invented invalid response' : output,
    );
    vi.mocked(base.clone).mockImplementation(() =>
      stage === 'clone'
        ? Promise.reject(new Error('invented failure'))
        : Promise.resolve(child),
    );
    if (stage === 'destroy')
      vi.mocked(child.destroy).mockImplementation(() => {
        throw new Error('invented failure');
      });
    const api: ModelFactory = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi
        .fn()
        .mockImplementation(() =>
          stage === 'create'
            ? Promise.reject(new Error('invented failure'))
            : Promise.resolve(base),
        ),
    };
    const provider = new ChromePromptProvider(api);
    try {
      await provider
        .classify(inputs, new AbortController().signal)
        .catch(() => {});
      await provider
        .classify(inputs, new AbortController().signal)
        .catch(() => {});
      expect(api.create).toHaveBeenCalledTimes(2);
    } finally {
      provider.close();
    }
  }
});
