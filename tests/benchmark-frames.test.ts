import { afterEach, expect, test, vi } from 'vitest';
import {
  installFrameProbe,
  type FrameSummary,
} from '../scripts/benchmark-frames.mjs';

afterEach(() => vi.unstubAllGlobals());
function probe() {
  let callback: FrameRequestCallback = () => undefined;
  let now = 0;
  const pending: { duration: number }[] = [];
  const disconnect = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal('benchmark', undefined);
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
    callback = next;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      observe() {}
      disconnect = disconnect;
      takeRecords() {
        return pending.splice(0);
      }
    },
  );
  installFrameProbe();
  return {
    advance(duration: number) {
      now += duration;
      callback(now);
    },
    pending,
    disconnect,
    cancel,
    stop: () =>
      (
        globalThis as unknown as { benchmark: { stop(): FrameSummary } }
      ).benchmark.stop(),
  };
}
test('full interval retains early slow frames beyond the former 1200-frame tail', () => {
  const data = probe();
  for (let index = 0; index < 200; index++) data.advance(40);
  for (let index = 0; index < 1800; index++) data.advance(10);
  expect(data.stop()).toMatchObject({
    samples: 2000,
    p95LowerBoundMs: 40,
    p95UpperBoundMs: 40.1,
    over33msRatio: 0.1,
    maxMs: 40,
    histogramBytes: 40_004,
  });
});
test('nearest-rank percentile is bounded within one tenth millisecond', () => {
  const data = probe();
  for (let index = 0; index < 19; index++) data.advance(16.25);
  data.advance(100);
  expect(data.stop()).toMatchObject({
    samples: 20,
    p95LowerBoundMs: 16.2,
    p95UpperBoundMs: 16.3,
    over33msRatio: 0.05,
  });
});
test('overflow is explicit and never reported as a capped valid p95', () => {
  const data = probe();
  data.advance(1500);
  expect(data.stop()).toMatchObject({
    p95Ms: null,
    p95LowerBoundMs: null,
    p95UpperBoundMs: null,
    p95Overflow: true,
    overflowSamples: 1,
    maxMs: 1500,
  });
});
test('empty observation has no fabricated zero timing', () => {
  expect(probe().stop()).toMatchObject({
    samples: 0,
    p95Ms: null,
    over33msRatio: null,
    maxMs: null,
    p95Overflow: false,
  });
});
test('invalid and negative frame deltas are not counted', () => {
  const data = probe();
  data.advance(-1);
  data.advance(10);
  expect(data.stop().samples).toBe(1);
});
test('stop drains long tasks, disconnects, cancels and is idempotent', () => {
  const data = probe();
  data.advance(33);
  data.pending.push({ duration: 75 });
  const report = data.stop();
  data.advance(100);
  expect(data.stop()).toBe(report);
  expect(report).toMatchObject({
    samples: 1,
    over33msRatio: 0,
    longTasks: 1,
    longestTaskMs: 75,
  });
  expect(data.disconnect).toHaveBeenCalledTimes(1);
  expect(data.cancel).toHaveBeenCalledTimes(1);
});
