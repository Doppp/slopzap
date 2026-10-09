import { performanceLimits } from '../../evaluation/performance-evidence';

export const inventedFiles = { 'invented.js': 'a'.repeat(64) };

// Fabricated passing numbers exercise validation only, never release evidence.
export function inventedPerformanceReport() {
  return {
    schemaVersion: 1,
    kind: 'reviewed-reference-performance',
    referenceHardwareAcceptance: true,
    files: { ...inventedFiles },
    methods: {
      referenceMachineAndStableChrome: true,
      attributableTasksAndCpu: true,
      actualDroppedFrames: true,
      postGcHeapAndRetainerReview: true,
      nearViewportScaling1005001000: true,
    },
    scenarios: [1, 4].flatMap((throttle) =>
      ['absent', 'disabled', 'enabled'].map((control) => ({
        control,
        throttle,
        units: 1000,
        evidenceId: `invented-${control}-${throttle}`,
        scrollDurationSeconds: 1800,
        frameP95Ms: 16,
        droppedFramePercent: 0,
        remoteEnabled: false,
        metrics: {
          ...Object.fromEntries(
            Object.keys(performanceLimits).map((key) => [key, 0]),
          ),
          heapAtTenMinutesMiB: 10,
          heapAtThirtyMinutesMiB: 10,
          detachedBoundElementsIncreasing: false,
          remoteP0DispatchMaxMs: null,
        } as Record<string, unknown>,
      })),
    ),
  };
}
