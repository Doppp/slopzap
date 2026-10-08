import type { TargetTransport } from './cdp-target.mjs';
export interface WorkerHeapSample {
  status: 'measured' | 'not_running' | 'unavailable' | 'ambiguous';
  debuggerAttached: boolean;
  heap: null | {
    usedBytes: number;
    allocatedBytes: number;
    embedderUsedBytes: number;
    backingStorageBytes: number;
  };
}
export function sampleWorkerHeap(
  browser: TargetTransport,
  extensionId: string,
  deadlineMs?: number,
): Promise<WorkerHeapSample>;
