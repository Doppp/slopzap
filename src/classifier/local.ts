import { CLASSIFIER_VERSION, type Result, type Unit } from '../shared/types';

const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export function classify(unit: Unit, fingerprint: string): Result {
  const tokens = words(unit.text);
  const base: Result = {
    fingerprint,
    status: 'insufficient_evidence',
    score: 0,
    evidence: 0,
    reasons: [],
    version: CLASSIFIER_VERSION,
    automaticHide: false,
  };
  if (tokens.length < 8) return base;
  const parent = new Set(words(unit.parentText || unit.rootText));
  const unique = new Set(tokens);
  const overlap = parent.size
    ? Array.from(unique).filter((t) => parent.has(t)).length / unique.size
    : 0;
  const generic =
    /\b(great insight|absolutely|well said|couldn.t agree more|thank you for sharing|spot on|so true|game changer|valuable perspective)\b/i.test(
      unit.text,
    );
  const formulaic =
    /\b(in today.s|ever.evolving|not just.+but|it.s not about.+it.s about|in conclusion|delve into|foster|leverage)\b/i.test(
      unit.text,
    );
  const concrete =
    /\d|https?:|`|\b(error|because|tested|measured|yesterday|my team|I tried|for example)\b/i.test(
      unit.text,
    );
  const redundancy = overlap > 0.55;
  const score = Math.min(
    tokens.length < 20 ? 0.79 : 0.84,
    Math.max(
      0.08,
      0.12 +
        Number(generic) * 0.25 +
        Number(formulaic) * 0.2 +
        Number(redundancy) * 0.3 -
        Number(concrete) * 0.2,
    ),
  );
  return {
    ...base,
    status: 'classified',
    score,
    evidence: 0.6,
    reasons: [
      generic ? 'Generic engagement' : '',
      formulaic ? 'Formulaic wording' : '',
      redundancy ? 'Repeats parent context' : '',
    ].filter(Boolean),
  };
}
