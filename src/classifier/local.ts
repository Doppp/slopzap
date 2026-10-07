import { CLASSIFIER_VERSION, type Result, type Unit } from '../shared/types';
import { features } from './features';
export function classify(unit: Unit, fingerprint: string): Result {
  const signal = features(unit);
  const base: Result = {
    fingerprint,
    status: 'insufficient_evidence',
    score: 0,
    evidence: 0,
    reasons: [],
    version: CLASSIFIER_VERSION,
    automaticHide: false,
  };
  if (
    signal.tokens < 8 ||
    !signal.supported ||
    signal.quotedRatio > 0.5 ||
    (unit.kind === 'article' && unit.text.length > 8000)
  )
    return base;
  const score = Math.min(
    signal.tokens < 20 ? 0.79 : 0.84,
    [
      signal.generic,
      signal.formulaic,
      signal.redundancy,
      signal.lowDiversity,
    ].filter((value) => value > 0).length < 2
      ? 0.49
      : 0.84,
    Math.max(
      0.08,
      0.08 +
        signal.generic * 0.45 +
        signal.formulaic * 0.35 +
        signal.redundancy * 0.3 +
        signal.lowDiversity * 0.1 -
        Number(signal.specific) * 0.35,
    ),
  );
  return {
    ...base,
    status: 'classified',
    score,
    evidence: 0.6,
    reasons: [
      signal.generic ? 'Generic engagement' : '',
      signal.formulaic ? 'Formulaic wording' : '',
      signal.redundancy ? 'Repeats parent context' : '',
    ].filter(Boolean),
  };
}
