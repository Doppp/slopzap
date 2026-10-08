import { afterEach, expect, test, vi } from 'vitest';
import { fixtureSnapshot } from '../scripts/benchmark-snapshot.mjs';
afterEach(() => vi.unstubAllGlobals());
test('snapshot targets the harness-created tab without active-tab or URL queries', async () => {
  const query = vi.fn();
  const sendMessage = vi.fn(async () => ({ stats: { bound: 3 } }));
  vi.stubGlobal('chrome', { tabs: { query, sendMessage } });
  expect(await fixtureSnapshot(17)).toEqual({ stats: { bound: 3 } });
  expect(query).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledWith(17, { type: 'SNAPSHOT' });
});
test.each([{ tabId: undefined }, { tabId: -1 }, { tabId: '17' }])(
  'invalid fixture identity returns null without messaging %#',
  async ({ tabId }) => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    expect(await fixtureSnapshot(tabId)).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  },
);
test('warming or closed fixture listener is unavailable, not a zero-valued snapshot', async () => {
  vi.stubGlobal('chrome', {
    tabs: {
      sendMessage: async () => {
        throw new Error('invented private detail');
      },
    },
  });
  expect(await fixtureSnapshot(17)).toBeNull();
});
