import { expect, test, vi } from 'vitest';
import type { BrowserContext, Page } from '@playwright/test';
import {
  idleCpuDelta,
  sampleIdleCpu,
  quietIdleEndpoints,
} from '../scripts/idle-cpu.mjs';
const response = (Timestamp = 100, ThreadTime = 10, TaskDuration = 5) => ({
  metrics: [
    { name: 'Timestamp', value: Timestamp },
    { name: 'ThreadTime', value: ThreadTime },
    { name: 'TaskDuration', value: TaskDuration },
    { name: 'invented private label', value: 42 },
  ],
});
test('CPU projection exports deltas only, on a one-thread basis without clamping or summing task time', () => {
  const result = idleCpuDelta(response(), response(102, 10.02, 5.01))!;
  expect(Object.keys(result)).toEqual([
    'wallSeconds',
    'threadCpuSeconds',
    'threadCpuPercent',
    'taskCpuSeconds',
  ]);
  expect(result.wallSeconds).toBe(2);
  expect(result.threadCpuSeconds).toBeCloseTo(0.02);
  expect(result.threadCpuPercent).toBeCloseTo(1);
  expect(result.taskCpuSeconds).toBeCloseTo(0.01);
  expect(idleCpuDelta(response(), response(101, 10, 5))).toEqual({
    wallSeconds: 1,
    threadCpuSeconds: 0,
    threadCpuPercent: 0,
    taskCpuSeconds: 0,
  });
});
test.each([
  undefined,
  {},
  { metrics: [] },
  { metrics: [{ name: 'Timestamp', value: 100 }] },
  { metrics: [...response().metrics, { name: 'ThreadTime', value: 10 }] },
  {
    metrics: response().metrics.map((metric) =>
      metric.name === 'ThreadTime' ? { ...metric, value: '10' } : metric,
    ),
  },
  {
    metrics: response().metrics.map((metric) =>
      metric.name === 'ThreadTime' ? { ...metric, value: Infinity } : metric,
    ),
  },
  {
    metrics: response().metrics.map((metric) =>
      metric.name === 'ThreadTime' ? { ...metric, value: -1 } : metric,
    ),
  },
  { metrics: Array(1001).fill({ name: 'invented', value: 0 }) },
])('malformed or missing counters never become measured zero %#', (invalid) => {
  expect(idleCpuDelta(invalid, response(101, 10.01, 5.005))).toBeNull();
  expect(idleCpuDelta(response(), invalid)).toBeNull();
});
test.each(
  [
    [100, 10, 5],
    [99, 10, 5],
    [101, 9, 5],
    [101, 10, 4],
    [101, 12, 5],
    [101, 10, 7],
  ].map((args) => ({ args })),
)(
  'counter resets or impossible thread/task utilization stay unavailable %#',
  ({ args }) => {
    expect(
      idleCpuDelta(response(), response(...(args as [number, number, number]))),
    ).toBeNull();
  },
);
function mock(fail?: string, silent?: string) {
  const calls: string[] = [];
  let readings = 0;
  const operation = async (method: string, params?: unknown) => {
    calls.push(method);
    if (method === fail) throw new Error('invented private exception');
    if (method === silent)
      return new Promise<Record<string, unknown>>(() => {});
    if (method === 'Performance.enable')
      expect(params).toEqual({ timeDomain: 'threadTicks' });
    if (method === 'Emulation.setCPUThrottlingRate')
      expect(params).toEqual({ rate: 1 });
    return method === 'Performance.getMetrics'
      ? readings++
        ? response(101, 10.01, 5.005)
        : response()
      : {};
  };
  const context = {
    newCDPSession: async () => {
      await operation('attach');
      return { send: operation, detach: () => operation('detach') };
    },
  } as unknown as Pick<BrowserContext, 'newCDPSession'>;
  const wait = async (ms: number) => {
    expect(ms).toBe(1000);
    calls.push('node-wait');
  };
  return { context, calls, wait };
}
const page = {} as Page;
test('quiet wait issues only endpoint counter commands and immediately detaches', async () => {
  const { context, calls, wait } = mock();
  expect((await sampleIdleCpu(context, page, 1, 5000, wait)).status).toBe(
    'measured',
  );
  expect(calls).toEqual([
    'attach',
    'Emulation.setCPUThrottlingRate',
    'Performance.enable',
    'Performance.getMetrics',
    'node-wait',
    'Performance.getMetrics',
    'detach',
  ]);
});
test.each([
  'Emulation.setCPUThrottlingRate',
  'Performance.enable',
  'Performance.getMetrics',
])(
  'counter command failure or timeout remains null and detaches: %s',
  async (method) => {
    for (const hanging of [false, true]) {
      const { context, calls, wait } = mock(
        hanging ? undefined : method,
        hanging ? method : undefined,
      );
      expect(await sampleIdleCpu(context, page, 1, 5, wait)).toEqual({
        status: 'unavailable',
        counters: null,
      });
      expect(calls.at(-1)).toBe('detach');
    }
  },
);
test.each(['attach', 'detach'])(
  'unknown %s outcome aborts with controlled failure',
  async (method) => {
    for (const hanging of [false, true]) {
      const { context, wait } = mock(
        hanging ? undefined : method,
        hanging ? method : undefined,
      );
      await expect(sampleIdleCpu(context, page, 1, 5, wait)).rejects.toThrow(
        `Idle debugger ${method} unavailable`,
      );
    }
  },
);
test('stuck quiet wait is bounded and releases its debugger session', async () => {
  vi.useFakeTimers();
  try {
    const { context, calls } = mock();
    const result = sampleIdleCpu(
      context,
      page,
      1,
      5,
      () => new Promise(() => {}),
    );
    await vi.advanceTimersByTimeAsync(1100);
    expect(await result).toEqual({ status: 'unavailable', counters: null });
    expect(calls.at(-1)).toBe('detach');
  } finally {
    vi.useRealTimers();
  }
});
test.each([0, -1, 1.5, NaN, Infinity, 61])(
  'invalid quiet duration %s fails before attachment',
  async (seconds) => {
    const { context, calls, wait } = mock();
    await expect(
      sampleIdleCpu(context, page, seconds, 5, wait),
    ).rejects.toThrow('Idle window unavailable');
    expect(calls).toHaveLength(0);
  },
);
test('invalid command deadline fails before attachment', async () => {
  const { context, calls, wait } = mock();
  await expect(sampleIdleCpu(context, page, 1, 0, wait)).rejects.toThrow(
    'Probe deadline unavailable',
  );
  expect(calls).toHaveLength(0);
});
const endpoint = (pending = 0, classifications = 3) => ({
  aggregate: { pending },
  stats: { classifications },
});
test('quiet endpoints require visible controls, no pending work and unchanged classification count', () => {
  expect(quietIdleEndpoints(true, endpoint(), endpoint(), true, true)).toBe(
    true,
  );
  expect(quietIdleEndpoints(false, null, null, true, true)).toBe(true);
  for (const [before, after] of [
    [null, null],
    [endpoint(1), endpoint()],
    [endpoint(), endpoint(1)],
    [endpoint(), endpoint(0, 4)],
    [endpoint(0, NaN), endpoint()],
  ])
    expect(quietIdleEndpoints(true, before, after, true, true)).toBe(false);
  expect(quietIdleEndpoints(false, endpoint(), null, true, true)).toBe(false);
  expect(quietIdleEndpoints(true, endpoint(), endpoint(), false, true)).toBe(
    false,
  );
  expect(quietIdleEndpoints(true, endpoint(), endpoint(), true, false)).toBe(
    false,
  );
});
