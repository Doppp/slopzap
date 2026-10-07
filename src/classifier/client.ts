import { browser } from 'wxt/browser';
import type { Result, Unit } from '../shared/types';
import { validResult } from '../messaging/protocol';
import { abortable } from '../shared/async';

export class LocalClassifier {
  private lifetime = new AbortController();
  constructor(
    private send: (message: unknown) => Promise<unknown> = (message) =>
      browser.runtime.sendMessage(message),
  ) {}
  async classify(
    items: { unit: Unit; fingerprint: string }[],
  ): Promise<Result[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      this.lifetime.signal.throwIfAborted();
      let results: unknown;
      try {
        results = await abortable(
          this.send({ type: 'CLASSIFY_LOCAL', items }),
          AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(3000)]),
        );
      } catch {
        if (attempt || this.lifetime.signal.aborted)
          throw new Error('Local classifier unavailable');
        else continue;
      }
      if (
        this.lifetime.signal.aborted ||
        !Array.isArray(results) ||
        !results.every(validResult) ||
        new Set(results.map((result) => result.fingerprint)).size !==
          results.length ||
        results.some(
          (result) =>
            !items.some((item) => item.fingerprint === result.fingerprint),
        )
      )
        throw new Error('Invalid classifier result');
      return results;
    }
    throw new Error('Local classifier unavailable');
  }
  close(): void {
    this.lifetime.abort();
  }
}
