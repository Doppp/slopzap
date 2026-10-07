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
test('authentication and challenge routes are inert without blocking public sign-in topics', () => {
  for (const origin of [
    'https://www.reddit.com',
    'https://www.youtube.com',
    'https://www.linkedin.com',
    'https://x.com',
    'https://medium.com',
  ])
    for (const path of [
      '/login',
      '/signin/',
      '/sign-in',
      '/signup',
      '/sign-up',
      '/authwall',
      '/challenge',
      '/checkpoint/challenge',
      '/uas/login',
      '/i/flow/login',
      '/i/flow/signup',
      '/account/login',
      '/m/signin',
    ])
      expect(adapterFor(new URL(origin + path))).toBeUndefined();
  expect(
    adapterFor(
      new URL('https://www.reddit.com/r/login/comments/invented/topic/'),
    )?.platform,
  ).toBe('reddit');
  expect(
    adapterFor(new URL('https://medium.com/@invented/sign-in-design-invented'))
      ?.platform,
  ).toBe('medium');
});
