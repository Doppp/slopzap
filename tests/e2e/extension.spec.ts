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
  aggregate: { analysed: number };
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
    aggregate: { analysed: number };
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
