import { createAdapter, attributeId } from './shared';
export const synthetic = {
  ...createAdapter({
    platform: 'synthetic',
    hosts: [],
    roots: '[data-sz-feed]',
    candidates: '[data-sz-unit]',
    bodies: ['[data-sz-body]'],
    identity: (node) => attributeId(node, ['data-sz-id']),
    kind: (_, parent) => (parent ? 'reply' : 'comment'),
  }),
  matches: (url: URL) =>
    url.protocol === 'chrome-extension:' && url.pathname === '/harness.html',
  routeKey: (url: URL) =>
    `${url.origin}${url.pathname}?thread=${url.searchParams.get('thread') ?? '1'}`,
};
