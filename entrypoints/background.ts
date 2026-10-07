import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { parseRequest } from '../src/messaging/protocol';
import { parseSettings } from '../src/shared/types';
import * as cache from '../src/cache/db';
import { classify } from '../src/classifier/local';

export default defineBackground(() => {
  void browser.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  browser.runtime.onMessage.addListener((value, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const request = parseRequest(value);
    if (!request) return false;
    // Settings mutations and destructive cache controls are trusted-page only.
    if (
      !sender.url?.startsWith(browser.runtime.getURL('/')) &&
      ['SETTINGS_SET', 'CACHE_CLEAR'].includes(request.type)
    )
      return false;
    const handle = async () => {
      switch (request.type) {
        case 'CLASSIFY_LOCAL':
          return request.items.map((item) =>
            classify(item.unit, item.fingerprint),
          );
        case 'SETTINGS_GET':
          return parseSettings(
            (await browser.storage.local.get('settings')).settings,
          );
        case 'SETTINGS_SET': {
          const settings = parseSettings(request.settings);
          await browser.storage.local.set({ settings });
          for (const tab of await browser.tabs.query({}))
            if (tab.id)
              void browser.tabs
                .sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings })
                .catch(() => {});
          return settings;
        }
        case 'CACHE_GET':
          return cache.lookup(request.keys);
        case 'CACHE_SAVE':
          await cache.save(request.results);
          return { ok: true };
        case 'OVERRIDE':
          await cache.override(request.key, request.verdict);
          return { ok: true };
        case 'CACHE_CLEAR':
          await cache.clear(request.store);
          return { ok: true };
      }
    };
    void handle()
      .then(sendResponse)
      .catch(() => sendResponse({ error: 'storage_unavailable' }));
    return true;
  });
});
