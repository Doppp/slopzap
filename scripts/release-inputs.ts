import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const MAX_RELEASE_JSON_BYTES = 1_048_576;

function sameFile(left: Stats, right: Stats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

export function releaseEvidence(root = process.cwd()) {
  return readJson('docs/release-evidence.json', root);
}

export async function releaseArtifact(
  path: unknown,
  root = process.cwd(),
): Promise<Record<string, unknown> | undefined> {
  if (
    typeof path !== 'string' ||
    path.length > 256 ||
    !/^(\.output\/verification|\.output\/benchmarks|evaluation\/reports)\/[a-zA-Z0-9_.-]+\.json$/.test(
      path,
    )
  )
    return undefined;
  return readJson(path, root);
}

// Development evidence only, not corpus ingestion or a filesystem sandbox.
async function readJson(
  path: string,
  root: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    let directory = resolve(root);
    const parents: { path: string; info: Stats }[] = [];
    const parts = path.split('/');
    for (const part of ['', ...parts.slice(0, -1)]) {
      if (part) directory = join(directory, part);
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return undefined;
      parents.push({ path: directory, info });
    }
    const filename = join(directory, parts.at(-1)!),
      info = await lstat(filename);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size < 1 ||
      info.size > MAX_RELEASE_JSON_BYTES
    )
      return undefined;
    const file = await open(
      filename,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (!sameFile(info, await file.stat())) return undefined;
      // One sentinel byte detects growth; no readFile allocation or FIFO wait.
      const buffer = Buffer.alloc(info.size + 1);
      let size = 0;
      while (size < buffer.length) {
        const chunk = await file.read(buffer, size, buffer.length - size, null);
        if (!chunk.bytesRead) break;
        size += chunk.bytesRead;
      }
      if (
        size !== info.size ||
        !sameFile(info, await file.stat()) ||
        !sameFile(info, await lstat(filename))
      )
        return undefined;
      for (const parent of parents) {
        const current = await lstat(parent.path);
        if (
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          current.dev !== parent.info.dev ||
          current.ino !== parent.info.ino
        )
          return undefined;
      }
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          buffer.subarray(0, size),
        ),
      );
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } finally {
      await file.close();
    }
  } catch {
    // Do not export parser excerpts, OS paths or arbitrary exception messages.
    return undefined;
  }
}
