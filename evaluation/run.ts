import { readFile } from 'node:fs/promises';
import { classify } from '../src/classifier/local';
import type { Kind, Platform, Unit } from '../src/shared/types';

interface Example {
  id: string;
  platform: Platform;
  kind: Kind;
  text: string;
  parent?: string;
  slop: 0 | 1;
  slice: string;
}
const examples = JSON.parse(
  await readFile(new URL('./corpus/seed.json', import.meta.url), 'utf8'),
) as Example[];
const threshold = 0.7;
let tp = 0,
  fp = 0,
  tn = 0,
  fn = 0,
  abstained = 0;
const slices = new Map<
  string,
  { total: number; falsePositives: number; missed: number }
>();
for (const example of examples) {
  const unit: Unit = {
    platform: example.platform,
    kind: example.kind,
    id: example.id,
    parentId: null,
    text: example.text,
    parentText: example.parent ?? '',
    rootText: '',
    quotedText: '',
  };
  const result = classify(unit, example.id);
  const predicted = result.status === 'classified' && result.score >= threshold;
  if (result.status !== 'classified') abstained++;
  if (predicted && example.slop) tp++;
  else if (predicted) fp++;
  else if (example.slop) fn++;
  else tn++;
  const slice = slices.get(example.slice) ?? {
    total: 0,
    falsePositives: 0,
    missed: 0,
  };
  slice.total++;
  if (predicted && !example.slop) slice.falsePositives++;
  if (!predicted && example.slop) slice.missed++;
  slices.set(example.slice, slice);
}
console.log(
  JSON.stringify(
    {
      corpus: 'invented seed; development smoke only; not a release evaluation',
      samples: examples.length,
      threshold,
      tp,
      fp,
      tn,
      fn,
      abstained,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp / (tp + fn),
      fpr: fp / (fp + tn),
      fnr: fn / (tp + fn),
      slices: Object.fromEntries(slices),
      automaticHiding: 'disabled pending independent corpus and release gates',
    },
    null,
    2,
  ),
);
