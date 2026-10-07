import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Public, signed-out smoke checks. No DOM text, credentials or HTML is recorded.
const profile = await mkdtemp(join(tmpdir(), 'slopzap-public-smoke-'));
const extension = resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--mute-audio',
  ],
});
try {
  for (const [site, url, selectors] of [
    [
      'reddit',
      'https://www.reddit.com/r/programming/',
      'shreddit-comment,shreddit-post',
    ],
    [
      'youtube',
      'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      'ytd-comment-view-model,ytd-comment-renderer',
    ],
    [
      'linkedin',
      'https://www.linkedin.com/feed/',
      '.feed-shared-update-v2,.comments-comment-item,.comments-comment-entity',
    ],
    ['x', 'https://x.com/home', 'article[data-testid="tweet"]'],
    ['medium', 'https://medium.com/', 'article,[data-testid="response"]'],
  ]) {
    const page = await context.newPage();
    let status = null,
      outcome = 'loaded';
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      status = response?.status() ?? null;
      if (site === 'youtube')
        await page.evaluate(() => window.scrollTo(0, 1000));
      await page.waitForTimeout(2000);
    } catch {
      outcome = 'navigation_unavailable';
    }
    const summary = await page
      .evaluate(
        (selector) => ({
          candidates: document.querySelectorAll(selector).length,
          annotations: document.querySelectorAll('[data-slopzap-ui]').length,
          authRoute: /login|signin|sign-in|authwall|challenge|checkpoint/i.test(
            location.pathname,
          ),
        }),
        selectors,
      )
      .catch(() => ({ candidates: 0, annotations: 0, authRoute: false }));
    console.log(JSON.stringify({ site, status, outcome, ...summary }));
    await page.close();
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
