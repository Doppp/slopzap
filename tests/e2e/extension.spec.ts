import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { AdapterHealthSnapshot } from '../../src/content/adapter-health';

let context: BrowserContext, page: Page, extensionId: string, profile: string;
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'slopzap-e2e-'));
  const extension = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  await expect
    .poll(() =>
      context
        .pages()
        .some(
          (tab) =>
            tab.url() === `chrome-extension://${extensionId}/onboarding.html`,
        ),
    )
    .toBe(true);
  const html = await readFile('fixtures/reddit/thread.html', 'utf8');
  await context.route('https://www.reddit.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  page = await context.newPage();
  page.on('pageerror', (error) => console.log('page error:', error.message));
  page.on('console', (event) => {
    if (['error', 'warning'].includes(event.type()))
      console.log('browser diagnostic:', event.text());
  });
  await page.goto('https://www.reddit.com/r/slopzap/comments/invented/thread/');
});
test.afterEach(async () => {
  await context.close();
  await rm(profile, { recursive: true, force: true });
});
async function mode(value: string) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: value, exact: true }).click();
  await expect(
    options.getByRole('button', { name: value, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await options.close();
}
async function snapshot(): Promise<{
  stats: { classifications: number; candidates: number; bound: number };
  aggregate: { analysed: number; corrected: number };
  health: AdapterHealthSnapshot;
}> {
  return context.serviceWorkers()[0]!.evaluate(async () => {
    const chrome = (
      globalThis as unknown as {
        chrome: {
          tabs: {
            query(options: object): Promise<{ id?: number }[]>;
            sendMessage(id: number, message: object): Promise<unknown>;
          };
        };
      }
    ).chrome;
    for (const tab of await chrome.tabs.query({}))
      if (tab.id) {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, {
            type: 'SNAPSHOT',
          });
          if (
            result &&
            typeof result === 'object' &&
            'supported' in result &&
            result.supported
          )
            return result;
        } catch {
          /* tabs without SlopZap */
        }
      }
    throw new Error('No active SlopZap route');
  }) as unknown as Promise<{
    stats: { classifications: number; candidates: number; bound: number };
    aggregate: { analysed: number; corrected: number };
    health: AdapterHealthSnapshot;
  }>;
}
test('classifies separate replies, preserves context, reveals and restores', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  await expect(page.locator('form [data-slopzap-ui]')).toHaveCount(0);
  const reply = page.locator('shreddit-comment[thingid="reply-1"]');
  await reply
    .getByRole('button', { name: 'SlopZap: Slop', exact: true })
    .click();
  await mode('Slop Blocker');
  await expect(reply.locator('[slot="comment"]')).toBeHidden();
  await reply
    .getByRole('button', { name: 'SlopZap: Show', exact: true })
    .click();
  await expect(reply.locator('[slot="comment"]')).toBeVisible();
  await mode('Slop Only');
  await expect(
    page
      .locator('shreddit-comment[thingid="comment-1"] > [data-slopzap-ui]')
      .first(),
  ).toContainText('Parent context');
  await mode('Normal');
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(0);
  await expect(reply.locator('[slot="comment"]')).toBeVisible();
});
test('dynamic insertions, removals and SPA navigation do not retain stale UI', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  await page.evaluate(() => {
    const comment = document.createElement('shreddit-comment');
    comment.setAttribute('thingid', 'dynamic');
    comment.innerHTML =
      '<div slot="comment">I measured the cache hit rate at eighty percent in our test yesterday.</div>';
    document.querySelector('main')!.append(comment);
  });
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(4);
  await page
    .locator('shreddit-comment[thingid="dynamic"]')
    .evaluate((node) => node.remove());
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  await page.evaluate(() => history.pushState({}, '', '/messages/inbox'));
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(0);
});

for (const scenario of [
  {
    platform: 'youtube',
    url: 'https://www.youtube.com/watch?v=invented',
    count: 2,
  },
  { platform: 'linkedin', url: 'https://www.linkedin.com/feed/', count: 3 },
  { platform: 'x', url: 'https://x.com/home', count: 2 },
  { platform: 'medium', url: 'https://medium.com/invented/story', count: 2 },
])
  test(`${scenario.platform} extracts independent authored units and excludes composers`, async () => {
    const html = await readFile(
      `fixtures/${scenario.platform}/thread.html`,
      'utf8',
    );
    await context.route(`${new URL(scenario.url).origin}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: html }),
    );
    await page.goto(scenario.url);
    await expect(page.locator('[data-slopzap-ui]')).toHaveCount(scenario.count);
    await expect(page.locator('form [data-slopzap-ui]')).toHaveCount(0);
    if (scenario.platform === 'x')
      await expect(
        page.locator('[data-testid="quoteTweet"] [data-slopzap-ui]'),
      ).toHaveCount(0);
    if (['linkedin', 'x'].includes(scenario.platform)) {
      const before = (await snapshot()).stats.candidates;
      await page.evaluate((platform) => {
        const privatePanel = document.createElement('section');
        if (platform === 'x') {
          privatePanel.dataset.testid = 'DMDrawer';
          privatePanel.innerHTML =
            '<article data-testid="tweet"><div data-testid="tweetText">A private message with plenty of text must never be classified.</div></article>';
        } else {
          privatePanel.className = 'msg-overlay-container';
          privatePanel.innerHTML =
            '<div class="comments-comment-item"><div class="comments-comment-item__main-content">A private message with plenty of text must never be classified.</div></div>';
        }
        document.querySelector('main')!.append(privatePanel);
      }, scenario.platform);
      await page.waitForTimeout(100);
      expect((await snapshot()).stats.candidates).toBe(before);
      await expect(
        page.locator(
          '[data-testid="DMDrawer"] [data-slopzap-ui],.msg-overlay-container [data-slopzap-ui]',
        ),
      ).toHaveCount(0);
    }
  });

for (const scenario of [
  {
    platform: 'youtube',
    url: 'https://www.youtube.com/watch?v=invented',
    root: 'ytd-comments',
    unit: 'ytd-comment-view-model[data-comment-id="top"]',
    body: '#content-text',
    count: 2,
  },
  {
    platform: 'linkedin',
    url: 'https://www.linkedin.com/feed/',
    root: 'main',
    unit: '.comments-comment-item[data-id="reply"]',
    body: '.comments-comment-item__main-content',
    count: 3,
  },
  {
    platform: 'x',
    url: 'https://x.com/home',
    root: 'main',
    unit: 'article[data-tweet-id="reply"]',
    body: '[data-testid="tweetText"]',
    count: 2,
  },
  {
    platform: 'medium',
    url: 'https://medium.com/invented/story',
    root: 'main',
    unit: '[data-post-id="response"]',
    body: '[data-testid="responseContent"]',
    count: 2,
  },
])
  test(`${scenario.platform} handles expansion insertion edits recycling removal and private navigation`, async () => {
    const html = await readFile(
      `fixtures/${scenario.platform}/thread.html`,
      'utf8',
    );
    await context.route(`${new URL(scenario.url).origin}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: html }),
    );
    await page.goto(scenario.url);
    await expect(page.locator('[data-slopzap-ui]')).toHaveCount(scenario.count);
    await page.evaluate(({ root, unit, body }) => {
      const clone = document
        .querySelector(unit)!
        .cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll('[data-slopzap-ui]')
        .forEach((node) => node.remove());
      clone.dataset.recycledFixture = 'true';
      for (const attribute of [
        'data-id',
        'data-urn',
        'data-comment-id',
        'data-tweet-id',
        'data-post-id',
      ])
        if (clone.hasAttribute(attribute))
          clone.setAttribute(attribute, 'invented-dynamic');
      clone.querySelector(body)!.textContent =
        'My team tested this invented configuration yesterday and measured a latency improvement because the cache was warm.';
      document.querySelector(root)!.append(clone);
    }, scenario);
    await expect(page.locator('[data-slopzap-ui]')).toHaveCount(
      scenario.count + 1,
    );
    const clone = page.locator('[data-recycled-fixture]');
    await clone
      .getByRole('button', { name: 'SlopZap: Slop', exact: true })
      .click();
    await mode('Slop Blocker');
    await expect(clone.locator(scenario.body)).toBeHidden();
    await clone
      .locator(scenario.body)
      .evaluate(
        (node) =>
          (node.textContent =
            'I tested the revised invented configuration today because the earlier measurement used a cold cache and was not representative.'),
      );
    await expect(clone.locator(scenario.body)).toBeVisible();
    await clone
      .getByRole('button', { name: 'SlopZap: Slop', exact: true })
      .click();
    await expect(clone.locator(scenario.body)).toBeHidden();
    await clone.evaluate((node) => {
      for (const attribute of [
        'data-id',
        'data-urn',
        'data-comment-id',
        'data-tweet-id',
        'data-post-id',
      ])
        if (node.hasAttribute(attribute))
          node.setAttribute(attribute, 'invented-recycled');
    });
    await expect(clone.locator(scenario.body)).toBeVisible();
    await expect(
      clone.getByRole('button', { name: 'SlopZap: Slop', exact: true }),
    ).toBeVisible();
    await clone.evaluate((node) => node.remove());
    await expect(page.locator('[data-slopzap-ui]')).toHaveCount(scenario.count);
    await page.evaluate(() => history.pushState({}, '', '/messages/inbox'));
    await expect(page.locator('[data-slopzap-ui]')).toHaveCount(0);
  });

test('deep Reddit branches preserve all ancestor context and release removed bindings', async () => {
  await page.evaluate(() => {
    let parent: Element = document.querySelector('main')!;
    for (let index = 0; index < 30; index++) {
      const comment = document.createElement('shreddit-comment');
      comment.setAttribute('thingid', `deep-${index}`);
      const body = document.createElement('div');
      body.slot = 'comment';
      body.textContent = `I measured this invented configuration yesterday because the cache was warm. Measurement number ${index}.`;
      comment.append(body);
      parent.append(comment);
      parent = comment;
    }
  });
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(33);
  const leaf = page.locator('shreddit-comment[thingid="deep-29"]');
  await leaf
    .getByRole('button', { name: 'SlopZap: Slop', exact: true })
    .click();
  await mode('Slop Only');
  await expect(
    page.locator('shreddit-comment[thingid="deep-0"] > [data-slopzap-ui]'),
  ).toContainText('Parent context');
  await expect(leaf.locator('[slot="comment"]')).toBeVisible();
  await page
    .locator('shreddit-comment[thingid="deep-0"]')
    .evaluate((node) => node.remove());
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  await expect.poll(async () => (await snapshot()).stats.bound).toBe(3);
});

test('edited text invalidates the exact-item correction', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  const reply = page.locator('shreddit-comment[thingid="reply-1"]');
  await reply
    .getByRole('button', { name: 'SlopZap: Slop', exact: true })
    .click();
  await mode('Slop Blocker');
  await expect(reply.locator('[slot="comment"]')).toBeHidden();
  await reply.locator('[slot="comment"]').evaluate((node) => {
    node.textContent =
      'I tested the cache configuration yesterday and measured a concrete improvement from forty seconds to twenty seconds.';
  });
  await expect(reply.locator('[slot="comment"]')).toBeVisible();
});

test('a thousand loaded comments do not trigger eager inference', async () => {
  await page.evaluate(() => {
    const main = document.querySelector('main')!;
    main.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 1000; index++) {
      const comment = document.createElement('shreddit-comment');
      comment.setAttribute('thingid', `item-${index}`);
      comment.style.display = 'block';
      comment.style.minHeight = '140px';
      const body = document.createElement('div');
      body.setAttribute('slot', 'comment');
      body.textContent = `I tested this configuration yesterday and measured ${index} milliseconds of latency in the build.`;
      comment.append(body);
      fragment.append(comment);
    }
    main.append(fragment);
  });
  await expect
    .poll(() => page.locator('[data-slopzap-ui]').count())
    .toBeGreaterThan(3);
  expect(await page.locator('[data-slopzap-ui]').count()).toBeLessThan(40);
  await page
    .locator('shreddit-comment[thingid="item-500"]')
    .scrollIntoViewIfNeeded();
  await expect(
    page.locator('shreddit-comment[thingid="item-500"] [data-slopzap-ui]'),
  ).toHaveCount(1);
});

test('settings controls are accessible and local-only behavior needs no provider', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(
    options.getByRole('button', { name: 'Slop Goggles', exact: true }),
  ).toBeEnabled();
  const result = await new AxeBuilder({ page: options }).analyze();
  expect(result.violations).toEqual([]);
  await options.screenshot({
    path: 'test-results/options.png',
    fullPage: true,
  });
  await options.getByRole('button', { name: 'Clear score cache' }).click();
  await expect(options.getByRole('status')).toContainText('Cache cleared');
});

test('local diagnostic export contains only whitelisted counts, preferences and timings', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options
    .getByRole('checkbox', { name: 'Record timing diagnostics' })
    .check();
  const downloaded = options.waitForEvent('download');
  await options
    .getByRole('button', { name: 'Export local diagnostics' })
    .click();
  const artifact = await downloaded;
  const text = await readFile((await artifact.path())!, 'utf8');
  expect(text).not.toContain('How should we measure');
  expect(text).not.toContain('Absolutely');
  expect(text).not.toContain('https://');
  expect(text).not.toContain('fingerprint');
  const report = JSON.parse(text);
  expect(report.pages).toHaveLength(1);
  expect(report.pages[0]).toMatchObject({
    platform: 'reddit',
    settings: { debug: true },
    stats: { bound: 3 },
  });
});

test('storage failure leaves settings inert and does not report false clearing success', async () => {
  const options = await context.newPage();
  await options.addInitScript(() => {
    const api = (
      globalThis as unknown as {
        chrome: {
          runtime: { sendMessage(input: { type: string }): Promise<unknown> };
        };
      }
    ).chrome;
    const send = api.runtime.sendMessage.bind(api.runtime);
    api.runtime.sendMessage = (input) =>
      ['SETTINGS_GET', 'SETTINGS_SET', 'CACHE_CLEAR'].includes(input.type)
        ? Promise.resolve({ error: 'storage_unavailable' })
        : send(input);
  });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole('status')).toContainText(
    'Settings are unavailable',
  );
  await expect(
    options.getByRole('button', { name: 'Normal', exact: true }),
  ).toBeDisabled();
  await expect(options.getByRole('slider').first()).toBeDisabled();
  await options.getByRole('button', { name: 'Clear score cache' }).click();
  await expect(options.getByRole('status')).toContainText(
    'Could not clear storage',
  );
});

test('model preparation shows progress and can be cancelled without enabling a provider', async () => {
  const options = await context.newPage();
  await options.addInitScript(() => {
    Object.defineProperty(globalThis, 'LanguageModel', {
      value: {
        availability: async () => 'downloadable',
        create: (input: {
          signal: AbortSignal;
          monitor(monitor: EventTarget): void;
        }) =>
          new Promise((_, reject) => {
            const monitor = new EventTarget();
            input.monitor(monitor);
            setTimeout(
              () =>
                monitor.dispatchEvent(
                  Object.assign(new Event('downloadprogress'), { loaded: 0.5 }),
                ),
              10,
            );
            input.signal.addEventListener(
              'abort',
              () => reject(new DOMException('Cancelled', 'AbortError')),
              { once: true },
            );
          }),
      },
    });
  });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options
    .getByRole('button', { name: 'Enable Chrome on-device AI' })
    .click();
  await expect(
    options.getByRole('progressbar', { name: 'Model download progress' }),
  ).toHaveAttribute('value', '0.5');
  await options.getByRole('button', { name: 'Cancel preparation' }).click();
  await expect(options.getByRole('status')).toContainText(
    'Preparation cancelled',
  );
  await expect(
    options.getByRole('button', { name: 'Enable Chrome on-device AI' }),
  ).toBeEnabled();
});

test('injected keyboard feedback retains focus; forced colors and enlarged UI stay accessible', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  const reply = page.locator('shreddit-comment[thingid="reply-1"]');
  await reply
    .getByRole('button', { name: 'SlopZap: Slop', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    reply.getByRole('button', { name: 'SlopZap: Slop', exact: true }),
  ).toBeFocused();
  await mode('Slop Blocker');
  const show = reply.getByRole('button', {
    name: 'SlopZap: Show',
    exact: true,
  });
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(
    reply.getByRole('button', { name: 'SlopZap: Hide', exact: true }),
  ).toBeFocused();
  await expect(reply.locator('[slot="comment"]')).toBeVisible();
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.emulateMedia({
    forcedColors: 'active',
    reducedMotion: 'reduce',
  });
  await options.evaluate(
    () => (document.documentElement.style.fontSize = '200%'),
  );
  expect(
    (await new AxeBuilder({ page: options }).analyze()).violations,
  ).toEqual([]);
  await options.screenshot({
    path: 'test-results/options-accessibility.png',
    fullPage: true,
  });
});

test('mode switches and a reload reuse cached scores without inference', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  const before = (await snapshot()).stats.classifications;
  for (const value of ['Slop Blocker', 'Slop Only', 'Normal', 'Slop Goggles'])
    await mode(value);
  expect((await snapshot()).stats.classifications).toBe(before);
  await page.reload();
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  expect((await snapshot()).stats.classifications).toBe(0);
});

test('synthetic feed supports contributors without live accounts', async () => {
  await page.goto(`chrome-extension://${extensionId}/harness.html`);
  await expect
    .poll(() => page.locator('[data-slopzap-ui]').count())
    .toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Add 100 comments' }).click();
  expect(await page.locator('[data-sz-unit]').count()).toBeGreaterThan(100);
  const stats = (await snapshot()).stats;
  expect(stats.classifications).toBeLessThan(40);
  await page.getByRole('button', { name: 'Remove feed', exact: true }).click();
  await expect.poll(async () => (await snapshot()).stats.bound).toBe(0);
});

test('mode changes preserve content collapsed by the host website', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  const body = page.locator(
    'shreddit-comment[thingid="reply-1"] [slot="comment"]',
  );
  await body.evaluate((node) => {
    (node as HTMLElement).hidden = true;
  });
  await mode('Normal');
  await expect(body).toBeHidden();
  await mode('Slop Goggles');
  await expect(body).toBeHidden();
});

test('host scripts cannot spoof local feedback clicks', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  const reply = page.locator('shreddit-comment[thingid="reply-1"]');
  await reply
    .getByRole('button', { name: 'SlopZap: Slop', exact: true })
    .evaluate((button) => (button as HTMLElement).click());
  await mode('Slop Blocker');
  await expect(reply.locator('[slot="comment"]')).toBeVisible();
});

test('filtering never hides an inline editor inside an authored body', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  const reply = page.locator('shreddit-comment[thingid="reply-1"]');
  await reply.locator('[slot="comment"]').evaluate((body) => {
    const form = document.createElement('form');
    const editor = document.createElement('textarea');
    editor.setAttribute('aria-label', 'Invented inline draft');
    editor.value = 'A private invented draft must remain visible and editable.';
    form.append(editor);
    body.append(form);
  });
  await reply
    .getByRole('button', { name: 'SlopZap: Slop', exact: true })
    .click();
  await mode('Slop Blocker');
  await expect(
    reply.getByRole('textbox', { name: 'Invented inline draft' }),
  ).toBeVisible();
  await expect(reply.locator('[slot="comment"]')).toBeVisible();
  await reply
    .getByRole('button', { name: 'SlopZap: Not slop', exact: true })
    .click();
  await mode('Slop Only');
  await expect(
    reply.getByRole('textbox', { name: 'Invented inline draft' }),
  ).toBeVisible();
});

test('unreliable parsing restores the page, stays paused and supports explicit retry', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  const reply = page.locator('shreddit-comment[thingid="reply-1"]');
  await reply
    .getByRole('button', { name: 'SlopZap: Slop', exact: true })
    .click();
  await mode('Slop Blocker');
  await expect(reply.locator('[slot="comment"]')).toBeHidden();
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 25; index++) {
      const malformed = document.createElement('shreddit-comment');
      malformed.dataset.brokenFixture = 'true';
      malformed.style.display = 'block';
      malformed.textContent =
        'Invented placeholder with no identifiable authored body.';
      fragment.append(malformed);
    }
    document.querySelector('main')!.append(fragment);
  });
  await expect
    .poll(async () => (await snapshot()).health.code)
    .toBe('adapter_parse_failures');
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(0);
  await expect(reply.locator('[slot="comment"]')).toBeVisible();
  expect((await snapshot()).stats).toMatchObject({ bound: 0, candidates: 0 });
  expect((await snapshot()).aggregate.analysed).toBe(0);
  const paused = (await snapshot()).health;
  await mode('Slop Only');
  await expect.poll(async () => (await snapshot()).health).toEqual(paused);
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  const enabled = settings.getByRole('checkbox', { name: 'SlopZap enabled' });
  await enabled.uncheck();
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await expect(enabled).toBeChecked();
  await settings.close();
  await expect.poll(async () => (await snapshot()).health).toEqual(paused);

  // Repairing markup or changing settings alone must not silently resume parsing.
  await page
    .locator('[data-broken-fixture]')
    .evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await mode('Normal');
  const popup = await context.newPage();
  await page.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    popup.getByRole('heading', { name: 'SlopZap paused on this page' }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page: popup }).analyze()).violations).toEqual(
    [],
  );
  await popup.screenshot({
    path: 'test-results/adapter-paused-popup.png',
    fullPage: true,
  });
  await popup.getByRole('button', { name: 'Retry page check' }).click();
  await expect.poll(async () => (await snapshot()).health.code).toBeNull();
  await expect.poll(async () => (await snapshot()).stats.bound).toBe(3);
  await popup.close();
  await mode('Slop Blocker');
  await expect(reply.locator('[slot="comment"]')).toBeHidden();
});

test('repeated edits to one malformed candidate do not inflate health counts', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  await page.evaluate(() => {
    const malformed = document.createElement('shreddit-comment');
    malformed.id = 'repeated-invalid';
    malformed.textContent = 'Invented placeholder without an authored body.';
    document.querySelector('main')!.prepend(malformed);
  });
  await expect.poll(async () => (await snapshot()).health.sampled).toBe(4);
  for (let index = 0; index < 22; index++) {
    await page.locator('#repeated-invalid').evaluate((node, value) => {
      const body = document.createElement('div');
      body.slot = 'comment';
      body.textContent = `I tested this invented revision ${value} and measured the cache latency at forty milliseconds.`;
      node.replaceChildren(body);
    }, index);
    await expect(page.locator('[data-slopzap-ui]')).toHaveCount(4);
    await page.locator('#repeated-invalid').evaluate((node) => {
      node.replaceChildren('Invented placeholder without an authored body.');
    });
    await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  }
  expect((await snapshot()).health).toMatchObject({
    code: null,
    sampled: 4,
    rejected: 1,
  });
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
});

test('ambiguous authored bodies are rejected and stale scores are removed', async () => {
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(3);
  await page
    .locator('shreddit-comment[thingid="reply-1"]')
    .getByRole('button', { name: 'SlopZap: Not slop', exact: true })
    .click();
  await expect.poll(async () => (await snapshot()).aggregate.corrected).toBe(1);
  await page.locator('shreddit-comment[thingid="reply-1"]').evaluate((node) => {
    const competingBody = document.createElement('div');
    competingBody.slot = 'comment';
    competingBody.textContent =
      'A second invented authored body cannot be safely attributed.';
    node.append(competingBody);
  });
  await expect(page.locator('[data-slopzap-ui]')).toHaveCount(2);
  await expect.poll(async () => (await snapshot()).aggregate.corrected).toBe(0);
  await expect.poll(async () => (await snapshot()).stats.bound).toBe(2);
  await expect(
    page.locator('shreddit-comment[thingid="reply-1"] [slot="comment"]'),
  ).toHaveCount(2);
  expect((await snapshot()).health.code).toBeNull();
  const parent = page.locator('shreddit-comment[thingid="comment-1"]');
  await parent.locator(':scope > [slot="comment"]').evaluate((body) => {
    const child = document.createElement('shreddit-comment');
    child.setAttribute('thingid', 'nested-authored-boundary');
    const text = document.createElement('div');
    text.slot = 'comment';
    text.textContent =
      'I tested this invented nested reply yesterday because the cache was warm.';
    child.append(text);
    body.append(child);
  });
  await expect(parent.locator(':scope > [data-slopzap-ui]')).toHaveCount(0);
  await expect(
    parent.locator(
      'shreddit-comment[thingid="nested-authored-boundary"] [slot="comment"]',
    ),
  ).toBeVisible();
});

test('parser exceptions pause immediately without exporting page or error text; navigation recovers', async () => {
  const harness = await context.newPage();
  await harness.goto(`chrome-extension://${extensionId}/harness.html`);
  await expect(harness.locator('[data-slopzap-ui]').first()).toBeVisible();
  // Extension-page fixtures share the runtime realm, allowing a deterministic parser fault.
  await harness.evaluate(() => {
    const malformed = document.createElement('article');
    malformed.dataset.szUnit = 'true';
    malformed.textContent = 'invented-private-content-marker';
    malformed.querySelectorAll = () => {
      throw new Error('invented-private-error-marker');
    };
    document.querySelector('[data-sz-feed]')!.prepend(malformed);
  });
  await page.close();
  await expect
    .poll(async () => (await snapshot()).health.code)
    .toBe('adapter_parse_exception');
  await expect(harness.locator('[data-slopzap-ui]')).toHaveCount(0);
  const diagnostic = JSON.stringify(await snapshot());
  expect(diagnostic).not.toContain('invented-private');
  expect(diagnostic).not.toContain('chrome-extension:');
  await harness.getByRole('button', { name: 'New thread' }).click();
  await expect.poll(async () => (await snapshot()).health.code).toBeNull();
  await expect(harness.locator('[data-slopzap-ui]').first()).toBeVisible();
});

test('fresh install opens one accessible setup and saves the chosen view and sites', async () => {
  const onboarding = context
    .pages()
    .find(
      (tab) =>
        tab.url() === `chrome-extension://${extensionId}/onboarding.html`,
    )!;
  await onboarding.bringToFront();
  await expect(onboarding.getByRole('heading', { level: 2 })).toHaveText(
    'A little less slop. A lot more signal.',
  );
  expect(
    context.pages().filter((tab) => tab.url().endsWith('/onboarding.html')),
  ).toHaveLength(1);
  for (const step of [0, 1, 2]) {
    expect(
      (await new AxeBuilder({ page: onboarding }).analyze()).violations,
    ).toEqual([]);
    await onboarding.screenshot({
      path: `test-results/onboarding-step-${step + 1}.png`,
      fullPage: true,
    });
    if (step === 0)
      await onboarding.getByRole('button', { name: 'Let’s set it up' }).click();
    if (step === 1) {
      await expect(
        onboarding.getByRole('radio', { name: /Slop Goggles/ }),
      ).toBeChecked();
      await onboarding.getByRole('radio', { name: /Slop Only/ }).check();
      await onboarding.getByRole('button', { name: 'Choose sites' }).click();
    }
  }
  await onboarding
    .getByRole('checkbox', { name: 'X / Twitter', exact: true })
    .uncheck();
  await onboarding
    .getByRole('checkbox', { name: 'LinkedIn', exact: true })
    .uncheck();
  await onboarding.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    onboarding.getByRole('radio', { name: /Slop Only/ }),
  ).toBeChecked();
  await onboarding.getByRole('button', { name: 'Choose sites' }).click();
  await expect(
    onboarding.getByRole('checkbox', { name: 'X / Twitter', exact: true }),
  ).not.toBeChecked();
  await onboarding.getByRole('button', { name: 'Save setup' }).click();
  await expect(onboarding.getByRole('heading', { level: 2 })).toHaveText(
    'You’re ready to zap.',
  );
  expect(
    (await new AxeBuilder({ page: onboarding }).analyze()).violations,
  ).toEqual([]);
  await onboarding.screenshot({
    path: 'test-results/onboarding-complete.png',
    fullPage: true,
  });
  await onboarding.getByRole('button', { name: 'Try the demo feed' }).click();
  await expect(onboarding).toHaveURL(
    `chrome-extension://${extensionId}/harness.html`,
  );
  const preferences = await context.serviceWorkers()[0]!.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          storage: {
            local: { get(keys: string[]): Promise<Record<string, unknown>> };
          };
        };
      }
    ).chrome;
    return api.storage.local.get(['settings', 'onboarding']);
  });
  expect(preferences.onboarding).toMatchObject({
    completed: true,
    presented: true,
  });
  expect(preferences.settings).toMatchObject({
    mode: 'only',
    onDevice: false,
    sites: { x: false, linkedin: false, youtube: true },
  });
  await onboarding.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    onboarding.getByRole('button', { name: 'Slop Only', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    onboarding.getByRole('button', { name: 'Open quick setup', exact: true }),
  ).toHaveCount(0);
});

test('closing unfinished setup leaves a popup reminder; default completion preserves preferences', async () => {
  const onboarding = context
    .pages()
    .find((tab) => tab.url().endsWith('/onboarding.html'))!;
  await onboarding.close();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup
    .getByRole('button', { name: 'Open quick setup', exact: true })
    .click();
  await expect
    .poll(
      () =>
        context.pages().filter((tab) => tab.url().endsWith('/onboarding.html'))
          .length,
    )
    .toBe(1);
  const reopened = context
    .pages()
    .find((tab) => tab.url().endsWith('/onboarding.html'))!;
  await reopened.getByRole('button', { name: 'Use current defaults' }).click();
  await expect(reopened.getByRole('heading', { level: 2 })).toHaveText(
    'You’re ready to zap.',
  );
  await popup.reload();
  await expect(
    popup.getByRole('button', { name: 'Slop Goggles', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    popup.getByRole('button', { name: 'Open quick setup', exact: true }),
  ).toHaveCount(0);
  await reopened.reload();
  await expect(reopened.getByRole('heading', { level: 2 })).toHaveText(
    'Review your quick setup',
  );
});

test('completion survives browser restart without reopening setup or resetting preferences', async () => {
  const onboarding = context
    .pages()
    .find((tab) => tab.url().endsWith('/onboarding.html'))!;
  await onboarding
    .getByRole('button', { name: 'Use current defaults' })
    .click();
  await expect(onboarding.getByRole('heading', { level: 2 })).toHaveText(
    'You’re ready to zap.',
  );
  const apiResult = await context.serviceWorkers()[0]!.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          storage: {
            local: {
              get(key: string): Promise<{ settings: unknown }>;
              set(value: unknown): Promise<void>;
            };
          };
        };
      }
    ).chrome;
    const settings = (await api.storage.local.get('settings')).settings as {
      mode: string;
      sites: Record<string, boolean>;
      enabled: boolean;
      onDevice: boolean;
      blockerThreshold: number;
    };
    const customized = {
      ...settings,
      mode: 'normal',
      enabled: false,
      onDevice: true,
      blockerThreshold: 0.95,
      sites: { ...settings.sites, x: false },
    };
    await api.storage.local.set({ settings: customized });
    return customized;
  });
  await onboarding.close();
  await context.close();
  const extension = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const state = await worker.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          storage: {
            local: { get(keys: string[]): Promise<Record<string, unknown>> };
          };
        };
      }
    ).chrome;
    return api.storage.local.get(['settings', 'onboarding']);
  });
  expect(state.settings).toEqual(apiResult);
  expect(state.onboarding).toMatchObject({ completed: true });
  expect(
    context.pages().filter((tab) => tab.url().endsWith('/onboarding.html')),
  ).toHaveLength(0);
  const review = await context.newPage();
  await review.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await expect(review.getByRole('heading', { level: 2 })).toHaveText(
    'Review your quick setup',
  );
  await review.getByRole('button', { name: 'Use current defaults' }).click();
  await expect(review.getByRole('heading', { level: 2 })).toHaveText(
    'You’re ready to zap.',
  );
  await expect(review.getByText(/currently paused/)).toBeVisible();
});

test('setup supports keyboard navigation and opting out of every site at small widths', async () => {
  const onboarding = context
    .pages()
    .find((tab) => tab.url().endsWith('/onboarding.html'))!;
  await onboarding.setViewportSize({ width: 390, height: 844 });
  await onboarding.bringToFront();
  await onboarding.getByRole('button', { name: 'Let’s set it up' }).focus();
  await onboarding.keyboard.press('Enter');
  await expect(onboarding.getByRole('heading', { level: 2 })).toHaveText(
    'How do you want to browse?',
  );
  await onboarding.getByRole('radio', { name: /Slop Goggles/ }).focus();
  await expect(
    onboarding.getByRole('radio', { name: /Slop Goggles/ }),
  ).toBeFocused();
  await onboarding.keyboard.press('ArrowDown');
  await expect(
    onboarding.getByRole('radio', { name: /Slop Blocker/ }),
  ).toBeChecked();
  await onboarding.getByRole('button', { name: 'Choose sites' }).click();
  for (const checkbox of await onboarding.getByRole('checkbox').all())
    await checkbox.uncheck();
  await expect(onboarding.getByText(/All sites are off/)).toBeVisible();
  expect(
    (await new AxeBuilder({ page: onboarding }).analyze()).violations,
  ).toEqual([]);
  expect(
    await onboarding.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await onboarding.screenshot({
    path: 'test-results/onboarding-mobile.png',
    fullPage: true,
  });
  await onboarding.getByRole('button', { name: 'Save setup' }).click();
  await expect(onboarding.getByText('0 of 5', { exact: true })).toBeVisible();
  await onboarding
    .getByRole('button', { name: 'Start browsing', exact: true })
    .click();
  await expect.poll(() => onboarding.isClosed()).toBe(true);
});
