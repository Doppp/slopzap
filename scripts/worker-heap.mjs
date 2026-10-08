import {
  targetSession,
  targetCommand,
  validateProbeDeadline,
} from './cdp-target.mjs';

const empty = (status) => ({ status, heap: null, debuggerAttached: false });
export async function sampleWorkerHeap(
  browser,
  extensionId,
  deadlineMs = 5000,
) {
  validateProbeDeadline(deadlineMs);
  // No fallback to a page, built-in component or unrelated service worker.
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId))
    throw new Error('Worker identity unavailable');
  let candidates;
  try {
    const { targetInfos } = await targetCommand(
      browser,
      'Target.getTargets',
      {},
      deadlineMs,
    );
    if (!Array.isArray(targetInfos)) return empty('unavailable');
    candidates = targetInfos.filter(
      (target) =>
        target?.type === 'service_worker' &&
        target.url === `chrome-extension://${extensionId}/background.js`,
    );
  } catch {
    return empty('unavailable');
  }
  if (!candidates.length) return empty('not_running');
  if (
    candidates.length !== 1 ||
    typeof candidates[0].targetId !== 'string' ||
    !candidates[0].targetId ||
    candidates[0].targetId.length > 2048
  )
    return empty('ambiguous');
  const session = targetSession(browser, candidates[0].targetId, deadlineMs);
  let attached = false;
  try {
    await session.connect();
    attached = true;
    await session.send('HeapProfiler.collectGarbage');
    const data = await session.send('Runtime.getHeapUsage');
    const fields = [
      'usedSize',
      'totalSize',
      'embedderHeapUsedSize',
      'backingStorageSize',
    ];
    if (
      !data ||
      fields.some(
        (field) =>
          typeof data[field] !== 'number' ||
          !Number.isFinite(data[field]) ||
          data[field] < 0,
      ) ||
      data.usedSize > data.totalSize
    )
      return { ...empty('unavailable'), debuggerAttached: true };
    return {
      status: 'measured',
      debuggerAttached: true,
      heap: {
        usedBytes: data.usedSize,
        allocatedBytes: data.totalSize,
        embedderUsedBytes: data.embedderHeapUsedSize,
        backingStorageBytes: data.backingStorageSize,
      },
    };
  } catch {
    if (!attached) throw new Error('Worker debugger attach unavailable');
    return { ...empty('unavailable'), debuggerAttached: true };
  } finally {
    // A failed detach aborts the scenario; never continue a long run with an
    // unintentionally debugger-held worker. The caller closes its profile.
    if (!(await session.close()) && attached)
      throw new Error('Worker debugger detach unavailable');
  }
}
