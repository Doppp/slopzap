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
describe('classification safety', () => {
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
