import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertManifestPolicy,
  PACKAGED_ENTRYPOINTS,
} from './manifest-policy.mjs';
const root = '.output/chrome-mv3';
if (!(await lstat(join(root, 'manifest.json'))).isFile())
  throw new Error('Unexpected packaged manifest');
const manifest = JSON.parse(
  await readFile(join(root, 'manifest.json'), 'utf8'),
);
assertManifestPolicy(manifest);
for (const entry of PACKAGED_ENTRYPOINTS) {
  const file = await lstat(join(root, entry)).catch(() => null);
  if (!file?.isFile()) throw new Error(`Missing packaged entrypoint: ${entry}`);
}
async function size(dir) {
  let bytes = 0;
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Unexpected packaged symlink');
    bytes += info.isDirectory() ? await size(path) : info.size;
  }
  return bytes;
}
const bytes = await size(root);
if (bytes > 500_000) throw new Error(`Bundle exceeds 500 KB: ${bytes}`);
console.log(
  `MV3 permissions checked; packaged size ${(bytes / 1024).toFixed(1)} KiB`,
);
