import { attributeId, createAdapter } from './shared';
const candidates = 'ytd-comment-view-model,ytd-comment-renderer';
export const youtube = createAdapter({
  platform: 'youtube',
  hosts: ['www.youtube.com'],
  roots: 'ytd-comments',
  candidates,
  bodies: ['#content-text'],
  identity: (node) =>
    attributeId(node, ['data-comment-id']) ||
    node.querySelector<HTMLAnchorElement>('a[href*="lc="]')?.search ||
    '',
  parent: (node) => {
    if (!node.closest('#replies,ytd-comment-replies-renderer')) return null;
    const thread = node.closest('ytd-comment-thread-renderer');
    const top = thread?.querySelector<HTMLElement>(candidates) ?? null;
    return top === node ? null : top;
  },
  kind: (_, parent) => (parent ? 'reply' : 'comment'),
});
