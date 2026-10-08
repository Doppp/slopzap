import { lstat, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Development tools only. Hash packaged bytes, never browsing data.
export async function packageFiles(root) {
  const files = Object.create(null);
  let bytes = 0,
    entriesSeen = 0;
  const visit = async (directory, prefix = '', depth = 0) => {
    const directoryInfo = await lstat(directory);
    if (
      !directoryInfo.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      depth > 16
    )
      throw new Error('Invalid package tree');
    const entries = await readdir(directory, { withFileTypes: true });
    entriesSeen += entries.length;
    if (entriesSeen > 1000) throw new Error('Invalid package tree');
    for (const entry of entries.sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const path = join(directory, entry.name),
        label = `${prefix}${entry.name}`;
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Invalid package tree');
      if (info.isDirectory()) await visit(path, `${label}/`, depth + 1);
      else {
        if (!info.isFile() || info.size > 500_000 - bytes)
          throw new Error('Invalid packaged resource');
        const file = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const opened = await file.stat();
          if (
            !opened.isFile() ||
            opened.ino !== info.ino ||
            opened.dev !== info.dev ||
            opened.size !== info.size
          )
            throw new Error('Packaged resource changed');
          const buffer = Buffer.alloc(info.size + 1);
          let size = 0;
          while (size < buffer.length) {
            const result = await file.read(
              buffer,
              size,
              buffer.length - size,
              null,
            );
            if (!result.bytesRead) break;
            size += result.bytesRead;
          }
          if (size !== info.size || bytes + size > 500_000)
            throw new Error('Packaged resource changed');
          bytes += size;
          files[label] = createHash('sha256')
            .update(buffer.subarray(0, size))
            .digest('hex');
        } finally {
          await file.close();
        }
      }
    }
  };
  try {
    await visit(root);
    if (!Object.keys(files).length) throw new Error('Empty package');
    return files;
  } catch {
    throw new Error('Packaged files unavailable');
  }
}

export function packageFingerprint(files) {
  const hash = createHash('sha256');
  // Reproduce the original benchmark's directory-by-directory English sort,
  // independently of JSON property order (including integer-like filenames).
  const ordered = Object.entries(files).sort(([left], [right]) => {
    const a = left.split('/'),
      b = right.split('/');
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const difference = a[index].localeCompare(b[index], 'en');
      if (difference) return difference;
    }
    return a.length - b.length;
  });
  for (const entry of ordered) hash.update(JSON.stringify(entry) + '\n');
  return hash.digest('hex');
}
