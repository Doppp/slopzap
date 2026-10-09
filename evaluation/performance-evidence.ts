import { packagedFilesMatch } from './package-evidence';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// SPEC §30. Strict inequalities stay strict; inclusive limits stay inclusive.
export const performanceLimits = {
  mutationP95Ms: [1, false],
  mutationMaxMs: [4, false],
  discoveryMaxMs: [5, true],
  mainTaskMaxMs: [8, false],
  attributableLongTasks: [0, true],
  localBatch16P95Ms: [40, false],
  localBatch16MedianMs: [20, false],
  cache50P95Ms: [20, false],
  cachedRenderP95Ms: [50, false],
  uncachedLocalP95Ms: [150, false],
  modeSwitch500TotalMs: [50, false],
  modeSwitchChunkMaxMs: [8, true],
  contentHeapAboveBaselineMiB: [25, false],
  workerAndCacheHeapMiB: [20, false],
  detachedBoundElementsAfterGc: [0, true],
  networkMaxConcurrent: [2, true],
  networkPerItemCalls: [0, true],
  attributableIdleCpuPercent: [0.5, false],
} as const;

const counts = new Set<string>([
  'attributableLongTasks',
  'detachedBoundElementsAfterGc',
  'networkMaxConcurrent',
  'networkPerItemCalls',
]);

function enabledBudgets(scenario: Record<string, unknown>): boolean {
  const metrics = object(scenario.metrics);
  if (
    !Object.entries(performanceLimits).every(([key, [limit, inclusive]]) => {
      const value = metrics[key];
      return (
        number(value) &&
        (!counts.has(key) || Number.isSafeInteger(value)) &&
        (inclusive ? value <= limit : value < limit)
      );
    })
  )
    return false;
  if (
    (metrics.mutationP95Ms as number) > (metrics.mutationMaxMs as number) ||
    (metrics.localBatch16MedianMs as number) >
      (metrics.localBatch16P95Ms as number)
  )
    return false;
  const ten = metrics.heapAtTenMinutesMiB,
    final = metrics.heapAtThirtyMinutesMiB;
  if (!number(ten) || ten <= 0 || !number(final) || final > ten * 1.15)
    return false;
  if (metrics.detachedBoundElementsIncreasing !== false) return false;
  // A disabled production provider has no dispatch latency. Do not encode it as zero.
  if (scenario.remoteEnabled === false)
    return metrics.remoteP0DispatchMaxMs === null;
  return (
    scenario.remoteEnabled === true &&
    number(metrics.remoteP0DispatchMaxMs) &&
    metrics.remoteP0DispatchMaxMs <= 100
  );
}

export function performanceMatchesPackage(
  report: unknown,
  currentFiles: unknown,
): boolean {
  const source = object(report),
    methods = object(source.methods);
  if (
    source.schemaVersion !== 1 ||
    source.kind !== 'reviewed-reference-performance' ||
    source.referenceHardwareAcceptance !== true ||
    !packagedFilesMatch(source.files, currentFiles) ||
    ![
      'referenceMachineAndStableChrome',
      'attributableTasksAndCpu',
      'actualDroppedFrames',
      'postGcHeapAndRetainerReview',
      'nearViewportScaling1005001000',
    ].every((key) => methods[key] === true)
  )
    return false;
  if (!Array.isArray(source.scenarios) || source.scenarios.length !== 6)
    return false;
  const seen = new Set<string>();
  const scenarios = Array.from(source.scenarios, object);
  for (const scenario of scenarios) {
    if (
      typeof scenario.control !== 'string' ||
      !['absent', 'disabled', 'enabled'].includes(scenario.control) ||
      (scenario.throttle !== 1 && scenario.throttle !== 4) ||
      scenario.units !== 1000 ||
      !number(scenario.scrollDurationSeconds) ||
      scenario.scrollDurationSeconds < 1800 ||
      typeof scenario.evidenceId !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(scenario.evidenceId) ||
      !number(scenario.frameP95Ms) ||
      !number(scenario.droppedFramePercent) ||
      scenario.droppedFramePercent > 100
    )
      return false;
    const key = `${scenario.control}:${scenario.throttle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (scenario.control === 'enabled' && !enabledBudgets(scenario))
      return false;
  }
  for (const throttle of [1, 4]) {
    const enabled = scenarios.find(
      (s) => s.control === 'enabled' && s.throttle === throttle,
    );
    const disabled = scenarios.find(
      (s) => s.control === 'disabled' && s.throttle === throttle,
    );
    if (!enabled || !disabled) return false;
    // Compare to processing-disabled, not absent. Faster frames are valid improvements.
    if (
      (enabled.frameP95Ms as number) - (disabled.frameP95Ms as number) >= 2 ||
      (enabled.droppedFramePercent as number) -
        (disabled.droppedFramePercent as number) >=
        1
    )
      return false;
  }
  return true;
}
