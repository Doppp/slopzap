import type { BrowserContext, Page } from '@playwright/test';
export interface IdleCpuCounters {
  wallSeconds: number;
  threadCpuSeconds: number;
  threadCpuPercent: number;
  taskCpuSeconds: number;
}
export interface IdleCpuSample {
  status: 'measured' | 'unavailable';
  counters: IdleCpuCounters | null;
}
export function idleCpuDelta(
  before: unknown,
  after: unknown,
): IdleCpuCounters | null;
export function sampleIdleCpu(
  context: Pick<BrowserContext, 'newCDPSession'>,
  page: Page,
  seconds: number,
  deadlineMs?: number,
  wait?: (ms: number) => Promise<void>,
): Promise<IdleCpuSample>;
export function quietIdleEndpoints(
  installed: boolean,
  before: unknown,
  after: unknown,
  visibleBefore: unknown,
  visibleAfter: unknown,
): boolean;
