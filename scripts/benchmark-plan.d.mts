export interface BenchmarkScenario {
  installed: boolean;
  enabled: boolean;
  throttle: number;
  units: number;
}
export interface BenchmarkPlan {
  long: boolean;
  seconds: number;
  chrome: boolean;
  mode: 'short' | 'single-long' | 'paired-long';
  scenarios: BenchmarkScenario[];
}
export function benchmarkPlan(argv: readonly string[]): BenchmarkPlan;
