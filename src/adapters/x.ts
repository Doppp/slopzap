import { attributeId, createAdapter } from './shared';
const quote = '[data-testid="quoteTweet"],[data-sz-quote]';
export const x = createAdapter({
  platform: 'x',
  hosts: ['x.com', 'twitter.com'],
  roots: 'main',
  candidates: 'article[data-testid="tweet"]',
  bodies: ['[data-testid="tweetText"]'],
  quote,
  identity: (node) =>
    attributeId(node, ['data-tweet-id']) ||
    Array.from(
      node.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'),
    ).find((link) => !link.closest(quote))?.pathname ||
    '',
  kind: (node) => (node.querySelector(quote) ? 'quote_commentary' : 'post'),
});
