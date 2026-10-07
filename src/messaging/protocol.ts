import type { Result, Verdict, Unit } from '../shared/types';

export type Request =
  | { type: 'CLASSIFY_LOCAL'; items: { unit: Unit; fingerprint: string }[] }
  | { type: 'SETTINGS_GET' }
  | { type: 'SETTINGS_SET'; settings: unknown }
  | { type: 'CACHE_GET'; keys: string[] }
  | { type: 'CACHE_SAVE'; results: Result[] }
  | { type: 'OVERRIDE'; key: string; verdict: Verdict }
  | { type: 'CACHE_CLEAR'; store: 'results' | 'overrides' };

const keyValid = (key: unknown): key is string =>
  typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
export function validResult(value: unknown): value is Result {
  if (!value || typeof value !== 'object') return false;
  const r = value as Result;
  return (
    Object.keys(r).every((key) =>
      [
        'fingerprint',
        'status',
        'score',
        'evidence',
        'reasons',
        'version',
        'automaticHide',
      ].includes(key),
    ) &&
    keyValid(r.fingerprint) &&
    ['classified', 'insufficient_evidence'].includes(r.status) &&
    Number.isFinite(r.score) &&
    r.score >= 0 &&
    r.score <= 1 &&
    Number.isFinite(r.evidence) &&
    r.evidence >= 0 &&
    r.evidence <= 1 &&
    Array.isArray(r.reasons) &&
    r.reasons.length <= 5 &&
    r.reasons.every((reason) =>
      [
        'Generic engagement',
        'Formulaic wording',
        'Repeats parent context',
      ].includes(reason),
    ) &&
    typeof r.version === 'string' &&
    r.version.length < 80 &&
    typeof r.automaticHide === 'boolean'
  );
}
export function parseRequest(value: unknown): Request | null {
  if (
    !value ||
    typeof value !== 'object' ||
    JSON.stringify(value).length > 256_000
  )
    return null;
  const r = value as Request;
  switch (r.type) {
    case 'CLASSIFY_LOCAL':
      return Array.isArray(r.items) &&
        r.items.length <= 16 &&
        r.items.every(
          (item) => keyValid(item.fingerprint) && validUnit(item.unit),
        )
        ? r
        : null;
    case 'SETTINGS_GET':
      return r;
    case 'SETTINGS_SET':
      return r;
    case 'CACHE_GET':
      return Array.isArray(r.keys) &&
        r.keys.length <= 50 &&
        r.keys.every(keyValid)
        ? r
        : null;
    case 'CACHE_SAVE':
      return Array.isArray(r.results) &&
        r.results.length <= 50 &&
        r.results.every(validResult)
        ? r
        : null;
    case 'OVERRIDE':
      return keyValid(r.key) && ['slop', 'not_slop'].includes(r.verdict)
        ? r
        : null;
    case 'CACHE_CLEAR':
      return ['results', 'overrides'].includes(r.store) ? r : null;
    default:
      return null;
  }
}

function validUnit(value: unknown): value is Unit {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Unit;
  return (
    ['reddit', 'youtube', 'linkedin', 'x', 'medium', 'synthetic'].includes(
      unit.platform,
    ) &&
    [
      'post',
      'comment',
      'reply',
      'quote_commentary',
      'article',
      'article_response',
    ].includes(unit.kind) &&
    typeof unit.id === 'string' &&
    unit.id.length <= 500 &&
    (unit.parentId === null || typeof unit.parentId === 'string') &&
    [unit.text, unit.parentText, unit.rootText, unit.quotedText].every(
      (text) => typeof text === 'string' && text.length <= 12000,
    )
  );
}
