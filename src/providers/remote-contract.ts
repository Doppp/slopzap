import {
  validateOutput,
  type ProviderInput,
  type ProviderResult,
} from './types';
import { abortable } from '../shared/async';
import { validUnit } from '../messaging/protocol';
// Deliberately not imported by a production entrypoint. No fetch, OAuth or credential storage.
export const REMOTE_PRODUCTION_ENABLED = false;
export class TransportFailure extends Error {
  constructor(
    readonly status: number | null,
    readonly retryAfterMs = 0,
  ) {
    super('Mock transport failure');
  }
}
type Transport = (
  items: ProviderInput[],
  signal: AbortSignal,
) => Promise<unknown>;
interface Waiter {
  id: string;
  resolve(value: ProviderResult): void;
  reject(error: Error): void;
  signal: AbortSignal;
  remove(): void;
}
interface Job {
  key: string;
  input: ProviderInput;
  priority: 0 | 1;
  waiters: Set<Waiter>;
  controller: AbortController;
}
export class MockRemoteCoordinator {
  private jobs = new Map<string, Job>();
  private queued = new Set<Job>();
  private running = 0;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timerPriority: 0 | 1 | undefined;
  private closed = false;
  constructor(
    private transport: Transport,
    private sleep = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, ms);
        const abort = () => {
          clearTimeout(timer);
          reject(new Error('Cancelled'));
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
  ) {}
  enqueue(
    key: string,
    input: ProviderInput,
    signal: AbortSignal,
    priority: 0 | 1 = 0,
  ): Promise<ProviderResult> {
    if (
      this.closed ||
      signal.aborted ||
      !/^[a-f0-9]{64}$/.test(key) ||
      (this.jobs.size >= 128 && !this.jobs.has(key))
    )
      return Promise.reject(new Error('Mock queue unavailable'));
    if (
      !validUnit({ ...input.unit, id: '', parentId: null }) ||
      Object.keys(input.unit).some(
        (field) =>
          ![
            'text',
            'parentText',
            'rootText',
            'quotedText',
            'kind',
            'platform',
          ].includes(field),
      ) ||
      input.unit.text.length > 6000 ||
      input.unit.parentText.length > 800 ||
      input.unit.rootText.length > 500 ||
      input.unit.quotedText.length > 600
    )
      return Promise.reject(new Error('Mock input rejected'));
    let job = this.jobs.get(key);
    if (!job) {
      job = {
        key,
        input: { id: `request-${++this.sequence}`, unit: { ...input.unit } },
        priority,
        waiters: new Set(),
        controller: new AbortController(),
      };
      this.jobs.set(key, job);
      this.queued.add(job);
    }
    job.priority = Math.min(job.priority, priority) as 0 | 1;
    const target = job;
    const promise = new Promise<ProviderResult>((resolve, reject) => {
      const abort = () => {
        target.waiters.delete(waiter);
        waiter.remove();
        reject(new Error('Cancelled'));
        if (!target.waiters.size) {
          target.controller.abort();
          this.queued.delete(target);
          this.jobs.delete(target.key);
        }
      };
      const waiter: Waiter = {
        id: input.id,
        resolve,
        reject,
        signal,
        remove: () => signal.removeEventListener('abort', abort),
      };
      target.waiters.add(waiter);
      signal.addEventListener('abort', abort, { once: true });
    });
    if (this.queued.size >= 12) this.flush();
    else {
      if (priority < (this.timerPriority ?? 2) && this.timer !== undefined)
        clearTimeout(this.timer);
      if (this.timer === undefined || priority < (this.timerPriority ?? 2)) {
        this.timerPriority = priority;
        this.timer = setTimeout(
          () => {
            this.timer = undefined;
            this.flush();
          },
          priority === 0 ? 75 : 250,
        );
      }
    }
    return promise;
  }
  private flush(): void {
    if (this.closed) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.timerPriority = undefined;
    }
    while (this.running < 2 && this.queued.size) {
      const sorted = [...this.queued].sort((a, b) => a.priority - b.priority);
      const batch: Job[] = [];
      let characters = 0;
      for (const job of sorted) {
        if (batch.length >= 12) break;
        if (
          batch.length &&
          (job.input.unit.kind === 'article' ||
            batch[0]!.input.unit.kind === 'article')
        )
          continue;
        const length = Object.values(job.input.unit)
          .filter((value) => typeof value === 'string')
          .reduce((sum, value) => sum + value.length, 0);
        if (characters + length > 12000 && batch.length) break;
        batch.push(job);
        characters += length;
      }
      batch.forEach((job) => this.queued.delete(job));
      this.running++;
      void this.dispatch(batch).finally(() => {
        this.running--;
        this.flush();
      });
    }
  }
  private async dispatch(batch: Job[]): Promise<void> {
    const controller = new AbortController();
    const checkCancelled = () => {
      if (batch.every((job) => job.controller.signal.aborted))
        controller.abort();
    };
    batch.forEach((job) =>
      job.controller.signal.addEventListener('abort', checkCancelled),
    );
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(20000),
    ]);
    try {
      let raw: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        signal.throwIfAborted();
        try {
          raw = await abortable(
            this.transport(
              batch.map((job) => job.input),
              signal,
            ),
            signal,
          );
          break;
        } catch (error) {
          const retryable =
            error instanceof TransportFailure &&
            (error.status === null ||
              [408, 429].includes(error.status) ||
              error.status >= 500);
          if (!retryable || attempt || signal.aborted)
            throw new Error('Mock transport unavailable');
          if (error.retryAfterMs > 10000)
            throw new Error('Mock retry delay exceeds budget');
          await this.sleep(
            Math.max(
              error.retryAfterMs,
              500 + Math.floor(Math.random() * 1000),
            ),
            signal,
          );
        }
      }
      signal.throwIfAborted();
      const results = validateOutput(
        raw,
        batch.map((job) => job.input),
      );
      for (const job of batch) {
        const result = results.find((result) => result.id === job.input.id);
        for (const waiter of job.waiters) {
          waiter.remove();
          if (!waiter.signal.aborted && result)
            waiter.resolve({ ...result, id: waiter.id });
          else waiter.reject(new Error('Mock result missing or cancelled'));
        }
      }
    } catch {
      for (const job of batch)
        for (const waiter of job.waiters) {
          waiter.remove();
          waiter.reject(new Error('Mock batch unavailable'));
        }
    } finally {
      for (const job of batch) {
        job.controller.signal.removeEventListener('abort', checkCancelled);
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        job.waiters.clear();
      }
    }
  }
  close(): void {
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    for (const job of this.jobs.values()) {
      job.controller.abort();
      for (const waiter of job.waiters) {
        waiter.remove();
        waiter.reject(new Error('Mock coordinator closed'));
      }
      job.waiters.clear();
    }
    this.jobs.clear();
    this.queued.clear();
  }
}
