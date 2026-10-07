import { describe, expect, test } from 'vitest';
import { fingerprint, normalize } from '../src/shared/fingerprint';
import { classify } from '../src/classifier/local';
import { parseSettings, type Unit } from '../src/shared/types';

const unit: Unit = {
  platform: 'reddit',
  kind: 'reply',
  id: '1',
  parentId: '0',
  text: 'Absolutely, great insight. This is a valuable perspective and thank you for sharing.',
  parentText: '',
  rootText: '',
  quotedText: '',
};
test('specific contributions score below interchangeable paraphrasing', () => {
  const parentText =
    'The real challenge is having the right processes in place.';
  const generic = classify(
    {
      ...unit,
      parentText,
      text: 'Absolutely. The real challenge is having the right processes in place. Great insight and thank you for sharing this valuable perspective!',
    },
    'a',
  );
  const specific = classify(
    {
      ...unit,
      parentText,
      text: 'We measured review time before and after assigning a backup approver. It dropped from three days to one because handoffs improved.',
    },
    'b',
  );
  expect(generic.score).toBeGreaterThan(specific.score);
  expect(generic.automaticHide).toBe(false);
});
describe('classification safety', () => {
  test('unsupported language and oversized article inputs abstain', () => {
    expect(
      classify(
        {
          ...unit,
          text: "J'ai testé cette configuration hier et les résultats étaient différents sur mon ordinateur. Le cache semblait manquer de mémoire.",
        },
        'c',
      ).status,
    ).toBe('insufficient_evidence');
    expect(
      classify(
        {
          ...unit,
          kind: 'article',
          text: 'The system works because the cache is warm. '.repeat(300),
        },
        'd',
      ).status,
    ).toBe('insufficient_evidence');
  });
  test('short comments abstain and heuristic results never auto-hide', () => {
    expect(classify({ ...unit, text: 'Great insight!' }, 'a').status).toBe(
      'insufficient_evidence',
    );
    expect(classify(unit, 'a').automaticHide).toBe(false);
  });
  test('normalization preserves punctuation and case', () =>
    expect(normalize('  Human—writing!\r\n\n\n Yes  ')).toBe(
      'Human—writing!\n\n Yes',
    ));
  test('context edits invalidate a reply', async () => {
    expect(await fingerprint(unit, '/thread')).not.toBe(
      await fingerprint({ ...unit, parentText: 'Edited parent' }, '/thread'),
    );
    expect(await fingerprint(unit, '/thread')).toBe(
      await fingerprint(unit, '/thread'),
    );
  });
  test('settings reject malformed modes and thresholds', () => {
    expect(
      parseSettings({ mode: 'delete', blockerThreshold: NaN }),
    ).toMatchObject({ mode: 'goggles', blockerThreshold: 0.85 });
  });
});
