import { CLASSIFIER_VERSION, type Result } from '../shared/types';
import type { ProviderResult } from './types';
export const PROVIDER_VERSION = `${CLASSIFIER_VERSION}:chrome-prompt-v1`;
export function compose(local: Result, model: ProviderResult): Result {
  const difference = Math.abs(local.score - model.score);
  return {
    ...local,
    status:
      difference > 0.4
        ? 'insufficient_evidence'
        : model.evidence >= 0.6
          ? 'classified'
          : local.status,
    score: 0.7 * model.score + 0.3 * local.score,
    evidence:
      difference > 0.4 ? 0.59 : Math.min(model.evidence, 1 - difference / 2),
    reasons: [...new Set([...local.reasons, ...model.reasons])].slice(0, 3),
    version: PROVIDER_VERSION,
    automaticHide: false,
  };
}
