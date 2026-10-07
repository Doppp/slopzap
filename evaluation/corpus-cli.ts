import { readFile, writeFile } from 'node:fs/promises';
import { corpus } from './schema';
import { parseModel, train } from './model';
import { report } from './report';
import { resolve } from 'node:path';
const json = (source: string): unknown => {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('Invalid JSON; source content omitted');
  }
};
const [command, path, output] = process.argv.slice(2);
if (!path || !['evaluate', 'train'].includes(command ?? ''))
  throw new Error(
    'Usage: corpus-cli.ts evaluate corpus.jsonl [model.json] | train corpus.jsonl output.json',
  );
const source = await readFile(path, 'utf8');
if (source.length > 64 * 1024 * 1024) throw new Error('Corpus exceeds 64 MiB');
const rows = corpus(
  path.endsWith('.jsonl')
    ? source
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map(json)
    : json(source),
);
if (command === 'train') {
  if (!output) throw new Error('An experimental output model path is required');
  if (resolve(output) === resolve(path))
    throw new Error('Model output cannot overwrite the corpus');
  const model = train(rows);
  await writeFile(output, JSON.stringify(model, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      version: model.version,
      trainSamples: model.trainSamples,
      validationSamples: model.validationSamples,
      automaticHide: false,
    }),
  );
} else {
  const model = output
    ? parseModel(json(await readFile(output, 'utf8')))
    : undefined;
  const result = report(rows, model);
  console.log(JSON.stringify(result, null, 2));
  if (!result.statisticalGatesPass) process.exitCode = 1;
}
