import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
const root = '.output/chrome-mv3';
const manifest = JSON.parse(
  await readFile(join(root, 'manifest.json'), 'utf8'),
);
if (
  manifest.manifest_version !== 3 ||
  manifest.permissions.some((p) => !['storage'].includes(p))
)
  throw new Error('Unexpected extension permissions');
if (JSON.stringify(manifest).includes('<all_urls>'))
  throw new Error('Broad host permission');
const allowed = new Set([
  'https://www.reddit.com/*',
  'https://www.youtube.com/*',
  'https://www.linkedin.com/*',
  'https://x.com/*',
  'https://twitter.com/*',
  'https://medium.com/*',
]);
for (const script of manifest.content_scripts ?? []) {
  if (script.matches.some((match) => !allowed.has(match)) || script.all_frames)
    throw new Error('Unexpected content-script access');
}
if (
  manifest.host_permissions?.length ||
  manifest.web_accessible_resources?.length
)
  throw new Error('Unexpected privileged network or page-accessible resources');
async function size(dir) {
  let bytes = 0;
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await stat(path);
    bytes += info.isDirectory() ? await size(path) : info.size;
  }
  return bytes;
}
const bytes = await size(root);
if (bytes > 500_000) throw new Error(`Bundle exceeds 500 KB: ${bytes}`);
console.log(
  `MV3 permissions checked; packaged size ${(bytes / 1024).toFixed(1)} KiB`,
);
