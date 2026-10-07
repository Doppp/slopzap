export type AdapterFailure =
  | 'adapter_parse_failures'
  | 'adapter_parse_exception'
  | 'classifier_unavailable';

export interface AdapterHealthSnapshot {
  code: AdapterFailure | null;
  sampled: number;
  rejected: number;
  consecutiveFailures: number;
}

// Only booleans and counters: never retain DOM nodes, text, identities or URLs.
export class AdapterHealth {
  private outcomes: boolean[] = [];
  private consecutiveFailures = 0;
  private code: AdapterFailure | null = null;

  record(parsed: boolean): AdapterFailure | null {
    if (this.code) return this.code;
    this.outcomes.push(parsed);
    if (this.outcomes.length > 100) this.outcomes.shift();
    this.consecutiveFailures = parsed ? 0 : this.consecutiveFailures + 1;
    const rejected = this.outcomes.filter((outcome) => !outcome).length;
    if (
      this.consecutiveFailures >= 20 ||
      (this.outcomes.length >= 20 && rejected > this.outcomes.length / 2)
    )
      this.code = 'adapter_parse_failures';
    return this.code;
  }

  pause(code: AdapterFailure): void {
    this.code = code;
  }

  snapshot(): AdapterHealthSnapshot {
    return {
      code: this.code,
      sampled: this.outcomes.length,
      rejected: this.outcomes.filter((outcome) => !outcome).length,
      consecutiveFailures: this.consecutiveFailures,
    };
  }
}
