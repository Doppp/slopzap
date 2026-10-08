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
import { installFrameProbe } from './benchmark-frames.mjs';
import { installationEvidence } from './benchmark-installation.mjs';
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
            ...(!scenario.installed ? ['--disable-extensions'] : []),
            'about:blank',
          ]
        : scenario.installed
          ? [
              `--disable-extensions-except=${extension}`,
              `--load-extension=${extension}`,
              '--mute-audio',
            ]
          : ['--disable-extensions', '--mute-audio'],
    });
    const browser = await context.browser().newBrowserCDPSession();
    let extensionId;
    if (scenario.installed && plan.chrome) {
      ({ id: extensionId } = await browser.send('Extensions.loadUnpacked', {
        path: extension,
      }));
    } else if (scenario.installed) {
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent('serviceworker'));
      extensionId = new URL(worker.url()).host;
    }
    const registration = () =>
      browser
        .send('Extensions.getExtensions')
        .then((response) =>
          installationEvidence(
            response,
            extensionId,
            scenario.installed ? extension : undefined,
          ),
        );
    const initialRegistration = await registration();
    const controller = scenario.installed ? await context.newPage() : null;
    if (controller) {
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
    }
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
    const snapshot = () =>
      controller
        ? controller.evaluate(async () => {
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
          })
        : Promise.resolve(null);
    const absentEvidence = async () => {
      if (scenario.installed) return null;
      const { targetInfos } = await browser.send('Target.getTargets');
      return {
        ...(await registration()),
        extensionTargetCount: targetInfos.filter((target) =>
          target.url.startsWith('chrome-extension://'),
        ).length,
        annotationCount: await page.locator('[data-slopzap-ui]').count(),
      };
    };
    await page.waitForTimeout(500);
    const initial = await snapshot();
    const initialAbsent = await absentEvidence();
    const samples = [];
    await page.evaluate(installFrameProbe);
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
          bound: state?.stats?.bound ?? null,
          candidates: state?.stats?.candidates ?? null,
        });
        nextSample += long ? 60 : 2;
      }
      await page.waitForTimeout(250);
    }
    const final = await snapshot();
    const frame = await page.evaluate(() => globalThis.benchmark.stop());
    const finalRegistration = await registration();
    const finalAbsent = await absentEvidence();
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
      bound: final?.stats?.bound ?? null,
      candidates: final?.stats?.candidates ?? null,
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
      framesObserved: frame.samples > 0,
      ...(scenario.installed
        ? {
            packagedExtensionRegistered:
              initialRegistration.unpackedExtensionCount === 1 &&
              initialRegistration.packagedExtensionRegistered &&
              finalRegistration.unpackedExtensionCount === 1 &&
              finalRegistration.packagedExtensionRegistered,
            boundedCandidates: samples.every(
              (sample) =>
                sample.candidates !== null && sample.candidates <= 1000,
            ),
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
          }
        : {
            noUnpackedExtensions:
              initialAbsent?.unpackedExtensionCount === 0 &&
              finalAbsent?.unpackedExtensionCount === 0,
            noAnnotations:
              initialAbsent?.annotationCount === 0 &&
              finalAbsent?.annotationCount === 0,
          }),
    };
    const result = {
      ...scenario,
      browserVersion: context.browser().version(),
      control: scenario.installed
        ? scenario.enabled
          ? 'installed-processing-enabled'
          : 'installed-processing-disabled'
        : 'extension-absent',
      durationSeconds: (Date.now() - started) / 1000,
      initial: initial?.stats ?? null,
      final: final?.stats ?? null,
      timings: final?.timings ?? {},
      absentEvidence: scenario.installed
        ? null
        : { initial: initialAbsent, final: finalAbsent },
      installationEvidence: {
        initial: initialRegistration,
        final: finalRegistration,
      },
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
      schemaVersion: 2,
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
        includesExtensionAbsent: scenarios.some(
          (scenario) => !scenario.installed,
        ),
        frameScope:
          'full observation interval; fixed 0.1 ms histogram; over-33-ms ratio is a proxy, not measured dropped frames',
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
