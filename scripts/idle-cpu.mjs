import { targetCommand, validateProbeDeadline } from './cdp-target.mjs';

const empty = () => ({ status: 'unavailable', counters: null });
function metrics(response) {
  if (!Array.isArray(response?.metrics) || response.metrics.length > 1000)
    return null;
  const values = {};
  for (const name of ['Timestamp', 'ThreadTime', 'TaskDuration']) {
    const selected = response.metrics.filter((metric) => metric?.name === name);
    if (
      selected.length !== 1 ||
      typeof selected[0].value !== 'number' ||
      !Number.isFinite(selected[0].value) ||
      selected[0].value < 0
    )
      return null;
    values[name] = selected[0].value;
  }
  return values;
}
export function idleCpuDelta(before, after) {
  const start = metrics(before),
    end = metrics(after);
  if (!start || !end) return null;
  const wallSeconds = end.Timestamp - start.Timestamp;
  const threadCpuSeconds = end.ThreadTime - start.ThreadTime;
  const taskCpuSeconds = end.TaskDuration - start.TaskDuration;
  if (
    wallSeconds <= 0 ||
    threadCpuSeconds < 0 ||
    taskCpuSeconds < 0 ||
    threadCpuSeconds > wallSeconds * 1.01 ||
    taskCpuSeconds > wallSeconds * 1.01
  )
    return null;
  return {
    wallSeconds,
    threadCpuSeconds,
    threadCpuPercent: (threadCpuSeconds / wallSeconds) * 100,
    taskCpuSeconds,
  };
}
async function bounded(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Idle diagnostic deadline')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function sampleIdleCpu(
  context,
  page,
  seconds,
  deadlineMs = 5000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  validateProbeDeadline(deadlineMs);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 60)
    throw new Error('Idle window unavailable');
  let session;
  try {
    session = await bounded(() => context.newCDPSession(page), deadlineMs);
  } catch {
    throw new Error('Idle debugger attach unavailable');
  }
  try {
    // POSIX CPU emulation busy-waits on the renderer thread. Remove emulation
    // before CPU accounting; the preceding scroll keeps its original rate.
    await targetCommand(
      session,
      'Emulation.setCPUThrottlingRate',
      { rate: 1 },
      deadlineMs,
    );
    // Explicit threadTicks fails on unsupported platforms instead of silently
    // substituting wall task durations for CPU. No worker debugger attachment.
    await targetCommand(
      session,
      'Performance.enable',
      { timeDomain: 'threadTicks' },
      deadlineMs,
    );
    const before = await targetCommand(
      session,
      'Performance.getMetrics',
      {},
      deadlineMs,
    );
    if (!metrics(before)) return empty();
    // The default wait is a Node timer: no page JS, GC, snapshot or IPC polling.
    await bounded(() => wait(seconds * 1000), seconds * 1000 + deadlineMs);
    const after = await targetCommand(
      session,
      'Performance.getMetrics',
      {},
      deadlineMs,
    );
    const counters = idleCpuDelta(before, after);
    return counters && counters.wallSeconds >= seconds * 0.99
      ? { status: 'measured', counters }
      : empty();
  } catch {
    return empty();
  } finally {
    try {
      await bounded(() => session.detach(), deadlineMs);
    } catch {
      throw new Error('Idle debugger detach unavailable');
    }
  }
}

export function quietIdleEndpoints(
  installed,
  before,
  after,
  visibleBefore,
  visibleAfter,
) {
  if (visibleBefore !== true || visibleAfter !== true) return false;
  if (!installed) return before === null && after === null;
  const valid = (value) =>
    value?.aggregate?.pending === 0 &&
    Number.isSafeInteger(value?.stats?.classifications) &&
    value.stats.classifications >= 0;
  return (
    valid(before) &&
    valid(after) &&
    before.stats.classifications === after.stats.classifications
  );
}
