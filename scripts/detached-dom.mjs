import { validateProbeDeadline } from './cdp-target.mjs';

const unavailable = () => ({ status: 'unavailable', counts: null });

// Never export node IDs, names, attributes, text, trees or protocol errors.
export function detachedDomCounts(response) {
  const trees = response?.detachedNodes;
  if (!Array.isArray(trees) || trees.length > 10_000) return null;
  const retained = new Set();
  let visited = 0;
  for (const tree of trees) {
    if (
      !tree?.treeNode ||
      !Number.isInteger(tree.treeNode.nodeType) ||
      tree.treeNode.nodeType < 1 ||
      tree.treeNode.nodeType > 12 ||
      !Array.isArray(tree.retainedNodeIds)
    )
      return null;
    visited += tree.retainedNodeIds.length;
    if (visited > 100_000) return null;
    for (const id of tree.retainedNodeIds) {
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      retained.add(id);
    }
  }
  return { detachedTreeCount: trees.length, retainedNodeCount: retained.size };
}

async function bounded(operation, deadlineMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Diagnostic deadline')),
          deadlineMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function sampleDetachedDom(context, page, deadlineMs = 5000) {
  validateProbeDeadline(deadlineMs);
  let session;
  try {
    session = await bounded(context.newCDPSession(page), deadlineMs);
  } catch {
    // An attachment could complete late. Abort so the caller closes the
    // disposable browser rather than continuing with an unknown session.
    throw new Error('Detached DOM debugger attach unavailable');
  }
  try {
    await bounded(session.send('HeapProfiler.collectGarbage'), deadlineMs);
    const counts = detachedDomCounts(
      await bounded(session.send('DOM.getDetachedDomNodes'), deadlineMs),
    );
    return counts ? { status: 'measured', counts } : unavailable();
  } catch {
    return unavailable();
  } finally {
    // Detach releases inspector-side node references before the next sample.
    try {
      await bounded(session.detach(), deadlineMs);
    } catch {
      throw new Error('Detached DOM debugger detach unavailable');
    }
  }
}
