import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { resolve, join } from 'node:path';
const long = process.argv.includes('--long');
const seconds = Number(
  process.argv
    .find((value) => value.startsWith('--duration='))
    ?.split('=')[1] ?? (long ? 1800 : 5),
);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600)
  throw new Error('Duration must be 1–3600 seconds');
const reportRoot = resolve('.output/benchmarks');
await mkdir(reportRoot, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const scenarios = long
  ? [{ enabled: true, throttle: 1, units: 1000 }]
  : [1, 4].flatMap((throttle) =>
      [100, 500, 1000].flatMap((units) =>
        [false, true].map((enabled) => ({ enabled, throttle, units })),
      ),
    );
const results = [];
for (const scenario of scenarios) {
  const profile = await mkdtemp(join(tmpdir(), 'slopzap-benchmark-'));
  let context;
  try {
    const extension = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1200, height: 800 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--mute-audio',
      ],
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const controller = await context.newPage();
    await controller.goto(
      `chrome-extension://${new URL(worker.url()).host}/options.html`,
    );
    await worker.evaluate(async (enabled) => {
      await chrome.storage.local.set({
        settings: {
          enabled,
          debug: true,
          onDevice: false,
          mode: 'goggles',
          blockerThreshold: 0.85,
          onlyThreshold: 0.7,
          sites: {
            reddit: true,
            youtube: true,
            linkedin: true,
            x: true,
            medium: true,
          },
        },
      });
    }, scenario.enabled);
    const page = await context.newPage();
    await page.route('https://www.reddit.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Invented benchmark fixture</title><style>shreddit-comment{display:block;min-height:90px;border-bottom:1px solid #ccc}body{font:16px system-ui;margin:16px}</style><main><h1>Invented benchmark</h1>${Array.from({ length: scenario.units }, (_, index) => `<shreddit-comment thingid="benchmark-${index}"><div slot="comment">We tested this invented configuration yesterday. The cache latency was ${index + 12} milliseconds because the dataset fits in memory.</div></shreddit-comment>`).join('')}</main></html>`,
      }),
    );
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', {
      rate: scenario.throttle,
    });
    await context.tracing.start({
      screenshots: false,
      snapshots: false,
      sources: false,
    });
    await page.goto(
      'https://www.reddit.com/r/slopzap/comments/benchmark/invented/',
    );
    await page.bringToFront();
    await page.evaluate(() => {
      globalThis.benchmark = {
        frames: [],
        longTasks: 0,
        longestTask: 0,
        last: performance.now(),
        running: true,
      };
      const data = globalThis.benchmark;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          data.longTasks++;
          data.longestTask = Math.max(data.longestTask, entry.duration);
        }
      }).observe({ type: 'longtask', buffered: false });
      const frame = (now) => {
        if (!data.running) return;
        data.frames.push(now - data.last);
        if (data.frames.length > 1200) data.frames.shift();
        data.last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const snapshot = () =>
      controller.evaluate(async () => {
        for (const tab of await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        }))
          if (tab.id) {
            try {
              return await chrome.tabs.sendMessage(tab.id, {
                type: 'SNAPSHOT',
              });
            } catch {
              /* tab warming */
            }
          }
        return null;
      });
    await page.waitForTimeout(500);
    const initial = await snapshot();
    const samples = [];
    const started = Date.now();
    let nextSample = 0,
      round = 0;
    while ((Date.now() - started) / 1000 < seconds) {
      await page.evaluate((iteration) => {
        const max = document.documentElement.scrollHeight - innerHeight;
        window.scrollTo(0, max ? (iteration * 400) % max : 0);
        if (iteration % 20 === 0) {
          // Recycle a fixed number of invented elements; no ever-growing fixture DOM.
          for (const node of Array.from(
            document.querySelectorAll('shreddit-comment'),
          ).slice(0, 10)) {
            node.setAttribute(
              'thingid',
              `recycled-${iteration}-${node.getAttribute('thingid').split('-').at(-1)}`,
            );
            node.querySelector('[slot="comment"]').textContent =
              `My team tested invented revision ${iteration} yesterday and measured the latency at forty milliseconds because the cache was warm.`;
          }
        }
      }, round++);
      const elapsed = (Date.now() - started) / 1000;
      if (elapsed >= nextSample) {
        await cdp.send('HeapProfiler.collectGarbage');
        const metrics = (await cdp.send('Performance.getMetrics')).metrics;
        const dom = await cdp.send('Memory.getDOMCounters');
        const state = await snapshot();
        samples.push({
          elapsedSeconds: Math.round(elapsed),
          heapBytes:
            metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ??
            null,
          domNodes: dom.nodes,
          bound: state?.stats?.bound ?? 0,
          candidates: state?.stats?.candidates ?? 0,
        });
        nextSample += long ? 60 : 2;
      }
      await page.waitForTimeout(250);
    }
    const final = await snapshot();
    const frame = await page.evaluate(() => {
      const data = globalThis.benchmark;
      data.running = false;
      const sorted = [...data.frames].sort((a, b) => a - b);
      return {
        samples: sorted.length,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
        over33msRatio: sorted.length
          ? sorted.filter((value) => value > 33).length / sorted.length
          : null,
        longTasks: data.longTasks,
        longestTaskMs: data.longestTask,
      };
    });
    await page.evaluate(() => document.querySelector('main').replaceChildren());
    await page.waitForTimeout(300);
    const cleaned = await snapshot();
    await cdp.send('HeapProfiler.collectGarbage');
    const tracePath = join(reportRoot, `${stamp}-${results.length}.zip`);
    await context.tracing.stop({ path: tracePath });
    const atTenMinutes = samples.find((sample) => sample.elapsedSeconds >= 600);
    const last = samples.at(-1);
    const plateauRatio =
      atTenMinutes?.heapBytes && last?.heapBytes
        ? last.heapBytes / atTenMinutes.heapBytes
        : null;
    const checks = {
      boundedCandidates: samples.every((sample) => sample.candidates <= 1000),
      cleanupBindings: (cleaned?.stats?.bound ?? 0) === 0,
      cleanupCandidates: (cleaned?.stats?.candidates ?? 0) === 0,
      viewportDriven:
        !scenario.enabled ||
        (initial?.stats?.classifications ?? scenario.units) < 40,
      noClassificationWhenDisabled:
        scenario.enabled || (final?.stats?.classifications ?? 0) === 0,
      noHealthTrip: !final?.health?.code,
    };
    const result = {
      ...scenario,
      control: 'same extension installed; enabled setting toggled',
      durationSeconds: (Date.now() - started) / 1000,
      initial: initial?.stats ?? null,
      final: final?.stats ?? null,
      timings: final?.timings ?? {},
      frames: frame,
      samples,
      plateauRatio,
      checks,
      trace: tracePath.split('/').at(-1),
      referenceHardwareAcceptance: false,
      note: 'Local diagnostic run, not a dedicated reference-machine acceptance. DOM counters include browser nodes; zero bindings is not proof of zero retained detached DOM nodes.',
    };
    results.push(result);
    console.log(
      JSON.stringify({ scenario, checks, frames: frame, plateauRatio }),
    );
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}
const path = join(reportRoot, `${stamp}.json`);
await writeFile(
  path,
  JSON.stringify(
    {
      schemaVersion: 1,
      environment: { os: platform(), arch: arch(), cpuCount: cpus().length },
      generatedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Benchmark report: ${path}`);
if (
  results.some((result) => Object.values(result.checks).some((value) => !value))
)
  process.exitCode = 1;
