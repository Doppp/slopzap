import { attributeId, createAdapter } from './shared';
export const medium = createAdapter({
  platform: 'medium',
  hosts: ['medium.com'],
  roots: 'main,article',
  candidates: 'article,[data-testid="response"]',
  bodies: [
    '[data-testid="storyContent"]',
    '[data-testid="responseContent"]',
    'section',
  ],
  identity: (node) => attributeId(node, ['data-post-id', 'id']),
  kind: (node) =>
    node.matches('[data-testid="response"]') ? 'article_response' : 'article',
});
