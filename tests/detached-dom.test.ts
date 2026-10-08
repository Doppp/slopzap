import { expect, test } from 'vitest';
import type { BrowserContext, Page } from '@playwright/test';
import {
  detachedDomCounts,
  sampleDetachedDom,
} from '../scripts/detached-dom.mjs';

const tree = (ids: number[]) => ({
  treeNode: {
    nodeType: 1,
    nodeId: 7,
    nodeName: 'INVENTED',
    attributes: ['invented', 'private detail'],
    children: [{ nodeValue: 'invented text' }],
  },
  retainedNodeIds: ids,
});
test('projection exports only counts and deduplicates retained node IDs', () => {
  expect(
    detachedDomCounts({ detachedNodes: [tree([1, 2]), tree([2, 3])] }),
  ).toEqual({
    detachedTreeCount: 2,
    retainedNodeCount: 3,
  });
  expect(detachedDomCounts({ detachedNodes: [] })).toEqual({
    detachedTreeCount: 0,
    retainedNodeCount: 0,
  });
});
test.each([
  undefined,
  {},
  { detachedNodes: null },
  { detachedNodes: [null] },
  { detachedNodes: [{ retainedNodeIds: [] }] },
  { detachedNodes: [{ ...tree([]), treeNode: { nodeType: 0 } }] },
  { detachedNodes: [{ ...tree([]), treeNode: { nodeType: 13 } }] },
  { detachedNodes: [{ ...tree([]), retainedNodeIds: null }] },
  ...[0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'].map((id) => ({
    detachedNodes: [{ ...tree([]), retainedNodeIds: [id] }],
  })),
])(
  'malformed response never becomes a successful zero count %#',
  (response) => {
    expect(detachedDomCounts(response)).toBeNull();
  },
);
test('projection bounds tree and retained-ID work', () => {
  expect(
    detachedDomCounts({ detachedNodes: Array(10_001).fill(tree([])) }),
  ).toBeNull();
  expect(
    detachedDomCounts({ detachedNodes: [tree(Array(100_001).fill(1))] }),
  ).toBeNull();
});

function mock(
  fail?: string,
  silent?: string,
  response: unknown = { detachedNodes: [tree([1, 2])] },
) {
  const calls: string[] = [];
  const operation = async (name: string) => {
    calls.push(name);
    if (fail === name) throw new Error('invented private error text');
    if (silent === name) await new Promise(() => {});
    return response;
  };
  const session = { send: operation, detach: () => operation('detach') };
  const context = {
    newCDPSession: async () => {
      await operation('attach');
      return session;
    },
  } as unknown as Pick<BrowserContext, 'newCDPSession'>;
  return { context, calls };
}
const page = {} as Page;
test('fresh session runs GC, projects counts and detaches without enabling DOM tracking', async () => {
  const { context, calls } = mock();
  expect(await sampleDetachedDom(context, page)).toEqual({
    status: 'measured',
    counts: { detachedTreeCount: 1, retainedNodeCount: 2 },
  });
  expect(calls).toEqual([
    'attach',
    'HeapProfiler.collectGarbage',
    'DOM.getDetachedDomNodes',
    'detach',
  ]);
});
test.each(['HeapProfiler.collectGarbage', 'DOM.getDetachedDomNodes'])(
  'command failure or timeout stays null and detaches: %s',
  async (command) => {
    for (const hanging of [false, true]) {
      const { context, calls } = mock(
        hanging ? undefined : command,
        hanging ? command : undefined,
      );
      expect(await sampleDetachedDom(context, page, 5)).toEqual({
        status: 'unavailable',
        counts: null,
      });
      expect(calls.at(-1)).toBe('detach');
    }
  },
);
test('malformed protocol response is unavailable after detach', async () => {
  const { context, calls } = mock(undefined, undefined, {});
  expect(await sampleDetachedDom(context, page)).toEqual({
    status: 'unavailable',
    counts: null,
  });
  expect(calls.at(-1)).toBe('detach');
});
test.each(['attach', 'detach'])(
  'attachment/cleanup failure or timeout aborts with controlled error: %s',
  async (command) => {
    for (const hanging of [false, true]) {
      const { context } = mock(
        hanging ? undefined : command,
        hanging ? command : undefined,
      );
      await expect(sampleDetachedDom(context, page, 5)).rejects.toThrow(
        `Detached DOM debugger ${command} unavailable`,
      );
    }
  },
);
