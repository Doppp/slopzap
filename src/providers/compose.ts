import { CHROME_PROMPT_VERSION, type Result } from '../shared/types';
import type { ProviderResult } from './types';
export const PROVIDER_VERSION = CHROME_PROMPT_VERSION;
export function compose(local: Result, model: ProviderResult): Result {
  const difference = Math.abs(local.score - model.score);
  const weight = model.evidence >= 0.8 ? 0.7 : 0.55;
  return {
    ...local,
    status:
      difference > 0.4 || model.evidence < 0.6
        ? 'insufficient_evidence'
        : model.evidence >= 0.6
          ? 'classified'
          : local.status,
    score: weight * model.score + (1 - weight) * local.score,
    evidence:
      difference > 0.4 ? 0.59 : Math.min(model.evidence, 1 - difference / 2),
    reasons: [...new Set([...local.reasons, ...model.reasons])].slice(0, 3),
    version: PROVIDER_VERSION,
    automaticHide: false,
  };
}
