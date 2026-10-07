import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { parseRequest } from '../src/messaging/protocol';
import { parseSettings } from '../src/shared/types';
import * as cache from '../src/cache/db';
import { classify } from '../src/classifier/local';
import {
  applyChoices,
  parseOnboarding,
  shouldOpenOnboarding,
} from '../src/state/onboarding';

export default defineBackground(() => {
  void browser.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return;
    void (async () => {
      const state = parseOnboarding(
        (await browser.storage.local.get('onboarding')).onboarding,
      );
      if (!shouldOpenOnboarding(details.reason, state)) return;
      // Persist presentation before opening a tab; worker restart must not duplicate it.
      await browser.storage.local.set({
        onboarding: { ...state, presented: true },
      });
      await browser.tabs.create({
        url: browser.runtime.getURL('/onboarding.html'),
      });
    })().catch(() => {
      /* the popup still offers quick setup if a tab cannot open */
    });
  });
  const broadcast = async (settings: ReturnType<typeof parseSettings>) => {
    try {
      for (const tab of await browser.tabs.query({}))
        if (tab.id)
          void browser.tabs
            .sendMessage(tab.id, { type: 'SETTINGS_CHANGED', settings })
            .catch(() => {});
    } catch {
      /* persisted settings remain authoritative even if a tab disappears */
    }
  };
  browser.runtime.onMessage.addListener((value, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const request = parseRequest(value);
    if (!request) return false;
    // Settings mutations and destructive cache controls are trusted-page only.
    if (
      !sender.url?.startsWith(browser.runtime.getURL('/')) &&
      [
        'SETTINGS_SET',
        'CACHE_CLEAR',
        'ONBOARDING_GET',
        'ONBOARDING_COMPLETE',
      ].includes(request.type)
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
          await broadcast(settings);
          return settings;
        }
        case 'ONBOARDING_GET':
          return parseOnboarding(
            (await browser.storage.local.get('onboarding')).onboarding,
          );
        case 'ONBOARDING_COMPLETE': {
          const settings = parseSettings(
            (await browser.storage.local.get('settings')).settings,
          );
          const next = request.choices
            ? applyChoices(settings, request.choices)
            : settings;
          await browser.storage.local.set({
            settings: next,
            onboarding: { version: 1, presented: true, completed: true },
          });
          await broadcast(next);
          return { ok: true, settings: next };
        }
        case 'CACHE_GET':
          return cache.lookup(
            request.keys,
            typeof request.version === 'string'
              ? request.version.slice(0, 80)
              : undefined,
          );
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
