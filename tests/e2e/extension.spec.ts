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
  await options.getByRole('button', { name: 'Clear score cache' }).click();
  await expect(options.getByRole('status')).toContainText('Cache cleared');
});
