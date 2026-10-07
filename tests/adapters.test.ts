import { expect, test } from 'vitest';
import { adapters, adapterFor } from '../src/adapters';
test('private routes are excluded across every adapter', () => {
  for (const adapter of adapters) {
    if (adapter.platform === 'synthetic') continue;
    const origins = {
      reddit: 'https://www.reddit.com',
      youtube: 'https://www.youtube.com',
      linkedin: 'https://www.linkedin.com',
      x: 'https://x.com',
      medium: 'https://medium.com',
      synthetic: '',
    };
    expect(
      adapter.matches(new URL(`${origins[adapter.platform]}/messages/inbox`)),
    ).toBe(false);
    for (const path of [
      '/i/chat',
      '/i/communities/invented',
      '/groups/invented',
      '/mod/invented/review',
    ])
      expect(
        adapter.matches(new URL(`${origins[adapter.platform]}${path}`)),
      ).toBe(false);
    if (adapter.platform === 'linkedin')
      expect(adapter.matches(new URL('https://www.linkedin.com/jobs/'))).toBe(
        false,
      );
  }
});
test('YouTube video changes are separate route sessions', () => {
  const a = new URL('https://www.youtube.com/watch?v=one');
  const b = new URL('https://www.youtube.com/watch?v=two');
  expect(adapterFor(a)!.routeKey(a)).not.toBe(adapterFor(b)!.routeKey(b));
});
