import { readFile } from 'node:fs/promises';
import { readiness } from '../evaluation/readiness';
import { packageFiles } from './package-files.mjs';
const evidence = JSON.parse(
  await readFile('docs/release-evidence.json', 'utf8'),
);
async function artifact(
  path: unknown,
): Promise<Record<string, unknown> | undefined> {
  if (
    typeof path !== 'string' ||
    !/^(\.output\/verification|\.output\/benchmarks|evaluation\/reports)\/[a-zA-Z0-9_.-]+\.json$/.test(
      path,
    )
  )
    return undefined;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}
const classification = await artifact(evidence.classification?.report),
  benchmark = await artifact(evidence.performance?.report),
  reproducibility = await artifact(evidence.reproducibility);
const packagedFiles = await packageFiles('.output/chrome-mv3').catch(
  () => undefined,
);
const result = readiness(evidence, {
  ...(classification ? { classification } : {}),
  ...(benchmark ? { benchmark } : {}),
  ...(reproducibility ? { reproducibility } : {}),
  ...(packagedFiles ? { packagedFiles } : {}),
});
console.log(JSON.stringify(result, null, 2));
if (!result.releaseReady) process.exitCode = 1;
