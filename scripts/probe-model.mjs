import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

// Disposable empty web context only. Never read the user's browser profile,
// call create(), load live pages, or override Chrome's eligibility checks.
const profile = await mkdtemp(join(tmpdir(), 'slopzap-model-probe-'));
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>SlopZap capability probe</title>');
});
let context;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: true,
    timeout: 15000,
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`, {
    timeout: 5000,
  });
  const result = await page.evaluate(async () => {
    const api = globalThis.LanguageModel;
    if (!api) return { apiPresent: false, availability: 'unavailable' };
    try {
      const value = await Promise.race([
        api.availability({
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        }),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
      ]);
      return {
        apiPresent: true,
        availability: [
          'available',
          'downloadable',
          'downloading',
          'unavailable',
          'timeout',
        ].includes(value)
          ? value
          : 'unknown',
      };
    } catch {
      return { apiPresent: true, availability: 'check_failed' };
    }
  });
  console.log(
    JSON.stringify({
      scope:
        'isolated headless empty loopback web page; not extension or hardware acceptance',
      chromeVersion: context.browser().version(),
      ...result,
      modelCreationRequested: false,
      downloadRequested: false,
    }),
  );
} catch {
  console.log(
    JSON.stringify({
      scope: 'isolated model capability probe',
      probeStatus: 'unavailable',
      modelCreationRequested: false,
      downloadRequested: false,
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    await context?.close();
  } finally {
    try {
      await new Promise((resolve) => server.close(resolve));
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}
