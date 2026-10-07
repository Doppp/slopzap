import { features } from '../src/classifier/features';
import { agreed, unit, type Example } from './schema';
export const FEATURE_NAMES = [
  'bias',
  'generic',
  'formulaic',
  'redundancy',
  'lowDiversity',
  'specific',
  'length',
] as const;
export interface Model {
  version: 'experimental-logistic-v1';
  features: string[];
  weights: number[];
  calibration: number[];
  trainSamples: number;
  validationSamples: number;
  automaticHide: false;
}
export const vector = (row: Example) => {
  const f = features(unit(row));
  return [
    1,
    f.generic,
    f.formulaic,
    f.redundancy,
    f.lowDiversity,
    Number(f.specific),
    Math.min(1, Math.log1p(f.tokens) / Math.log(201)),
  ];
};
const sigmoid = (score: number) =>
  1 / (1 + Math.exp(-Math.max(-30, Math.min(30, score))));
export const raw = (weights: number[], input: number[]) =>
  weights.reduce((sum, w, index) => sum + w * input[index]!, 0);
function fit(
  inputs: number[][],
  labels: number[],
  epochs: number,
  rate: number,
  regularize: boolean,
) {
  const weights = inputs[0]!.map(() => 0);
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradient = weights.map(() => 0);
    inputs.forEach((input, index) => {
      const error = sigmoid(raw(weights, input)) - labels[index]!;
      input.forEach((value, feature) => {
        gradient[feature]! += error * value;
      });
    });
    weights.forEach((weight, index) => {
      weights[index] =
        weight -
        rate *
          (gradient[index]! / inputs.length +
            (regularize && index ? 0.01 * weight : 0));
    });
  }
  return weights;
}
export function train(rows: Example[]): Model {
  const training = rows.filter((row) => row.split === 'train' && agreed(row)),
    validation = rows.filter(
      (row) => row.split === 'validation' && agreed(row),
    );
  for (const split of [training, validation])
    if (split.length < 20 || new Set(split.map((row) => row.slop)).size !== 2)
      throw new Error(
        'Training and validation each need at least twenty independently reviewed rows with both labels',
      );
  const weights = fit(
    training.map(vector),
    training.map((row) => row.slop),
    1000,
    0.15,
    true,
  );
  const calibration = fit(
    validation.map((row) => [1, raw(weights, vector(row))]),
    validation.map((row) => row.slop),
    500,
    0.05,
    false,
  );
  return {
    version: 'experimental-logistic-v1',
    features: [...FEATURE_NAMES],
    weights,
    calibration,
    trainSamples: training.length,
    validationSamples: validation.length,
    automaticHide: false,
  };
}
export function score(model: Model, row: Example): number | null {
  const f = features(unit(row));
  if (
    f.tokens < 8 ||
    !f.supported ||
    (row.kind === 'article' && row.text.length > 8000)
  )
    return null;
  return sigmoid(raw(model.calibration, [1, raw(model.weights, vector(row))]));
}
export function parseModel(value: unknown): Model {
  const model = value as Model;
  if (
    !model ||
    model.version !== 'experimental-logistic-v1' ||
    JSON.stringify(model.features) !== JSON.stringify(FEATURE_NAMES) ||
    !Array.isArray(model.weights) ||
    model.weights.length !== FEATURE_NAMES.length ||
    !model.weights.every(Number.isFinite) ||
    !Array.isArray(model.calibration) ||
    model.calibration.length !== 2 ||
    !model.calibration.every(Number.isFinite) ||
    model.automaticHide !== false
  )
    throw new Error('Invalid experimental model');
  return model;
}
