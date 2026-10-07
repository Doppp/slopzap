import type { Kind, Platform, Unit } from '../src/shared/types';
export const SLICES = [
  'short',
  'generic_praise',
  'generic_disagreement',
  'parent_paraphrase',
  'slang',
  'sarcasm',
  'non_native',
  'polished',
  'messy',
  'technical',
  'lists',
  'em_dash',
  'obvious_ai',
  'subtle_ai',
  'edited_ai',
  'human_edited_ai',
  'ai_slang',
  'long_form',
  'ambiguous',
  'formulaic',
  'specific',
  'structured_human',
  'ambiguous_praise',
  'useful_ai_style',
  'casual_synthetic',
  'adversarial',
  'multilingual',
] as const;
export interface Example {
  id: string;
  splitGroup: string;
  split: 'train' | 'validation' | 'test';
  platform: Platform;
  kind: Kind;
  text: string;
  parent?: string;
  language: string;
  provenance: 'synthetic' | 'consented' | 'licensed';
  permission: string;
  slop: 0 | 1;
  slices: string[];
  reviews: { reviewer: string; slop: 0 | 1 }[];
}
export function corpus(value: unknown): Example[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error('Corpus must contain examples');
  const ids = new Set<string>(),
    groups = new Map<string, string>(),
    texts = new Map<string, string>();
  return value.map((input, index) => {
    const fail = () => {
      throw new Error(
        `Invalid corpus row ${index + 1}; content is not included in diagnostics`,
      );
    };
    if (!input || typeof input !== 'object') fail();
    const row = input as Example;
    if (
      Object.keys(row).some(
        (key) =>
          ![
            'id',
            'splitGroup',
            'split',
            'platform',
            'kind',
            'text',
            'parent',
            'language',
            'provenance',
            'permission',
            'slop',
            'slices',
            'reviews',
          ].includes(key),
      )
    )
      fail();
    for (const field of [
      'id',
      'splitGroup',
      'text',
      'language',
      'permission',
    ] as const)
      if (
        typeof row[field] !== 'string' ||
        !row[field].trim() ||
        row[field].length > (field === 'text' ? 12000 : 200)
      )
        fail();
    if (
      !['train', 'validation', 'test'].includes(row.split) ||
      !['reddit', 'youtube', 'linkedin', 'x', 'medium', 'synthetic'].includes(
        row.platform,
      ) ||
      ![
        'post',
        'comment',
        'reply',
        'quote_commentary',
        'article',
        'article_response',
      ].includes(row.kind) ||
      !['synthetic', 'consented', 'licensed'].includes(row.provenance) ||
      ![0, 1].includes(row.slop)
    )
      fail();
    if (
      row.parent !== undefined &&
      (typeof row.parent !== 'string' || row.parent.length > 800)
    )
      fail();
    if (
      !Array.isArray(row.slices) ||
      row.slices.length > 20 ||
      !row.slices.every((slice) =>
        (SLICES as readonly string[]).includes(slice),
      )
    )
      fail();
    if (
      !Array.isArray(row.reviews) ||
      row.reviews.length > 10 ||
      row.reviews.some(
        (review) =>
          !review ||
          typeof review.reviewer !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(review.reviewer) ||
          ![0, 1].includes(review.slop) ||
          Object.keys(review).some(
            (key) => !['reviewer', 'slop'].includes(key),
          ),
      ) ||
      new Set(row.reviews.map((review) => review.reviewer)).size !==
        row.reviews.length
    )
      fail();
    if (ids.has(row.id)) fail();
    ids.add(row.id);
    if (groups.has(row.splitGroup) && groups.get(row.splitGroup) !== row.split)
      throw new Error('Source/template group crosses corpus splits');
    groups.set(row.splitGroup, row.split);
    const normalized = row.text
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (texts.has(normalized) && texts.get(normalized) !== row.split)
      throw new Error('Duplicate text crosses corpus splits');
    texts.set(normalized, row.split);
    return row;
  });
}
export const agreed = (row: Example) =>
  row.reviews.length >= 2 &&
  row.reviews.every((review) => review.slop === row.slop) &&
  !row.slices.includes('ambiguous');
export const unit = (row: Example): Unit => ({
  platform: row.platform,
  kind: row.kind,
  id: '',
  parentId: null,
  text: row.text,
  parentText: row.parent ?? '',
  rootText: '',
  quotedText: '',
});
