import { expect, test } from 'vitest';
import { articleChunks, combineArticle } from '../src/providers/long-form';
import type { ProviderInput } from '../src/providers/types';
const article: ProviderInput = {
  id: 'one',
  unit: {
    text: 'The cache was warm because my team measured latency yesterday. '.repeat(
      100,
    ),
    parentText: '',
    rootText: '',
    quotedText: '',
    kind: 'article',
    platform: 'medium',
  },
};
test('long articles use five deterministic bounded opening, middle and closing chunks', () => {
  const chunks = articleChunks(article);
  expect(chunks).toHaveLength(5);
  expect(chunks.every((chunk) => chunk.unit.text.length === 1200)).toBe(true);
  expect(chunks[0]!.unit.text).toBe(article.unit.text.slice(0, 1200));
  expect(chunks.at(-1)!.unit.text).toBe(article.unit.text.slice(-1200));
  expect(
    articleChunks({
      ...article,
      unit: { ...article.unit, text: 'Short article' },
    }),
  ).toEqual([]);
});
test('article aggregation needs three valid chunks and preserves conservative evidence', () => {
  const chunks = articleChunks(article);
  const results = chunks.map((chunk, index) => ({
    id: chunk.id,
    score: index / 5,
    evidence: 0.8,
    reasons: [],
  }));
  expect(combineArticle(article, chunks, results.slice(0, 2))).toBeUndefined();
  const result = combineArticle(article, chunks, results)!;
  expect(result.id).toBe(article.id);
  expect(result.score).toBeGreaterThanOrEqual(0.8 * 0.4);
  expect(result.score).toBeLessThanOrEqual(0.8 * 0.4 + 0.2);
  expect(result.evidence).toBe(0.8);
});
