import { attributeId, createAdapter } from './shared';
export const reddit = createAdapter({
  platform: 'reddit',
  hosts: ['www.reddit.com'],
  roots: 'main,shreddit-app',
  rootTitle: 'h1',
  sensitiveRoots: 'shreddit-chat,[data-testid="chat-room"]',
  candidates: 'shreddit-comment,shreddit-post,[data-testid="comment"]',
  bodies: [
    '[slot="comment"]',
    '[slot="text-body"]',
    '[data-testid="comment-body"]',
  ],
  identity: (node) => attributeId(node, ['thingid', 'data-fullname', 'id']),
  kind: (node, parent) =>
    node.matches('shreddit-post')
      ? 'post'
      : parent?.matches('shreddit-comment,[data-testid="comment"]')
        ? 'reply'
        : 'comment',
});
