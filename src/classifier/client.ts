import { browser } from 'wxt/browser';
import type { Result, Unit } from '../shared/types';
import { validResult } from '../messaging/protocol';

export class LocalClassifier {
  private closed = false;
  async classify(
    items: { unit: Unit; fingerprint: string }[],
  ): Promise<Result[]> {
    if (this.closed) throw new Error('Classifier stopped');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const results: unknown = await Promise.race([
        browser.runtime.sendMessage({ type: 'CLASSIFY_LOCAL', items }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Classifier timeout')),
            3000,
          );
        }),
      ]);
      if (this.closed || !Array.isArray(results) || !results.every(validResult))
        throw new Error('Invalid classifier result');
      return results;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  close(): void {
    this.closed = true;
  }
}
