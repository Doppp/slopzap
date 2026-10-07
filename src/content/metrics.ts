export const METRICS = [
  'mutation',
  'discovery',
  'render',
  'cache',
  'classify',
] as const;
export type Metric = (typeof METRICS)[number];
export interface Timing {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export class Metrics {
  private values = new Map<
    Metric,
    { count: number; values: number[]; max: number }
  >();
  record(name: Metric, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    const sample = this.values.get(name) ?? { count: 0, values: [], max: 0 };
    sample.count++;
    sample.max = Math.max(sample.max, value);
    sample.values.push(value);
    if (sample.values.length > 128) sample.values.shift();
    this.values.set(name, sample);
  }
  snapshot(): Partial<Record<Metric, Timing>> {
    return Object.fromEntries(
      [...this.values].map(([name, sample]) => {
        const sorted = [...sample.values].sort((a, b) => a - b);
        return [
          name,
          {
            count: sample.count,
            p50: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
            p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
            max: sample.max,
          },
        ];
      }),
    );
  }
}
