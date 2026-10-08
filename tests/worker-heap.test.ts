import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import { sampleWorkerHeap } from '../scripts/worker-heap.mjs';

const extensionId = 'a'.repeat(32);
const ownWorker = {
  type: 'service_worker',
  url: `chrome-extension://${extensionId}/background.js`,
  targetId: 'invented-target',
};
class Transport extends EventEmitter {
  targets: unknown = [ownWorker];
  heap: unknown = {
    usedSize: 1024,
    totalSize: 4096,
    embedderHeapUsedSize: 128,
    backingStorageSize: 64,
    privateText: 'invented detail',
  };
  fail: string | undefined;
  commands: { method: string; params: Record<string, unknown> }[] = [];
  async send(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.commands.push({ method, params });
    if (method === this.fail) throw new Error('invented private detail');
    if (method === 'Target.getTargets') return { targetInfos: this.targets };
    if (method === 'Target.attachToTarget')
      return { sessionId: 'invented-session' };
    if (method === 'Target.sendMessageToTarget') {
      const command = JSON.parse(String(params.message));
      this.emit('Target.receivedMessageFromTarget', {
        sessionId: 'invented-session',
        message: JSON.stringify({
          id: command.id,
          ...(command.method === this.fail
            ? { error: { message: 'invented private detail' } }
            : {
                result:
                  command.method === 'Runtime.getHeapUsage' ? this.heap : {},
              }),
        }),
      });
    }
    return {};
  }
}
test('exact own worker gets GC then bounded numeric heap data and immediate detach', async () => {
  const browser = new Transport();
  browser.targets = [
    ownWorker,
    { ...ownWorker, url: 'chrome-extension://other/background.js' },
  ];
  expect(await sampleWorkerHeap(browser, extensionId)).toEqual({
    status: 'measured',
    debuggerAttached: true,
    heap: {
      usedBytes: 1024,
      allocatedBytes: 4096,
      embedderUsedBytes: 128,
      backingStorageBytes: 64,
    },
  });
  expect(
    browser.commands.find(
      (command) => command.method === 'Target.attachToTarget',
    )?.params.targetId,
  ).toBe('invented-target');
  expect(
    browser.commands
      .filter((command) => command.method === 'Target.sendMessageToTarget')
      .map((command) => JSON.parse(String(command.params.message)).method),
  ).toEqual(['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage']);
  expect(browser.commands.at(-1)?.method).toBe('Target.detachFromTarget');
  expect(browser.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
});
test('stopped worker is null, never wakes an extension or substitutes a page/component', async () => {
  const browser = new Transport();
  browser.targets = [
    { ...ownWorker, type: 'page' },
    { ...ownWorker, url: 'chrome-extension://other/background.js' },
  ];
  expect(await sampleWorkerHeap(browser, extensionId)).toEqual({
    status: 'not_running',
    heap: null,
    debuggerAttached: false,
  });
  expect(browser.commands.map((command) => command.method)).toEqual([
    'Target.getTargets',
  ]);
});
test('multiple exact targets abstain instead of selecting an arbitrary worker', async () => {
  const browser = new Transport();
  browser.targets = [
    ownWorker,
    { ...ownWorker, targetId: 'second-invented-target' },
  ];
  expect((await sampleWorkerHeap(browser, extensionId)).status).toBe(
    'ambiguous',
  );
  expect(browser.commands).toHaveLength(1);
});
test.each([
  { value: null },
  { value: {} },
  {
    value: {
      usedSize: '1024',
      totalSize: 4096,
      embedderHeapUsedSize: 0,
      backingStorageSize: 0,
    },
  },
  {
    value: {
      usedSize: -1,
      totalSize: 4096,
      embedderHeapUsedSize: 0,
      backingStorageSize: 0,
    },
  },
  {
    value: {
      usedSize: 4097,
      totalSize: 4096,
      embedderHeapUsedSize: 0,
      backingStorageSize: 0,
    },
  },
])('malformed counters remain unavailable and detach %#', async ({ value }) => {
  const browser = new Transport();
  browser.heap = value;
  expect(await sampleWorkerHeap(browser, extensionId)).toEqual({
    status: 'unavailable',
    heap: null,
    debuggerAttached: true,
  });
  expect(browser.commands.at(-1)?.method).toBe('Target.detachFromTarget');
});
test('target discovery failure is a controlled unavailable result', async () => {
  const browser = new Transport();
  browser.fail = 'Target.getTargets';
  expect(await sampleWorkerHeap(browser, extensionId)).toEqual({
    status: 'unavailable',
    heap: null,
    debuggerAttached: false,
  });
});
test('GC failure detaches and never falls back to pre-GC or renderer data', async () => {
  const browser = new Transport();
  browser.fail = 'HeapProfiler.collectGarbage';
  expect((await sampleWorkerHeap(browser, extensionId)).status).toBe(
    'unavailable',
  );
  expect(browser.commands.at(-1)?.method).toBe('Target.detachFromTarget');
});
test('failed detach aborts the benchmark rather than keeping a worker attached', async () => {
  const browser = new Transport();
  browser.fail = 'Target.detachFromTarget';
  await expect(sampleWorkerHeap(browser, extensionId)).rejects.toThrow(
    'Worker debugger detach unavailable',
  );
  expect(browser.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
});
test('failed attach also aborts to close the disposable profile', async () => {
  const browser = new Transport();
  browser.fail = 'Target.attachToTarget';
  await expect(sampleWorkerHeap(browser, extensionId)).rejects.toThrow(
    'Worker debugger attach unavailable',
  );
});
test('fresh samples rediscover a restarted worker rather than reusing a target', async () => {
  const browser = new Transport();
  await sampleWorkerHeap(browser, extensionId);
  browser.targets = [{ ...ownWorker, targetId: 'restarted-invented-target' }];
  await sampleWorkerHeap(browser, extensionId);
  expect(
    browser.commands
      .filter((command) => command.method === 'Target.attachToTarget')
      .map((command) => command.params.targetId),
  ).toEqual(['invented-target', 'restarted-invented-target']);
});
test('invalid identity fails before querying targets', async () => {
  const browser = new Transport();
  await expect(
    sampleWorkerHeap(browser, 'invented invalid URL'),
  ).rejects.toThrow('Worker identity unavailable');
  expect(browser.commands).toHaveLength(0);
});
