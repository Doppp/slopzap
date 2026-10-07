import {
  DEFAULT_SETTINGS,
  type Result,
  type Verdict,
  type Unit,
  type Settings,
} from '../shared/types';
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

export type ContentRequest =
  | { type: 'SNAPSHOT' }
  | { type: 'RETRY_ADAPTER' }
  | { type: 'SETTINGS_CHANGED'; settings: Settings };

const keyValid = (key: unknown): key is string =>
  typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
function boundedRecord(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false;
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 256_000
    );
  } catch {
    return false;
  }
}
function validSettings(value: unknown): value is Settings {
  if (!record(value) || !record(value.sites)) return false;
  const bounded = (number: unknown, min: number) =>
    typeof number === 'number' &&
    Number.isFinite(number) &&
    number >= min &&
    number <= 0.95;
  return (
    fields(value, [
      'debug',
      'onDevice',
      'enabled',
      'mode',
      'blockerThreshold',
      'onlyThreshold',
      'sites',
    ]) &&
    typeof value.debug === 'boolean' &&
    typeof value.onDevice === 'boolean' &&
    typeof value.enabled === 'boolean' &&
    typeof value.mode === 'string' &&
    ['normal', 'goggles', 'blocker', 'only'].includes(value.mode) &&
    bounded(value.blockerThreshold, 0.75) &&
    bounded(value.onlyThreshold, 0.5) &&
    fields(value.sites, Object.keys(DEFAULT_SETTINGS.sites)) &&
    Object.keys(DEFAULT_SETTINGS.sites).every(
      (site) =>
        typeof (value.sites as Record<string, unknown>)[site] === 'boolean',
    )
  );
}

export function parseContentRequest(value: unknown): ContentRequest | null {
  if (!boundedRecord(value)) return null;
  if (value.type === 'SNAPSHOT' || value.type === 'RETRY_ADAPTER')
    return fields(value, ['type']) ? { type: value.type } : null;
  if (
    value.type === 'SETTINGS_CHANGED' &&
    fields(value, ['type', 'settings']) &&
    validSettings(value.settings)
  )
    return { type: value.type, settings: value.settings };
  return null;
}
export function validResult(value: unknown): value is Result {
  if (!record(value)) return false;
  const r = value as unknown as Result;
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
  if (!boundedRecord(value)) return null;
  const r = value as Request;
  switch (r.type) {
    case 'CLASSIFY_LOCAL':
      return fields(value, ['type', 'items']) &&
        Array.isArray(r.items) &&
        r.items.length <= 16 &&
        Array.from(r.items).every(
          (item) =>
            record(item) &&
            fields(item, ['unit', 'fingerprint']) &&
            keyValid(item.fingerprint) &&
            validUnit(item.unit),
        )
        ? r
        : null;
    case 'SETTINGS_GET':
      return fields(value, ['type']) ? r : null;
    case 'SETTINGS_SET':
      return fields(value, ['type', 'settings']) && record(r.settings)
        ? r
        : null;
    case 'ONBOARDING_GET':
      return fields(value, ['type']) ? r : null;
    case 'ONBOARDING_COMPLETE':
      return fields(value, ['type', 'choices']) &&
        (r.choices === undefined || validChoices(r.choices))
        ? r
        : null;
    case 'CACHE_GET':
      return fields(value, ['type', 'keys', 'version']) &&
        (r.version === undefined ||
          (typeof r.version === 'string' &&
            r.version.length > 0 &&
            r.version.length < 80)) &&
        Array.isArray(r.keys) &&
        r.keys.length <= 50 &&
        Array.from(r.keys).every(keyValid)
        ? r
        : null;
    case 'CACHE_SAVE':
      return fields(value, ['type', 'results']) &&
        Array.isArray(r.results) &&
        r.results.length <= 50 &&
        Array.from(r.results).every(validResult)
        ? r
        : null;
    case 'OVERRIDE':
      return fields(value, ['type', 'key', 'verdict']) &&
        keyValid(r.key) &&
        ['slop', 'not_slop'].includes(r.verdict)
        ? r
        : null;
    case 'CACHE_CLEAR':
      return fields(value, ['type', 'store']) &&
        ['results', 'overrides'].includes(r.store)
        ? r
        : null;
    default:
      return null;
  }
}

export function validUnit(value: unknown): value is Unit {
  if (!record(value)) return false;
  const unit = value as unknown as Unit;
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
