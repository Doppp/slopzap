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
const UNIT_FIELDS = [
  'text',
  'parentText',
  'rootText',
  'quotedText',
  'kind',
  'platform',
] as const;
function validInput(value: unknown): value is ProviderInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as ProviderInput;
  return (
    Object.keys(input).every((field) => field === 'id' || field === 'unit') &&
    typeof input.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(input.id) &&
    !!input.unit &&
    typeof input.unit === 'object' &&
    !Array.isArray(input.unit) &&
    Object.keys(input.unit).every((field) =>
      (UNIT_FIELDS as readonly string[]).includes(field),
    ) &&
    UNIT_FIELDS.every((field) => Object.hasOwn(input.unit, field)) &&
    validUnit({ ...input.unit, id: '', parentId: null }) &&
    input.unit.text.length <= 6000
  );
}
export class MockRemoteCoordinator {
  private jobs = new Map<string, Job>();
  private queued = new Set<Job>();
  private running = 0;
  private sequence = 0;
  private pendingWaiters = 0;
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
          signal.removeEventListener('abort', abort);
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
      typeof key !== 'string' ||
      !/^[a-f0-9]{64}$/.test(key) ||
      (priority !== 0 && priority !== 1) ||
      this.pendingWaiters >= 128 ||
      (this.jobs.size >= 128 && !this.jobs.has(key))
    )
      return Promise.reject(new Error('Mock queue unavailable'));
    if (!validInput(input))
      return Promise.reject(new Error('Mock input rejected'));
    const existing = this.jobs.get(key);
    if (
      existing &&
      !UNIT_FIELDS.every(
        (field) => existing.input.unit[field] === input.unit[field],
      )
    )
      return Promise.reject(new Error('Mock input rejected'));
    let job = existing;
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
      let removed = false;
      const abort = () => {
        target.waiters.delete(waiter);
        waiter.remove();
        reject(new Error('Cancelled'));
        if (!target.waiters.size) {
          this.queued.delete(target);
          if (this.jobs.get(target.key) === target)
            this.jobs.delete(target.key);
          target.controller.abort();
        }
      };
      const waiter: Waiter = {
        id: input.id,
        resolve,
        reject,
        signal,
        remove: () => {
          if (removed) return;
          removed = true;
          signal.removeEventListener('abort', abort);
          this.pendingWaiters--;
        },
      };
      this.pendingWaiters++;
      target.waiters.add(waiter);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
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
    checkCancelled();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(20000),
    ]);
    try {
      let raw: unknown;
      let submitted: Job[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        signal.throwIfAborted();
        submitted = batch.filter(
          (job) => !job.controller.signal.aborted && job.waiters.size > 0,
        );
        if (!submitted.length) throw new Error('Mock batch unavailable');
        try {
          raw = await abortable(
            this.transport(
              submitted.map((job) => ({
                id: job.input.id,
                unit: { ...job.input.unit },
              })),
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
              (typeof error.status === 'number' &&
                Number.isInteger(error.status) &&
                error.status >= 500 &&
                error.status <= 599));
          if (!retryable || attempt || signal.aborted)
            throw new Error('Mock transport unavailable');
          if (
            typeof error.retryAfterMs !== 'number' ||
            !Number.isFinite(error.retryAfterMs) ||
            error.retryAfterMs < 0 ||
            error.retryAfterMs > 10000
          )
            throw new Error('Mock retry delay exceeds budget');
          await abortable(
            this.sleep(
              Math.max(
                error.retryAfterMs,
                500 + Math.floor(Math.random() * 1000),
              ),
              signal,
            ),
            signal,
          );
        }
      }
      signal.throwIfAborted();
      const results = validateOutput(
        raw,
        submitted.map((job) => job.input),
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
    this.timer = undefined;
    this.timerPriority = undefined;
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
