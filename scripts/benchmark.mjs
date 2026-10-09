import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, platform, arch, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { benchmarkPlan } from './benchmark-plan.mjs';
import { installFrameProbe } from './benchmark-frames.mjs';
import { installationEvidence } from './benchmark-installation.mjs';
import { sampleWorkerHeap } from './worker-heap.mjs';
import { fixtureSnapshot } from './benchmark-snapshot.mjs';
import { sampleDetachedDom } from './detached-dom.mjs';
import { packageFiles, packageFingerprint } from './package-files.mjs';
import { sampleIdleCpu, quietIdleEndpoints } from './idle-cpu.mjs';
import { targetCommand } from './cdp-target.mjs';
const plan = benchmarkPlan(process.argv.slice(2));
const { long, seconds, scenarios } = plan;
const reportRoot = resolve('.output/benchmarks');
await mkdir(reportRoot, { recursive: true });
async function buildFingerprint() {
  return packageFingerprint(await packageFiles(resolve('.output/chrome-mv3')));
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
    let page, fixtureTabId;
    if (controller) {
      const blank = 'about:blank#slopzap-benchmark-fixture';
      fixtureTabId = await controller.evaluate(
        async (url) => (await chrome.tabs.create({ url, active: true })).id,
        blank,
      );
      for (let attempt = 0; !page && attempt < 50; attempt++) {
        page = context.pages().find((candidate) => candidate.url() === blank);
        if (!page) await controller.waitForTimeout(100);
      }
      if (!page || !Number.isInteger(fixtureTabId) || fixtureTabId <= 0)
        throw new Error('Benchmark fixture tab unavailable');
    } else page = await context.newPage();
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
        ? controller.evaluate(fixtureSnapshot, fixtureTabId)
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
    let initial = await snapshot();
    for (
      let attempt = 0;
      scenario.installed && !initial?.stats && attempt < 50;
      attempt++
    ) {
      await page.waitForTimeout(100);
      initial = await snapshot();
    }
    const initialAbsent = await absentEvidence();
    const workerHeap = () =>
      !plan.workerHeap
        ? Promise.resolve(null)
        : !scenario.installed
          ? Promise.resolve({
              status: 'not_installed',
              heap: null,
              debuggerAttached: false,
            })
          : sampleWorkerHeap(browser, extensionId);
    const initialWorkerHeap = await workerHeap();
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
          workerHeap: await workerHeap(),
        });
        nextSample += long ? 60 : 2;
      }
      await page.waitForTimeout(250);
    }
    const final = await snapshot();
    const frame = await page.evaluate(() => globalThis.benchmark.stop());
    const scrollDurationSeconds = (Date.now() - started) / 1000;
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
      workerHeap: await workerHeap(),
    });
    let idleCpu = null;
    if (plan.idleCpu) {
      await targetCommand(cdp, 'Emulation.setCPUThrottlingRate', { rate: 1 });
      await page.waitForTimeout(2000);
      const before = await snapshot();
      const visibleBefore = await page.evaluate(
        () => document.visibilityState === 'visible',
      );
      const measurement = await sampleIdleCpu(context, page, plan.idleSeconds);
      const visibleAfter = await page.evaluate(
        () => document.visibilityState === 'visible',
      );
      const after = await snapshot();
      idleCpu = {
        rendererThrottle: 1,
        precedingScrollThrottle: scenario.throttle,
        measurement,
        quietEndpoints: quietIdleEndpoints(
          scenario.installed,
          before,
          after,
          visibleBefore,
          visibleAfter,
        ),
        pendingBefore: before?.aggregate?.pending ?? null,
        pendingAfter: after?.aggregate?.pending ?? null,
        classificationsBefore: before?.stats?.classifications ?? null,
        classificationsAfter: after?.stats?.classifications ?? null,
        visibleBefore,
        visibleAfter,
      };
    }
    const detachedDomBeforeCleanup = plan.detachedDom
      ? await sampleDetachedDom(context, page)
      : null;
    await page.evaluate(() => document.querySelector('main').replaceChildren());
    await page.waitForTimeout(300);
    const cleaned = await snapshot();
    await cdp.send('HeapProfiler.collectGarbage');
    const detachedDomAfterCleanup = plan.detachedDom
      ? await sampleDetachedDom(context, page)
      : null;
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
      ...(plan.idleCpu
        ? {
            idleCpuEvidenceAvailable:
              idleCpu?.measurement?.status === 'measured',
            idleCpuQuietEndpoints: idleCpu?.quietEndpoints === true,
          }
        : {}),
      ...(plan.detachedDom
        ? {
            detachedDomEvidenceAvailable:
              detachedDomBeforeCleanup?.status === 'measured' &&
              detachedDomAfterCleanup?.status === 'measured',
          }
        : {}),
      ...(plan.workerHeap
        ? {
            workerHeapEvidenceAvailable: scenario.installed
              ? initialWorkerHeap?.status === 'measured' &&
                samples.every((sample) =>
                  ['measured', 'not_running'].includes(
                    sample.workerHeap?.status,
                  ),
                )
              : initialWorkerHeap?.status === 'not_installed' &&
                samples.every(
                  (sample) => sample.workerHeap?.status === 'not_installed',
                ),
          }
        : {}),
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
      scrollDurationSeconds,
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
      initialWorkerHeap,
      idleCpu,
      detachedDom: {
        beforeCleanup: detachedDomBeforeCleanup,
        afterCleanup: detachedDomAfterCleanup,
      },
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
      schemaVersion: 4,
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
        idleCpuProbe: {
          enabled: plan.idleCpu,
          secondsPerWindow: plan.idleSeconds,
          settleSeconds: 2,
          rendererThrottle: 1,
          throttleScope:
            'CPU emulation removed before settling/accounting; scenario rate applies only to preceding scroll',
          scope:
            'fixture renderer main-thread CPU per wall second; includes browser/harness work, not extension-only or worker/process CPU',
          measurement:
            'fresh page CDP session, threadTicks enabled, ThreadTime/Timestamp deltas; no page JS, GC, snapshot or polling inside the quiet wait',
          releaseAcceptance: false,
        },
        workerHeapProbe: {
          enabled: plan.workerHeap,
          scope:
            'exact SlopZap service-worker V8 isolate; post-GC counters, not process RAM, CPU, model cost or IndexedDB disk usage',
          attachment:
            'attach/detach per sample; no deliberate wake-up or continuous debugger attachment',
          lifecyclePerturbed: plan.workerHeap,
        },
        detachedDomProbe: {
          enabled: plan.detachedDom,
          scope:
            'renderer-wide post-GC detached trees and unique retained node IDs; not attributed SlopZap bindings',
          attachment:
            'fresh page debugger session per pre/post-cleanup sample; detached immediately',
          timingScope:
            'outside frame observation interval; forced GC and inspector node tracking perturb memory',
          releaseAcceptance: false,
        },
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
