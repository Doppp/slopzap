import { expect, test } from 'vitest';
import {
  applyChoices,
  parseOnboarding,
  shouldOpenOnboarding,
} from '../src/state/onboarding';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { parseRequest } from '../src/messaging/protocol';

test('only fresh installations automatically present unfinished setup', () => {
  const initial = parseOnboarding(undefined);
  expect(shouldOpenOnboarding('install', initial)).toBe(true);
  for (const reason of ['update', 'chrome_update', 'shared_module_update'])
    expect(shouldOpenOnboarding(reason, initial)).toBe(false);
  expect(shouldOpenOnboarding('install', { ...initial, presented: true })).toBe(
    false,
  );
  expect(shouldOpenOnboarding('install', { ...initial, completed: true })).toBe(
    false,
  );
});
test('setup preserves existing global, provider and threshold preferences', () => {
  const existing = {
    ...DEFAULT_SETTINGS,
    enabled: false,
    onDevice: true,
    blockerThreshold: 0.95,
  };
  const next = applyChoices(existing, {
    mode: 'only',
    sites: { ...existing.sites, x: false },
  });
  expect(next).toMatchObject({
    mode: 'only',
    enabled: false,
    onDevice: true,
    blockerThreshold: 0.95,
  });
  expect(next.sites.x).toBe(false);
  expect(existing.sites.x).toBe(true);
});
test('setup messages reject malformed choices, missing sites and provider mutations', () => {
  expect(
    parseRequest({
      type: 'ONBOARDING_COMPLETE',
      choices: { mode: 'goggles', sites: { reddit: true } },
    }),
  ).toBeNull();
  expect(
    parseRequest({
      type: 'ONBOARDING_COMPLETE',
      choices: {
        mode: 'goggles',
        sites: DEFAULT_SETTINGS.sites,
        onDevice: true,
      },
    }),
  ).toBeNull();
  expect(parseRequest({ type: 'ONBOARDING_COMPLETE' })).not.toBeNull();
});
