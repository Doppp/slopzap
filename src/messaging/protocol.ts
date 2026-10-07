import type { Result, Verdict, Unit } from '../shared/types';
import { validChoices, type OnboardingChoices } from '../state/onboarding';

export type Request =
  | { type: 'CLASSIFY_LOCAL'; items: { unit: Unit; fingerprint: string }[] }
  | { type: 'SETTINGS_GET' }
  | { type: 'SETTINGS_SET'; settings: unknown }
  | { type: 'ONBOARDING_GET' }
  | { type: 'ONBOARDING_COMPLETE'; choices?: OnboardingChoices }
  | { type: 'CACHE_GET'; keys: string[]; version?: string }
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
    r.automaticHide === false
  );
}
export function parseRequest(value: unknown): Request | null {
  if (!value || typeof value !== 'object') return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256_000)
      return null;
  } catch {
    return null;
  }
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
    case 'ONBOARDING_GET':
      return r;
    case 'ONBOARDING_COMPLETE':
      return r.choices === undefined || validChoices(r.choices) ? r : null;
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

export function validUnit(value: unknown): value is Unit {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Unit;
  return (
    Object.keys(unit).every((key) =>
      [
        'platform',
        'kind',
        'id',
        'parentId',
        'text',
        'parentText',
        'rootText',
        'quotedText',
      ].includes(key),
    ) &&
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
    (unit.parentId === null ||
      (typeof unit.parentId === 'string' && unit.parentId.length <= 500)) &&
    typeof unit.text === 'string' &&
    unit.text.length <= 12000 &&
    typeof unit.parentText === 'string' &&
    unit.parentText.length <= 800 &&
    typeof unit.rootText === 'string' &&
    unit.rootText.length <= 500 &&
    typeof unit.quotedText === 'string' &&
    unit.quotedText.length <= 600
  );
}
