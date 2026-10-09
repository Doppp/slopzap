import { test, expect } from '@playwright/test';
import { sampleIdleCpu } from '../../scripts/idle-cpu.mjs';
test.use({ trace: 'off' });
test('renderer thread counters detect an invented busy-loop positive control', async ({
  context,
  page,
}) => {
  await page.setContent('<main>Invented renderer CPU control</main>');
  const result = await sampleIdleCpu(context, page, 1, 5000, async (ms) => {
    await page.evaluate(() => {
      const end = performance.now() + 200;
      while (performance.now() < end) {
        /* Deliberate invented test load. */
      }
    });
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  expect(result.status).toBe('measured');
  expect(result.counters!.threadCpuSeconds).toBeGreaterThan(0.005);
  expect(result.counters!.taskCpuSeconds).toBeGreaterThan(0.005);
  expect(result.counters!.wallSeconds).toBeGreaterThanOrEqual(1);
});
test('idle collector removes preceding CPU emulation before accounting', async ({
  context,
  page,
}) => {
  await page.setContent('<main>Invented idle throttle regression</main>');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    const result = await sampleIdleCpu(context, page, 1);
    expect(result.status).toBe('measured');
    // Discriminator for observed ~76% emulator spin, not SPEC's CPU budget.
    expect(result.counters!.threadCpuPercent).toBeLessThan(50);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
  }
});
