import { chromium, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  observationOutcome,
  projectDom,
  projectSnapshot,
} from './live-smoke-summary';

// Public, signed-out checks only. No console, trace, screenshot, text or HTML
// collection from live pages. Never force eligibility or bypass access controls.
if (process.argv.slice(2).some((argument) => argument !== '--headless')) {
  console.error('Usage: pnpm live:smoke [--headless]');
  process.exit(1);
}
const headless = process.argv.includes('--headless');
const profile = await mkdtemp(join(tmpdir(), 'slopzap-public-smoke-'));
let context:
  Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
let stage = 'launch';
async function snapshot(control: Page) {
  // Content-script match permissions do not expose tab URL metadata. The test
  // page is brought to front in this isolated window; never request tabs access.
  const pending = control.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          tabs: {
            query(options: object): Promise<{ id?: number }[]>;
            sendMessage(id: number, message: object): Promise<unknown>;
          };
        };
      }
    ).chrome;
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    if (tabs.length !== 1 || !tabs[0]?.id) return null;
    try {
      return await api.tabs.sendMessage(tabs[0].id, { type: 'SNAPSHOT' });
    } catch {
      return null;
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 3000);
      }),
    ]);
    return projectSnapshot(value);
  } finally {
    clearTimeout(timer);
  }
}

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless,
    ignoreDefaultArgs: true,
    args: [
      `--user-data-dir=${profile}`,
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      ...(headless ? ['--headless=new'] : []),
      'about:blank',
    ],
    timeout: 15000,
  });
  stage = 'installation';
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { id } = (await cdp.send('Extensions.loadUnpacked', {
    path: resolve('.output/chrome-mv3'),
  })) as { id: string };
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  const settings = await control.evaluate(() =>
    (
      globalThis as unknown as {
        chrome: {
          runtime: {
            sendMessage(
              input: object,
            ): Promise<{ onDevice: boolean; debug: boolean }>;
          };
        };
      }
    ).chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }),
  );
  if (settings.onDevice !== false || settings.debug !== false) {
    stage = 'unexpected_preferences';
    throw new Error();
  }

  // Separate invented control: proves injection/message/local-analysis plumbing,
  // not live compatibility. This exact route is fulfilled locally, never fetched.
  stage = 'fixture_control';
  const fixtureUrl =
    'https://www.reddit.com/r/slopzap_invented_control/comments/fixture/thread/';
  const fixture = await readFile('fixtures/reddit/thread.html', 'utf8');
  await context.route(fixtureUrl, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  const fixturePage = await context.newPage();
  await fixturePage.goto(fixtureUrl);
  await fixturePage.bringToFront();
  let fixtureSnapshot: ReturnType<typeof projectSnapshot> = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    fixtureSnapshot = await snapshot(control);
    if (fixtureSnapshot?.stats.classifications) break;
    await fixturePage.waitForTimeout(250);
  }
  if (
    !fixtureSnapshot?.supported ||
    fixtureSnapshot.platform !== 'reddit' ||
    !fixtureSnapshot.stats.bound ||
    !fixtureSnapshot.stats.classifications ||
    fixtureSnapshot.health.code
  )
    throw new Error();
  console.log(
    JSON.stringify({
      stage: 'fixture_control',
      chromeVersion: context.browser()!.version(),
      scope:
        'isolated installed Chrome; invented control is not live acceptance',
      headless,
      onDevice: false,
      debug: false,
      extensionInjectionVerified: true,
      normalUserProfileAccessed: false,
      runtime: fixtureSnapshot,
    }),
  );
  await fixturePage.close();
  await context.unroute(fixtureUrl);

  stage = 'public_observation';
  for (const [site, url, selector] of [
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
  ] as const) {
    const page = await context.newPage();
    let status: number | null = null;
    let navigationFailed = false;
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      status = response?.status() ?? null;
      await page.bringToFront();
      if (site === 'youtube')
        await page.evaluate(() => window.scrollTo(0, 1000));
      await page.waitForTimeout(8000);
    } catch {
      navigationFailed = true;
    }
    const domValue = await page
      .evaluate(
        (selector) => ({
          domCandidates: document.querySelectorAll(selector).length,
          annotations: document.querySelectorAll('[data-slopzap-ui]').length,
          authRoute: /login|signin|sign-in|authwall|challenge|checkpoint/i.test(
            location.pathname,
          ),
          challengeFramePresent: !!document.querySelector(
            'iframe[src*=captcha],iframe[src*=challenge],[id*=captcha]',
          ),
        }),
        selector,
      )
      .catch(() => null);
    const projectedDom = projectDom(domValue);
    const dom = projectedDom ?? {
      domCandidates: 0,
      annotations: 0,
      authRoute: false,
      challengeFramePresent: false,
    };
    let runtime = await snapshot(control).catch(() => null);
    if (runtime?.supported && runtime.platform !== site) runtime = null;
    console.log(
      JSON.stringify({
        site,
        status,
        outcome: observationOutcome({
          navigationFailed,
          domSnapshotAvailable: projectedDom !== null,
          status,
          ...dom,
          runtime,
        }),
        ...dom,
        domSnapshotAvailable: projectedDom !== null,
        runtime,
        liveAcceptance: false,
      }),
    );
    await page.close();
  }
} catch {
  console.log(JSON.stringify({ stage, outcome: 'probe_failed' }));
  process.exitCode = 1;
} finally {
  try {
    await context?.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
    console.log(
      JSON.stringify({ stage: 'cleanup', isolatedProfileRemoved: true }),
    );
  }
}
