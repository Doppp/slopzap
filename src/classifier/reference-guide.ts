import { REFERENCE_VERSION } from './reference-patterns';

type Signal = 'generic' | 'formulaic' | 'redundancy' | 'specific' | 'quotation';
export interface ReferenceSignature {
  generic: number;
  formulaic: number;
  redundancy: number;
  specific: boolean;
  quotedRatio: number;
}
interface Example {
  text: string;
  parent: string;
}
interface ReferencePair {
  id: string;
  signals: readonly Signal[];
  lesson: string;
  lowInformation: Example;
  useful: Example;
}

// Entirely invented guidance. Never append browsing text or local corrections.
export const REFERENCE_PAIRS: readonly ReferencePair[] = [
  {
    id: 'contextual-appreciation',
    signals: ['generic', 'specific'],
    lesson:
      'Appreciation alone is weak evidence. A concrete contribution can make the same opening useful.',
    lowInformation: {
      parent:
        'Our example team shortened reviews by rotating the backup reviewer.',
      text: 'Absolutely, great insight! Thank you for sharing this valuable perspective on how teams can improve their review process.',
    },
    useful: {
      parent:
        'Our example team shortened reviews by rotating the backup reviewer.',
      text: 'Great insight. We tried the rotation for six weeks; late reviews fell from eleven to four, but onboarding the backup took two afternoons.',
    },
  },
  {
    id: 'paraphrase-or-contribution',
    signals: ['generic', 'redundancy'],
    lesson:
      'Repeating context is not decisive. Look for a new constraint, explanation, question or result.',
    lowInformation: {
      parent:
        'The example build waits for dependency downloads rather than compilation.',
      text: 'Well said! The build really waits for dependency downloads rather than compilation. Thank you for sharing this valuable perspective.',
    },
    useful: {
      parent:
        'The example build waits for dependency downloads rather than compilation.',
      text: 'The build waits for dependency downloads rather than compilation because the runner discards its cache between jobs. Keep the cache volume and compare a warm run.',
    },
  },
  {
    id: 'abstract-framing',
    signals: ['formulaic', 'generic'],
    lesson:
      'Broad framing becomes a weak slop signal only with low information or generic engagement, not merely polished wording.',
    lowInformation: {
      parent: 'The invented discussion asks how to reduce noisy alerts.',
      text: 'In today’s ever-evolving landscape, it is not just about alerts but about unlocking our potential together. Great insight and thank you for sharing!',
    },
    useful: {
      parent: 'The invented discussion asks how to reduce noisy alerts.',
      text: 'It is not just about the alert count but about which alerts need intervention. Group retries into one incident and retain the failure that started the sequence.',
    },
  },
  {
    id: 'quote-and-critique',
    signals: ['quotation', 'formulaic', 'specific'],
    lesson:
      'Quoted clichés, criticism and satire are not interchangeable praise. Be uncertain when context does not resolve the intent.',
    lowInformation: {
      parent:
        'The example post reports a stalled project without explaining its cause.',
      text: 'Absolutely, a valuable perspective! In today’s ever-evolving landscape, unlocking team potential is the game changer we all need.',
    },
    useful: {
      parent:
        'The example post reports a stalled project without explaining its cause.',
      text: 'The phrase “unlocking team potential” does not explain the delay. Which approval actually blocked the release, and who could resolve it?',
    },
  },
  {
    id: 'technical-language',
    signals: ['specific', 'formulaic'],
    lesson:
      'Words like leverage, foster or delve and polished syntax are not standalone evidence of low information or AI authorship.',
    lowInformation: {
      parent: 'The example thread compares two cache designs.',
      text: 'Great insight! In today’s ever-evolving landscape, it is not just about caches but about a valuable perspective on innovation. Thank you for sharing!',
    },
    useful: {
      parent: 'The example thread compares two cache designs.',
      text: 'We leverage the existing index to avoid a second lookup. The benefit disappears when invalidation races the write, so record the version with each cache entry.',
    },
  },
];

export const MAX_REFERENCE_CHARACTERS = 4000;
export function referenceGuide(signatures: readonly ReferenceSignature[]) {
  const strength = (signal: Signal, input: ReferenceSignature) => {
    switch (signal) {
      case 'generic':
        return input.generic > 0 ? 1 : 0;
      case 'formulaic':
        return input.formulaic > 0 ? 1 : 0;
      case 'redundancy':
        return input.redundancy > 0 ? 2 : 0;
      case 'specific':
        return input.specific ? 1 : 0;
      case 'quotation':
        return input.quotedRatio > 0 ? 2 : 0;
    }
  };
  const ranked = REFERENCE_PAIRS.map((pair) => ({
    pair,
    relevance: Math.max(
      0,
      ...signatures.map((input) =>
        pair.signals.reduce((sum, signal) => sum + strength(signal, input), 0),
      ),
    ),
  }))
    .filter((item) => item.relevance > 0)
    .sort(
      (a, b) => b.relevance - a.relevance || a.pair.id.localeCompare(b.pair.id),
    );
  const guide = {
    version: REFERENCE_VERSION,
    provenance: 'invented guidance, not independent validation',
    pairs: [] as ReferencePair[],
  };
  for (const item of ranked) {
    if (guide.pairs.length === 2) break;
    if (
      JSON.stringify({ ...guide, pairs: [...guide.pairs, item.pair] }).length <=
      MAX_REFERENCE_CHARACTERS
    )
      guide.pairs.push(item.pair);
  }
  return guide;
}
