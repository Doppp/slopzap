export interface FrameSummary {
  samples: number;
  coverage: string;
  histogramBinMs: number;
  histogramBytes: number;
  p95Ms: number | null;
  p95LowerBoundMs: number | null;
  p95UpperBoundMs: number | null;
  p95Overflow: boolean;
  overflowSamples: number;
  maxMs: number | null;
  over33msRatio: number | null;
  over33msIsDroppedFrameProxy: boolean;
  longTasks: number;
  longestTaskMs: number;
}
export function installFrameProbe(): void;
