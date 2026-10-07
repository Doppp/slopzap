import type {
  Mode,
  Result,
  Settings,
  Snapshot,
  Verdict,
} from '../shared/types';

export type Presentation = 'visible' | 'hidden' | 'context';
export interface ScoredItem {
  key: string;
  parent: string | null;
  result: Result | undefined;
  verdict: Verdict | undefined;
}
export function score(item: ScoredItem): number | undefined {
  if (item.verdict) return item.verdict === 'slop' ? 1 : 0;
  return item.result?.status === 'classified' && item.result.evidence >= 0.6
    ? item.result.score
    : undefined;
}
export function presentations(
  items: ScoredItem[],
  mode: Mode,
  settings: Settings,
): Map<string, Presentation> {
  const map = new Map<string, Presentation>();
  for (const item of items) {
    const value = score(item);
    const eligible =
      item.verdict !== undefined ||
      (item.result?.automaticHide === true && item.result.evidence >= 0.6);
    if (mode === 'blocker')
      map.set(
        item.key,
        eligible && value !== undefined && value >= settings.blockerThreshold
          ? 'hidden'
          : 'visible',
      );
    else if (mode === 'only')
      map.set(
        item.key,
        value === undefined || value >= settings.onlyThreshold
          ? 'visible'
          : 'hidden',
      );
    else map.set(item.key, 'visible');
  }
  if (mode === 'only') {
    const lookup = new Map(items.map((item) => [item.key, item]));
    for (const item of items)
      if (map.get(item.key) === 'visible') {
        const seen = new Set<string>();
        let parent = item.parent;
        while (parent && !seen.has(parent)) {
          seen.add(parent);
          if (map.get(parent) === 'hidden') map.set(parent, 'context');
          parent = lookup.get(parent)?.parent ?? null;
        }
      }
  }
  return map;
}
export function aggregate(items: ScoredItem[], pending: number): Snapshot {
  const unique = new Map(
    items.map((item) => [item.result?.fingerprint ?? item.key, item]),
  );
  let weight = 0,
    total = 0,
    analysed = 0,
    corrected = 0;
  for (const item of unique.values()) {
    if (item.verdict) {
      corrected++;
      continue;
    }
    if (item.result?.status !== 'classified' || item.result.evidence < 0.6)
      continue;
    analysed++;
    const w = Math.max(0.5, item.result.evidence);
    total += item.result.score * w;
    weight += w;
  }
  return {
    analysed,
    pending,
    score: analysed >= 3 ? total / weight : null,
    corrected,
  };
}
