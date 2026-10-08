import type { BrowserContext, Page } from '@playwright/test';
export interface DetachedDomCounts {
  detachedTreeCount: number;
  retainedNodeCount: number;
}
export interface DetachedDomSample {
  status: 'measured' | 'unavailable';
  counts: DetachedDomCounts | null;
}
export function detachedDomCounts(response: unknown): DetachedDomCounts | null;
export function sampleDetachedDom(
  context: Pick<BrowserContext, 'newCDPSession'>,
  page: Page,
  deadlineMs?: number,
): Promise<DetachedDomSample>;
