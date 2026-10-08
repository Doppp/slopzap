import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { packageFiles } from './package-files.mjs';
const build = () => {
  const result = spawnSync('pnpm', ['build'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Reproducibility build failed');
};
build();
const first = await packageFiles('.output/chrome-mv3');
build();
const second = await packageFiles('.output/chrome-mv3');
if (JSON.stringify(first) !== JSON.stringify(second))
  throw new Error('Packaged file hashes differ across identical builds');
await mkdir('.output/verification', { recursive: true });
await writeFile(
  '.output/verification/reproducibility.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      packagedFilesIdentical: true,
      archiveByteEqualityClaimed: false,
      files: second,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Reproducible packaged files: ${Object.keys(second).length}; ZIP metadata excluded from claim`,
);
