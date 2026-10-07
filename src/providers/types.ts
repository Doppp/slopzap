import type { Unit } from '../shared/types';
export interface ProviderInput {
  id: string;
  unit: Pick<
    Unit,
    'text' | 'parentText' | 'rootText' | 'quotedText' | 'kind' | 'platform'
  >;
}
export interface ProviderResult {
  id: string;
  score: number;
  evidence: number;
  reasons: string[];
}
export interface Provider {
  readonly id: string;
  ready(): Promise<boolean>;
  classify(
    inputs: ProviderInput[],
    signal: AbortSignal,
  ): Promise<ProviderResult[]>;
  close(): void;
}
export const REASONS = [
  'Generic engagement',
  'Formulaic wording',
  'Repeats parent context',
] as const;
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'score', 'evidence', 'reasons'],
        properties: {
          id: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'number', minimum: 0, maximum: 1 },
          reasons: {
            type: 'array',
            maxItems: 3,
            items: { type: 'string', enum: [...REASONS] },
          },
        },
      },
    },
  },
};
export function validateOutput(
  value: unknown,
  inputs: ProviderInput[],
): ProviderResult[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('results' in value) ||
    !Array.isArray(value.results) ||
    value.results.length > 12 ||
    Object.keys(value).some((key) => key !== 'results')
  )
    throw new Error('Invalid provider response');
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of value.results) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('id' in item) ||
      typeof item.id !== 'string'
    )
      continue;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  seen.clear();
  const accepted: ProviderResult[] = [];
  for (const item of value.results as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const r = item as ProviderResult;
    if (
      !inputs.some((input) => input.id === r.id) ||
      seen.has(r.id) ||
      duplicates.has(r.id) ||
      Object.keys(r).some(
        (key) => !['id', 'score', 'evidence', 'reasons'].includes(key),
      )
    )
      continue;
    if (
      !Number.isFinite(r.score) ||
      r.score < 0 ||
      r.score > 1 ||
      !Number.isFinite(r.evidence) ||
      r.evidence < 0 ||
      r.evidence > 1 ||
      !Array.isArray(r.reasons) ||
      r.reasons.length > 3 ||
      !r.reasons.every((reason) =>
        (REASONS as readonly string[]).includes(reason),
      )
    )
      continue;
    seen.add(r.id);
    accepted.push(r);
  }
  return accepted;
}
