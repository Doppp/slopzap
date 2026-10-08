import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { keyEvents, targetSession } from './cdp-target.mjs';

// Installed headed Chrome, real action popup, invented fixture only. No normal
// profile, live site, model preparation, trace or raw accessibility-tree export.
if (process.argv.length > 2) {
  console.error('Usage: pnpm toolbar:smoke');
  process.exit(1);
}
const profile = await mkdtemp(join(tmpdir(), 'slopzap-toolbar-smoke-'));
const output = resolve('.output/verification');
let context;
let stage = 'launch';

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    ignoreDefaultArgs: true,
    args: [
      `--user-data-dir=${profile}`,
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      'about:blank',
    ],
    timeout: 15000,
  });
  stage = 'installation';
  const browser = await context.browser().newBrowserCDPSession();
  const { id } = await browser.send('Extensions.loadUnpacked', {
    path: resolve('.output/chrome-mv3'),
  });
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  const settings = await control.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }),
  );
  if (settings?.onDevice !== false || settings?.debug !== false)
    throw new Error('Unexpected fresh-profile preferences');
  const fixtureUrl =
    'https://www.reddit.com/r/slopzap_toolbar_fixture/comments/invented/thread/';
  const fixture = await readFile('fixtures/reddit/thread.html', 'utf8');
  await context.route(fixtureUrl, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-slopzap-ui]').length === 3,
  );
  const classifications = () =>
    control.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return (await chrome.tabs.sendMessage(tab.id, { type: 'SNAPSHOT' }))
        ?.stats?.classifications;
    });
  const before = await classifications();
  const popupUrl = `chrome-extension://${id}/popup.html`;
  stage = 'open_popup';
  await control.evaluate(() => chrome.action.openPopup());
  const { targetInfos } = await browser.send('Target.getTargets');
  const popup = targetInfos.find((target) => target.url === popupUrl);
  if (!popup) throw new Error('Native popup unavailable');
  const session = targetSession(browser, popup.targetId);
  await session.connect();
  try {
    stage = 'popup_projection';
    await session.send('Runtime.enable');
    const evaluate = async (expression) => {
      const value = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (value.exceptionDetails) throw new Error('Popup evaluation failed');
      return value.result.value;
    };
    const dimensions = await evaluate(`({
      width: innerWidth, height: innerHeight,
      contentWidth: document.documentElement.scrollWidth,
      contentHeight: document.documentElement.scrollHeight,
      focused: document.hasFocus(),
      modesLoaded: document.querySelectorAll('.modes button').length === 4 && [...document.querySelectorAll('.modes button')].every(button => !button.disabled),
      activeDiscussion: document.querySelector('.eyebrow')?.textContent === 'reddit · Slopometer',
      liveMeter: !!document.querySelector('.meter[aria-live],.meter[role="status"],.meter[role="alert"]'),
    })`);
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    const buttons = nodes
      .filter((node) => node.role?.value === 'button')
      .map((node) => node.name?.value);
    const checks = {
      nativePopupOpened: popup.type === 'page',
      preferredWidth: dimensions.width === 350,
      noHorizontalOverflow: dimensions.contentWidth === dimensions.width,
      activeDiscussion: dimensions.activeDiscussion,
      modesLoaded: dimensions.modesLoaded,
      nonLiveMeter: !dimensions.liveMeter,
      modeNamesPresent: [
        'Normal',
        'Slop Goggles',
        'Slop Blocker',
        'Slop Only',
      ].every((name) => buttons.includes(name)),
      settingsNamed: buttons.includes('Settings & privacy'),
    };
    const press = async (key, code, windowsVirtualKeyCode) => {
      for (const event of keyEvents(key, code, windowsVirtualKeyCode))
        await session.send('Input.dispatchKeyEvent', event);
    };
    const focusButton = async (name) => {
      for (let count = 0; count < 16; count++) {
        if (
          await evaluate(
            `document.activeElement?.tagName === 'BUTTON' && document.activeElement?.textContent === ${JSON.stringify(name)}`,
          )
        )
          return true;
        await press('Tab', 'Tab', 9);
      }
      return false;
    };
    stage = 'keyboard_mode_switch';
    checks.keyboardModeReached = await focusButton('Slop Blocker');
    if (checks.keyboardModeReached) await press('Enter', 'Enter', 13);
    const selected = async () =>
      evaluate(`document.querySelector('.modes button.selected')?.textContent`);
    for (
      let attempt = 0;
      attempt < 20 && (await selected()) !== 'Slop Blocker';
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    checks.keyboardModeSaved =
      (await selected()) === 'Slop Blocker' &&
      (
        await control.evaluate(() =>
          chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }),
        )
      ).mode === 'blocker';
    checks.noInferenceOnModeSwitch =
      Number.isInteger(before) &&
      before > 0 &&
      (await classifications()) === before;
    const changedTree = await session.send('Accessibility.getFullAXTree');
    checks.selectedModeStateExposed = changedTree.nodes.some(
      (node) =>
        node.role?.value === 'button' &&
        node.name?.value === 'Slop Blocker' &&
        node.properties?.some(
          (property) =>
            property.name === 'pressed' &&
            (property.value?.value === true ||
              property.value?.value === 'true'),
        ),
    );
    checks.keyboardFooterReached = await focusButton('Settings & privacy');
    checks.footerScrolledIntoView = await evaluate(`(() => {
      const button = document.activeElement;
      const rect = button.getBoundingClientRect();
      return button.tagName === 'BUTTON' && rect.top >= 0 && rect.bottom <= innerHeight;
    })()`);
    checks.keyboardFocusVisible = await evaluate(`(() => {
      const button = document.activeElement, style = getComputedStyle(button);
      return button.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    })()`);
    await mkdir(output, { recursive: true });
    const screenshot = await session.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      join(output, 'native-toolbar-popup.png'),
      Buffer.from(screenshot.data, 'base64'),
    );
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      chromeVersion: context.browser().version(),
      scope:
        'isolated installed headed Chrome; real toolbar popup with invented active discussion',
      dimensions,
      checks,
      normalUserProfileAccessed: false,
      liveContentAccessed: false,
      modelPreparationRequested: false,
      manualScreenReaderAudit: false,
      releaseAcceptance: false,
    };
    await writeFile(
      join(output, 'native-toolbar-popup.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
    if (Object.values(checks).some((value) => value !== true))
      process.exitCode = 1;
  } finally {
    if (!(await session.close())) throw new Error('Target detach unavailable');
  }
} catch {
  console.log(
    JSON.stringify({
      stage,
      outcome: 'probe_failed',
      releaseAcceptance: false,
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    await context?.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
    console.log(
      JSON.stringify({
        isolatedProfileRemoved: true,
        normalUserProfileAccessed: false,
      }),
    );
  }
}
