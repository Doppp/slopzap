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
