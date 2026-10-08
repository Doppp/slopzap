import { test, expect } from '@playwright/test';
import { sampleDetachedDom } from '../../scripts/detached-dom.mjs';

// Playwright DOM snapshots retain their own nodes. Keep this numeric probe
// isolated from tracing so the positive/negative control measures the fixture.
test.use({ trace: 'off' });

test('fresh detached DOM samples detect then release an invented retained tree', async ({
  page,
  context,
}) => {
  await page.setContent('<main>Invented retention fixture</main>');
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      retainedFixture?: HTMLElement;
    };
    scope.retainedFixture = document.createElement('section');
    scope.retainedFixture.append(document.createElement('span'));
    document.body.append(scope.retainedFixture);
    scope.retainedFixture.remove();
  });
  const retained = await sampleDetachedDom(context, page);
  expect(retained.status).toBe('measured');
  expect(retained.counts?.detachedTreeCount).toBe(1);
  expect(retained.counts?.retainedNodeCount).toBe(2);
  await page.evaluate(() => {
    delete (globalThis as typeof globalThis & { retainedFixture?: HTMLElement })
      .retainedFixture;
  });
  expect(await sampleDetachedDom(context, page)).toEqual({
    status: 'measured',
    counts: { detachedTreeCount: 0, retainedNodeCount: 0 },
  });
});
