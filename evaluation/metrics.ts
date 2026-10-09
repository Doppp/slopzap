export interface Prediction {
  label: 0 | 1;
  score: number | null;
  group: string;
}
const ratio = (n: number, d: number) => (d ? n / d : null);
export function metrics(rows: Prediction[], threshold: number) {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0,
    abstained = 0;
  for (const row of rows) {
    const positive = row.score !== null && row.score >= threshold;
    if (row.score === null) abstained++;
    if (positive && row.label) tp++;
    else if (positive) fp++;
    else if (row.label) fn++;
    else tn++;
  }
  return {
    samples: rows.length,
    threshold,
    tp,
    fp,
    tn,
    fn,
    abstained,
    coverage: ratio(rows.length - abstained, rows.length),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    fpr: ratio(fp, fp + tn),
    fnr: ratio(fn, tp + fn),
  };
}
export function ranking(rows: Prediction[]) {
  if (
    rows.some(
      (row) =>
        row.score !== null &&
        (!Number.isFinite(row.score) || row.score < 0 || row.score > 1),
    )
  )
    throw new Error('Invalid prediction score');
  const positives = rows.filter((row) => row.label).length;
  const sorted = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  let tp = 0,
    count = 0,
    area = 0;
  for (let index = 0; index < sorted.length;) {
    const score = sorted[index]!.score;
    let found = 0;
    while (index < sorted.length && sorted[index]!.score === score) {
      found += sorted[index]!.label;
      count++;
      index++;
    }
    tp += found;
    if (positives) area += ((found / positives) * tp) / count;
  }
  let ece = 0,
    classified = 0;
  for (let bin = 0; bin < 10; bin++) {
    const values = rows.filter(
      (row) =>
        row.score !== null && Math.min(9, Math.floor(row.score * 10)) === bin,
    );
    if (!values.length) continue;
    classified += values.length;
    ece += Math.abs(
      values.reduce((sum, row) => sum + row.score!, 0) -
        values.reduce((sum, row) => sum + row.label, 0),
    );
  }
  return {
    prAuc: positives ? area : null,
    calibrationErrorClassified: ratio(ece, classified),
  };
}
export function confidence(
  rows: Prediction[],
  threshold: number,
  repetitions = 1000,
) {
  const groups = [...new Set(rows.map((row) => row.group))];
  const byGroup = new Map(
    groups.map((group) => [group, rows.filter((row) => row.group === group)]),
  );
  let seed = 42;
  const samples: Record<'precision' | 'recall' | 'fpr', number[]> = {
    precision: [],
    recall: [],
    fpr: [],
  };
  for (let n = 0; n < repetitions && groups.length; n++) {
    const selected: Prediction[] = [];
    for (let index = 0; index < groups.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      selected.push(
        ...byGroup.get(groups[Math.floor((seed / 2 ** 32) * groups.length)]!)!,
      );
    }
    const result = metrics(selected, threshold);
    for (const key of ['precision', 'recall', 'fpr'] as const)
      if (result[key] !== null) samples[key].push(result[key]);
  }
  const intervals = Object.fromEntries(
    Object.entries(samples).map(([key, values]) => {
      values.sort((a, b) => a - b);
      return [
        key,
        values.length
          ? [
              values[Math.floor((values.length - 1) * 0.025)],
              values[Math.ceil((values.length - 1) * 0.975)],
            ]
          : null,
      ];
    }),
  );
  const { fp, tn } = metrics(rows, threshold);
  return {
    method: 'source-group bootstrap',
    repetitions,
    seed: 42,
    intervals,
    fprWilsonUpper: wilsonFprUpper(fp, tn),
  };
}

export function wilsonFprUpper(fp: number, tn: number): number | null {
  const negatives = fp + tn;
  // A zero-FP bootstrap degenerates to [0,0]; retain a Wilson upper bound as a conservative guard.
  const z = 1.96,
    p = negatives ? fp / negatives : 0;
  return negatives
    ? (p +
        (z * z) / (2 * negatives) +
        z *
          Math.sqrt(
            (p * (1 - p)) / negatives + (z * z) / (4 * negatives ** 2),
          )) /
        (1 + (z * z) / negatives)
    : null;
}
