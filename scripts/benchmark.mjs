import { chromium } from '@playwright/test';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readdir,
  readFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, cpus, platform, arch, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { benchmarkPlan } from './benchmark-plan.mjs';
const plan = benchmarkPlan(process.argv.slice(2));
const { long, seconds, scenarios } = plan;
const reportRoot = resolve('.output/benchmarks');
await mkdir(reportRoot, { recursive: true });
async function buildFingerprint() {
  const hash = createHash('sha256');
  let bytes = 0;
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      if (entry.isSymbolicLink())
        throw new Error('Unexpected packaged symlink');
      const path = join(directory, entry.name),
        label = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(path, `${label}/`);
      else {
        if (!entry.isFile()) throw new Error('Unexpected packaged resource');
        const file = await readFile(path);
        bytes += file.length;
        if (bytes > 500_000) throw new Error('Unexpected packaged size');
        hash.update(
          JSON.stringify([
            label,
            createHash('sha256').update(file).digest('hex'),
          ]) + '\n',
        );
      }
    }
  };
  await visit(resolve('.output/chrome-mv3'));
  return hash.digest('hex');
}
const packagedBuildSha256 = await buildFingerprint();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const results = [];
for (const scenario of scenarios) {
  if ((await buildFingerprint()) !== packagedBuildSha256)
    throw new Error('Packaged build changed during benchmark');
  const profile = await mkdtemp(join(tmpdir(), 'slopzap-benchmark-'));
  let context;
  try {
    const extension = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext(profile, {
      channel: plan.chrome ? 'chrome' : 'chromium',
      headless: !plan.chrome,
      ...(plan.chrome ? { ignoreDefaultArgs: true } : {}),
      viewport: { width: 1200, height: 800 },
      args: plan.chrome
        ? [
            `--user-data-dir=${profile}`,
            '--remote-debugging-pipe',
            '--enable-unsafe-extension-debugging',
            '--no-first-run',
            '--no-default-browser-check',
            '--mute-audio',
            'about:blank',
          ]
        : [
            `--disable-extensions-except=${extension}`,
            `--load-extension=${extension}`,
            '--mute-audio',
          ],
    });
    let extensionId;
    if (plan.chrome) {
      const browser = await context.browser().newBrowserCDPSession();
      ({ id: extensionId } = await browser.send('Extensions.loadUnpacked', {
        path: extension,
      }));
    } else {
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent('serviceworker'));
      extensionId = new URL(worker.url()).host;
    }
    const controller = await context.newPage();
    await controller.goto(`chrome-extension://${extensionId}/options.html`);
    await controller.evaluate(async (enabled) => {
      const result = await chrome.runtime.sendMessage({
        type: 'SETTINGS_SET',
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
      if (!result || result.error || result.enabled !== enabled)
        throw new Error('Benchmark settings unavailable');
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
    // Include a post-run GC sample, not merely the last minute before 30:00.
    await cdp.send('HeapProfiler.collectGarbage');
    const finalMetrics = (await cdp.send('Performance.getMetrics')).metrics;
    const finalDom = await cdp.send('Memory.getDOMCounters');
    samples.push({
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      heapBytes:
        finalMetrics.find((metric) => metric.name === 'JSHeapUsedSize')
          ?.value ?? null,
      domNodes: finalDom.nodes,
      bound: final?.stats?.bound ?? 0,
      candidates: final?.stats?.candidates ?? 0,
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
      runtimeSnapshotsAvailable:
        !!initial?.stats && !!final?.stats && !!cleaned?.stats,
    };
    const result = {
      ...scenario,
      browserVersion: context.browser().version(),
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
    try {
      await context?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}
const path = join(reportRoot, `${stamp}.json`);
if ((await buildFingerprint()) !== packagedBuildSha256)
  throw new Error('Packaged build changed during benchmark');
await writeFile(
  path,
  JSON.stringify(
    {
      schemaVersion: 1,
      packagedBuildSha256,
      packagedBuildUnchanged: true,
      environment: {
        os: platform(),
        arch: arch(),
        cpuCount: cpus().length,
        cpuModel: cpus()[0]?.model ?? 'unknown',
        memoryBytes: totalmem(),
      },
      plan: {
        mode: plan.mode,
        secondsPerScenario: seconds,
        browser: plan.chrome
          ? 'installed headed Chrome'
          : 'bundled headless Chromium',
        throttleScope: 'page renderer only; not service-worker CPU',
      },
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
