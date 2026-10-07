import { expect, test } from 'vitest';
import { classify } from '../src/classifier/local';
import { features } from '../src/classifier/features';
import {
  phraseSignals,
  REFERENCE_VERSION,
} from '../src/classifier/reference-patterns';
import {
  referenceGuide,
  REFERENCE_PAIRS,
  MAX_REFERENCE_CHARACTERS,
} from '../src/classifier/reference-guide';
import { CLASSIFIER_VERSION, type Unit } from '../src/shared/types';
const unit = (text: string, parentText = ''): Unit => ({
  platform: 'reddit',
  kind: 'reply',
  id: 'invented',
  parentId: null,
  text,
  parentText,
  rootText: '',
  quotedText: '',
});

test('weak cues are counted by distinct pattern, not repeated words or aliases', () => {
  expect(
    phraseSignals('Absolutely, spot on, so true, well said. Absolutely!')
      .generic,
  ).toBe(1);
  expect(
    phraseSignals(
      'Leverage the index to foster consistent reads and delve into the trace.',
    ).formulaic,
  ).toBe(0);
  expect(
    phraseSignals(
      'Absolutely, great insight! Thank you for sharing this valuable perspective.',
    ).generic,
  ).toBe(3);
  expect(CLASSIFIER_VERSION).toContain(REFERENCE_VERSION);
});

test('one family of praise never becomes likely slop by phrase matching alone', () => {
  const result = classify(
    unit(
      'Absolutely, great insight! Thank you for sharing this valuable perspective on the important work that our colleagues do together.',
    ),
    'a'.repeat(64),
  );
  expect(result.score).toBeLessThan(0.5);
  expect(result.automaticHide).toBe(false);
});

test('literal quotations and code are not attributed to the target author', () => {
  for (const quote of [
    '"Absolutely, great insight! Thank you for sharing this valuable perspective."',
    '“Absolutely, great insight! Thank you for sharing this valuable perspective.”',
    '`Absolutely great insight thank you for sharing`',
    '```Absolutely great insight thank you for sharing```',
  ]) {
    const value = unit(
      `The sample output was ${quote} but the discussion should explain the actual failure and the proposed repair.`,
    );
    expect(features(value).generic).toBe(0);
    expect(classify(value, 'b'.repeat(64)).score).toBeLessThan(0.5);
  }
  expect(
    classify(
      unit(
        '"In today’s ever-evolving landscape, great insight! Thank you for sharing this valuable perspective on all the important possibilities."',
      ),
      'c'.repeat(64),
    ).status,
  ).toBe('insufficient_evidence');
});

test('specific contributions score below interchangeable contextual paraphrases', () => {
  const parent =
    'Our invented deployment waits for the final approval rather than a slow build.';
  const filler = unit(
    'Absolutely, great insight! Our deployment waits for the final approval rather than a slow build. Thank you for sharing this valuable perspective.',
    parent,
  );
  const useful = unit(
    'Great insight. We measured the approval delay over four weeks; the backup reviewer removed most of the wait, while build duration stayed unchanged.',
    parent,
  );
  expect(classify(filler, 'd'.repeat(64)).score).toBeGreaterThanOrEqual(0.7);
  expect(classify(useful, 'e'.repeat(64)).score).toBeLessThan(0.5);
});

test('reference retrieval is deterministic, relevant, balanced and bounded', () => {
  const inputs = [
    features(
      unit(
        'The sample "great insight" is quoted, while this specific explanation describes the error in the response.',
      ),
    ),
  ];
  const guide = referenceGuide(inputs);
  expect(guide).toEqual(referenceGuide(inputs));
  expect(guide.pairs.length).toBeLessThanOrEqual(2);
  expect(guide.pairs.some((pair) => pair.id === 'quote-and-critique')).toBe(
    true,
  );
  expect(
    guide.pairs.every((pair) => pair.lowInformation.text && pair.useful.text),
  ).toBe(true);
  expect(JSON.stringify(guide).length).toBeLessThanOrEqual(
    MAX_REFERENCE_CHARACTERS,
  );
  expect(referenceGuide([]).pairs).toEqual([]);
  expect(
    referenceGuide([
      features(
        unit(
          'Trees grow beside the river and birds move between the branches.',
        ),
      ),
    ]).pairs,
  ).toEqual([]);
});

test('retrieval never copies browsing text, identifiers or corrections into references', () => {
  const guide = referenceGuide([
    features(
      unit(
        'private-canary-token: I measured the cache at 12 milliseconds after the change.',
      ),
    ),
  ]);
  expect(JSON.stringify(guide)).not.toContain('private-canary-token');
  expect(guide.pairs.every((pair) => REFERENCE_PAIRS.includes(pair))).toBe(
    true,
  );
  expect(
    REFERENCE_PAIRS.every(
      (pair) =>
        pair.lowInformation.text.length <= 400 &&
        pair.useful.text.length <= 400,
    ),
  ).toBe(true);
});
