import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
async function hashes(root) {
  const values = {};
  async function walk(path = '') {
    for (const entry of await readdir(join(root, path), {
      withFileTypes: true,
    })) {
      const relative = join(path, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else
        values[relative] = createHash('sha256')
          .update(await readFile(join(root, relative)))
          .digest('hex');
    }
  }
  await walk();
  return Object.fromEntries(
    Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
  );
}
const build = () => {
  const result = spawnSync('pnpm', ['build'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Reproducibility build failed');
};
build();
const first = await hashes('.output/chrome-mv3');
build();
const second = await hashes('.output/chrome-mv3');
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
