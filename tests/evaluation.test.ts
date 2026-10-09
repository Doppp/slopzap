import { expect, test } from 'vitest';
import { corpus, type Example } from '../evaluation/schema';
import { metrics, ranking, confidence } from '../evaluation/metrics';
import { report } from '../evaluation/report';
import { train, score, parseModel, FEATURE_NAMES } from '../evaluation/model';
import { CLASSIFIER_VERSION } from '../src/shared/types';
import { classificationChecks } from '../evaluation/classification-evidence';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const example = (id = 'one'): Example => ({
  id,
  splitGroup: id,
  split: 'test',
  platform: 'reddit',
  kind: 'reply',
  text: 'I measured the cache latency yesterday because the dataset fits in memory.',
  language: 'en',
  provenance: 'synthetic',
  permission: 'invented unit-test fixture',
  slop: 0,
  slices: ['technical'],
  reviews: [
    { reviewer: 'reviewer_a', slop: 0 },
    { reviewer: 'reviewer_b', slop: 0 },
  ],
});
test('corpus schema rejects malformed data and redacts errors', () => {
  expect(corpus([example()])).toHaveLength(1);
  expect(() =>
    corpus([{ ...example(), text: 'private-canary', slop: 9 }]),
  ).toThrow(/Invalid corpus row/);
  expect(() => corpus([{ ...example(), unknownField: true }])).toThrow();
  expect(() =>
    corpus([
      {
        ...example(),
        reviews: [
          { reviewer: 'duplicate', slop: 0 },
          { reviewer: 'duplicate', slop: 0 },
        ],
      },
    ]),
  ).toThrow();
});
test('template group and duplicate text cannot cross splits', () => {
  expect(() =>
    corpus([
      example(),
      {
        ...example('two'),
        splitGroup: 'one',
        split: 'train',
        text: 'Different invented wording.',
      },
    ]),
  ).toThrow(/group crosses/);
  expect(() =>
    corpus([example(), { ...example('two'), split: 'train' }]),
  ).toThrow(/Duplicate text/);
});
test('abstentions count as missed positives and are explicit in coverage', () => {
  const rows = [
    { label: 1 as const, score: 0.9, group: 'a' },
    { label: 0 as const, score: 0.9, group: 'b' },
    { label: 1 as const, score: null, group: 'c' },
    { label: 0 as const, score: 0.1, group: 'd' },
  ];
  expect(metrics(rows, 0.85)).toMatchObject({
    tp: 1,
    fp: 1,
    tn: 1,
    fn: 1,
    precision: 0.5,
    recall: 0.5,
    fpr: 0.5,
    abstained: 1,
    coverage: 0.75,
  });
});
test('ranking handles tied scores and exposes empty calibration', () => {
  expect(() => ranking([{ label: 1, score: NaN, group: 'one' }])).toThrow();
  expect(
    ranking([
      { label: 1, score: 1, group: 'one' },
      { label: 0, score: 0, group: 'two' },
    ]).prAuc,
  ).toBe(1);
  expect(ranking([])).toEqual({
    prAuc: null,
    calibrationErrorClassified: null,
  });
});
test('experimental model parsing rejects overflow-prone weights and undeclared fields', () => {
  const model = {
    version: 'experimental-logistic-v2',
    featureVersion: CLASSIFIER_VERSION,
    features: [...FEATURE_NAMES],
    weights: FEATURE_NAMES.map(() => 0),
    calibration: [0, 1],
    trainSamples: 20,
    validationSamples: 20,
    automaticHide: false,
  };
  expect(parseModel(model)).toEqual(model);
  expect(() =>
    parseModel({ ...model, featureVersion: 'provisional-features-v3' }),
  ).toThrow();
  expect(() =>
    parseModel({ ...model, version: 'experimental-logistic-v1' }),
  ).toThrow();
  expect(() =>
    parseModel({ ...model, weights: FEATURE_NAMES.map(() => 1e308) }),
  ).toThrow();
  expect(() =>
    parseModel({ ...model, text: 'must not enter an exported model' }),
  ).toThrow();
});
test('bootstrap is reproducible and zero observed FPs still have an uncertainty bound', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    label: 0 as const,
    score: 0.1,
    group: String(index),
  }));
  expect(confidence(rows, 0.85, 20)).toEqual(confidence(rows, 0.85, 20));
  expect(confidence(rows, 0.85, 20).fprWilsonUpper).toBeGreaterThan(0);
});
test('undersized or disputed corpora cannot satisfy release gates', () => {
  const result = report([example()]);
  expect(result.statisticalGatesPass).toBe(false);
  expect(result.automaticHide).toBe(false);
  expect(
    report([
      {
        ...example(),
        reviews: [
          { reviewer: 'a', slop: 0 },
          { reviewer: 'b', slop: 1 },
        ],
      },
    ]).reviewedSamples,
  ).toBe(0);
});

test('schema-v2 exports share recomputed gates and counted coverage without content', () => {
  const result = report([example()]);
  expect(result.schemaVersion).toBe(2);
  expect(result.checks).toEqual(classificationChecks(result));
  expect(result.platformCounts.reddit).toBe(1);
  expect(result.kindCounts.reply).toBe(1);
  expect(result.checks.requiredSlices).toBe(false);
  expect(result.checks.reportStructure).toBe(true);
  const exported = JSON.stringify(result);
  expect(exported).not.toContain(example().text);
  expect(exported).not.toContain('reviewer_a');
});

test('ambiguity remains excluded and cannot be repaired by changing pass flags', () => {
  const result = report([{ ...example(), slices: ['technical', 'ambiguous'] }]);
  expect(result.reviewedSamples).toBe(0);
  expect(result.excludedAmbiguousOrUnreviewed).toBe(1);
  expect(result.statisticalGatesPass).toBe(false);
  expect(result.checks.independentlyReviewedHeldOut).toBe(false);
});

test('corpus CLI exports aggregate schema-v2 failures without invented text or review IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slopzap-corpus-check-test-'));
  try {
    const input = join(root, 'invented.json');
    const row = {
      ...example(),
      text: 'Invented private canary for an evaluation smoke. It is not scientific release evidence.',
    };
    await writeFile(input, JSON.stringify([row]));
    const result = spawnSync(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        resolve('evaluation/corpus-cli.ts'),
        'evaluate',
        input,
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.schemaVersion).toBe(2);
    expect(output.checks).toEqual(classificationChecks(output));
    expect(output.statisticalGatesPass).toBe(false);
    expect(result.stdout).not.toContain(row.text);
    expect(result.stdout).not.toContain('reviewer_a');
    expect(result.stdout).not.toContain(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('training/calibration ignore held-out labels and produce a tiny experimental artifact', () => {
  const rows = ['train', 'validation', 'test'].flatMap((split) =>
    Array.from({ length: 24 }, (_, index): Example => {
      const slop = (index % 2) as 0 | 1;
      return {
        ...example(`${split}_${index}`),
        split: split as Example['split'],
        text: slop
          ? `Absolutely, great insight! Thank you for sharing this valuable perspective in today's ever-evolving landscape. Variant ${split} ${index}.`
          : `I measured this configuration yesterday because the cache needed a warm run. Variant ${split} ${index}.`,
        slop,
        reviews: [
          { reviewer: 'a', slop },
          { reviewer: 'b', slop },
        ],
      };
    }),
  );
  const trained = train(corpus(rows));
  expect(
    train(
      rows.map((row) =>
        row.split === 'test' ? { ...row, slop: row.slop ? 0 : 1 } : row,
      ),
    ),
  ).toEqual(trained);
  expect(JSON.stringify(trained).length).toBeLessThan(100_000);
  expect(trained.automaticHide).toBe(false);
  expect(score(trained, rows[0]!)).toBeGreaterThanOrEqual(0);
});
