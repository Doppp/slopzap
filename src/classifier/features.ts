import type { Unit } from '../shared/types';
const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const stop = new Set(
  'a an the of to and or in on at is are was were it this that they we you i have has for with about but as'.split(
    ' ',
  ),
);
export function features(unit: Unit) {
  const tokens = words(unit.text);
  const target = new Set(tokens.filter((token) => !stop.has(token)));
  const parent = new Set(
    words(unit.parentText || unit.rootText).filter((token) => !stop.has(token)),
  );
  const common = [...target].filter((token) => parent.has(token)).length;
  const overlap =
    parent.size >= 4 && common >= 3
      ? common / Math.min(target.size, parent.size)
      : 0;
  const genericCount =
    unit.text.match(
      /\b(great insight|absolutely|well said|couldn.t agree more|thank you for sharing|spot on|so true|game changer|valuable perspective)\b/gi,
    )?.length ?? 0;
  const formulaicCount =
    unit.text.match(
      /\b(in today.s|ever.evolving|not just.+?but|it.s not about.+?it.s about|in conclusion|delve into|foster|leverage|valuable perspective|insightful|important topic|unlocking.+?potential)\b/gi,
    )?.length ?? 0;
  const specific =
    /\d|https?:|`|\b(error|because|tested|measured|yesterday|tomorrow|my team|I tried|for example)\b/i.test(
      unit.text,
    );
  const diversity =
    target.size /
    Math.max(1, tokens.filter((token) => !stop.has(token)).length);
  const latin =
    tokens.filter((token) => /^[a-z]+$/.test(token)).length /
    Math.max(1, tokens.length);
  return {
    tokens: tokens.length,
    generic: Math.min(1, genericCount / 3),
    formulaic: Math.min(1, formulaicCount / 2),
    redundancy: overlap > 0.6 ? overlap : 0,
    lowDiversity: tokens.length >= 20 && diversity < 0.5 ? 1 - diversity : 0,
    specific,
    supported: latin >= 0.8,
  };
}
