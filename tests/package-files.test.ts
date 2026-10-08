import { expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageFiles, packageFingerprint } from '../scripts/package-files.mjs';

const digest = (text: string | Buffer) =>
  createHash('sha256').update(text).digest('hex');
test('fingerprint ignores map order and preserves directory and numeric-name ordering', () => {
  const entries: [string, string][] = [
    ['10', digest('ten')],
    ['2', digest('two')],
    ['a/z.js', digest('nested')],
    ['a.js', digest('root')],
  ];
  const expected = digest(
    entries.map((entry) => JSON.stringify(entry) + '\n').join(''),
  );
  expect(packageFingerprint(Object.fromEntries(entries))).toBe(expected);
  expect(packageFingerprint(Object.fromEntries(entries.reverse()))).toBe(
    expected,
  );
});
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'slopzap-package-test-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('shared scanner preserves ordered benchmark fingerprint and hashes exact packaged bytes', async () => {
  await fixture(async (root) => {
    await mkdir(join(root, 'chunks'));
    await writeFile(join(root, 'chunks', 'invented.js'), 'invented script');
    await writeFile(join(root, 'manifest.json'), '{}');
    const files = await packageFiles(root);
    expect(files).toEqual({
      'chunks/invented.js': digest('invented script'),
      'manifest.json': digest('{}'),
    });
    expect(packageFingerprint(files)).toBe(
      digest(
        JSON.stringify(['chunks/invented.js', digest('invented script')]) +
          '\n' +
          JSON.stringify(['manifest.json', digest('{}')]) +
          '\n',
      ),
    );
    expect(packageFingerprint(await packageFiles(root))).toBe(
      packageFingerprint(files),
    );
    await writeFile(join(root, 'chunks', 'invented.js'), 'changed fixture');
    expect(packageFingerprint(await packageFiles(root))).not.toBe(
      packageFingerprint(files),
    );
  });
});
test('missing, empty and non-directory package roots fail with controlled errors', async () => {
  await fixture(async (root) => {
    await expect(packageFiles(root)).rejects.toThrow(
      'Packaged files unavailable',
    );
    await expect(packageFiles(join(root, 'missing'))).rejects.toThrow(
      'Packaged files unavailable',
    );
    await writeFile(join(root, 'invented.js'), 'invented');
    await expect(packageFiles(join(root, 'invented.js'))).rejects.toThrow(
      'Packaged files unavailable',
    );
  });
});
test.each(['root', 'file', 'directory', 'dangling'])(
  'symlink %s is never followed',
  async (kind) => {
    await fixture(async (root) => {
      await mkdir(join(root, 'package'));
      await mkdir(join(root, 'other'));
      await writeFile(
        join(root, 'other', 'invented.js'),
        'invented external bytes',
      );
      const link =
        kind === 'root'
          ? join(root, 'root-link')
          : join(root, 'package', 'link');
      const target =
        kind === 'file'
          ? join(root, 'other', 'invented.js')
          : kind === 'dangling'
            ? join(root, 'missing')
            : join(root, 'other');
      await symlink(target, link);
      await expect(
        packageFiles(kind === 'root' ? link : join(root, 'package')),
      ).rejects.toThrow('Packaged files unavailable');
    });
  },
);
test.skipIf(process.platform === 'win32')(
  'non-regular FIFO fails without opening a blocking reader',
  async () => {
    await fixture(async (root) => {
      execFileSync('mkfifo', [join(root, 'invented-pipe')]);
      await expect(packageFiles(root)).rejects.toThrow(
        'Packaged files unavailable',
      );
    });
  },
);
test('500,000-byte boundary accepts exact limit and rejects oversized total', async () => {
  await fixture(async (root) => {
    await writeFile(join(root, 'empty.js'), '');
    expect(await packageFiles(root)).toEqual({ 'empty.js': digest('') });
    await rm(join(root, 'empty.js'));
    const bytes = Buffer.alloc(500_000);
    await writeFile(join(root, 'invented.bin'), bytes);
    expect(await packageFiles(root)).toEqual({ 'invented.bin': digest(bytes) });
    await writeFile(join(root, 'extra.js'), 'x');
    await expect(packageFiles(root)).rejects.toThrow(
      'Packaged files unavailable',
    );
    await rm(join(root, 'extra.js'));
    await writeFile(join(root, 'invented.bin'), Buffer.alloc(500_001));
    await expect(packageFiles(root)).rejects.toThrow(
      'Packaged files unavailable',
    );
  });
});
test('traversal depth and entry count are bounded', async () => {
  await fixture(async (root) => {
    let nested = root;
    for (let depth = 0; depth < 17; depth++) {
      nested = join(nested, 'nested');
      await mkdir(nested);
    }
    await writeFile(join(nested, 'invented.js'), 'invented');
    await expect(packageFiles(root)).rejects.toThrow(
      'Packaged files unavailable',
    );
  });
  await fixture(async (root) => {
    await Promise.all(
      Array.from({ length: 1001 }, (_, index) =>
        writeFile(join(root, `invented-${index}.js`), ''),
      ),
    );
    await expect(packageFiles(root)).rejects.toThrow(
      'Packaged files unavailable',
    );
  });
});
test('prototype-like file names remain ordinary own hash-map keys', async () => {
  await fixture(async (root) => {
    await writeFile(join(root, '__proto__'), 'invented');
    const files = await packageFiles(root);
    expect(Object.keys(files)).toEqual(['__proto__']);
    expect(files['__proto__']).toBe(digest('invented'));
  });
});
