import type { ProviderInput, ProviderResult } from './types';
export function articleChunks(input: ProviderInput): ProviderInput[] {
  const text = input.unit.text;
  if (text.length < 3600) return [];
  const max = text.length - 1200;
  return [0, 0.25, 0.5, 0.75, 1].map((position, index) => ({
    id: `${input.id}:chunk-${index}`,
    unit: {
      ...input.unit,
      text: text.slice(
        Math.floor(max * position),
        Math.floor(max * position) + 1200,
      ),
    },
  }));
}
export function combineArticle(
  input: ProviderInput,
  chunks: ProviderInput[],
  results: ProviderResult[],
): ProviderResult | undefined {
  const valid = chunks.flatMap((chunk) => {
    const result = results.find((result) => result.id === chunk.id);
    return result ? [result] : [];
  });
  if (valid.length < 3) return undefined;
  const sorted = valid.map((result) => result.score).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const sets = chunks.map(
    (chunk) =>
      new Set(chunk.unit.text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []),
  );
  let repetition = 0;
  for (let index = 1; index < sets.length; index++) {
    const previous = sets[index - 1]!,
      current = sets[index]!;
    repetition +=
      [...current].filter((word) => previous.has(word)).length /
      Math.max(1, Math.min(current.size, previous.size));
  }
  repetition /= Math.max(1, sets.length - 1);
  return {
    id: input.id,
    score: 0.8 * median + 0.2 * repetition,
    evidence: Math.min(...valid.map((result) => result.evidence)),
    reasons: [...new Set(valid.flatMap((result) => result.reasons))].slice(
      0,
      3,
    ),
  };
}
