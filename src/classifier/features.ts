import type { Unit } from '../shared/types';
import { authoredProse, phraseSignals } from './reference-patterns';
const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const stop = new Set(
  'a an the of to and or in on at is are was were it this that they we you i have has for with about but as'.split(
    ' ',
  ),
);
export function features(unit: Pick<Unit, 'text' | 'parentText' | 'rootText'>) {
  const tokens = words(unit.text);
  const prose = authoredProse(unit.text);
  const proseTokens = words(prose);
  const target = new Set(proseTokens.filter((token) => !stop.has(token)));
  const parent = new Set(
    words(authoredProse(unit.parentText || unit.rootText)).filter(
      (token) => !stop.has(token),
    ),
  );
  const common = [...target].filter((token) => parent.has(token)).length;
  const overlap =
    parent.size >= 4 && common >= 3
      ? common / Math.min(target.size, parent.size)
      : 0;
  const { generic: genericCount, formulaic: formulaicCount } = phraseSignals(
    unit.text,
  );
  const specific =
    /\d|https?:|`|\b(error|because|tested|measured|yesterday|tomorrow|my team|I tried|for example)\b/i.test(
      prose,
    );
  const diversity =
    target.size /
    Math.max(1, proseTokens.filter((token) => !stop.has(token)).length);
  const latin =
    tokens.filter((token) => /^[a-z]+$/.test(token)).length /
    Math.max(1, tokens.length);
  const englishAnchors = new Set(
    tokens.filter((token) =>
      [
        'the',
        'and',
        'this',
        'that',
        'with',
        'because',
        'was',
        'were',
        'for',
        'have',
        'your',
        'my',
        'it',
        'to',
      ].includes(token),
    ),
  ).size;
  return {
    tokens: tokens.length,
    generic: Math.min(1, genericCount / 3),
    formulaic: Math.min(1, formulaicCount / 2),
    redundancy: overlap > 0.6 ? overlap : 0,
    lowDiversity: tokens.length >= 20 && diversity < 0.5 ? 1 - diversity : 0,
    specific,
    quotedRatio:
      1 -
      prose.replace(/\s/g, '').length /
        Math.max(1, unit.text.replace(/\s/g, '').length),
    supported:
      latin >= 0.8 &&
      (englishAnchors >= 2 || genericCount >= 2 || formulaicCount >= 2),
  };
}
