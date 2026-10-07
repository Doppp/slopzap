import { attributeId, createAdapter } from './shared';
export const linkedin = createAdapter({
  platform: 'linkedin',
  hosts: ['www.linkedin.com'],
  roots: 'main',
  sensitiveRoots:
    '.msg-overlay-container,.msg-overlay-conversation-bubble,.msg-convo-wrapper,[data-view-name="messaging-conversation"]',
  candidates:
    '.feed-shared-update-v2,.comments-comment-item,.comments-comment-entity',
  bodies: [
    '.update-components-text',
    '.comments-comment-item__main-content',
    '.comments-comment-item-content-body',
    '.comments-comment-entity__content',
  ],
  identity: (node) => attributeId(node, ['data-urn', 'data-id', 'id']),
  kind: (node, parent) =>
    node.matches('.feed-shared-update-v2')
      ? 'post'
      : parent?.matches('.comments-comment-item,.comments-comment-entity')
        ? 'reply'
        : 'comment',
});
