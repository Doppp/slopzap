import { beforeEach, expect, test, vi } from 'vitest';
import { constants } from 'node:fs';
import { join } from 'node:path';
const fs = vi.hoisted(() => ({
  lstat: vi.fn(),
  open: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ lstat: fs.lstat, open: fs.open }));
import {
  releaseArtifact,
  boundedReleaseBytes,
} from '../scripts/release-inputs';

const path = '.output/verification/invented.json',
  root = '/invented-root',
  bytes = Buffer.from('{"value":"invented 🙂"}'),
  regular = {
    isFile: () => true,
    isSymbolicLink: () => false,
    dev: 1,
    ino: 2,
    size: bytes.length,
    mtimeMs: 10,
    ctimeMs: 10,
  },
  directory = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    dev: 1,
    ino: 3,
  };

beforeEach(() => {
  vi.resetAllMocks();
  fs.lstat.mockImplementation(async (filename: string) =>
    filename.endsWith('.json') ? regular : directory,
  );
  fs.stat.mockResolvedValue(regular);
  fs.open.mockResolvedValue({ stat: fs.stat, read: fs.read, close: fs.close });
  fs.close.mockResolvedValue(undefined);
  let cursor = 0;
  fs.read.mockImplementation(
    async (buffer: Buffer, offset: number, length: number) => {
      const count = Math.min(length, bytes.length - cursor);
      bytes.copy(buffer, offset, cursor, cursor + count);
      cursor += count;
      return { bytesRead: count };
    },
  );
});

test('opens read-only with final-link and blocking protection; closes once', async () => {
  expect(await releaseArtifact(path, root)).toEqual({ value: 'invented 🙂' });
  expect(fs.open).toHaveBeenCalledWith(
    join(root, path),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  expect(fs.close).toHaveBeenCalledTimes(1);
  expect(fs.read.mock.calls[0]![0].length).toBe(bytes.length + 1);
});

test.each(['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'nonregular'])(
  'rejects changed opened file before reading: %s',
  async (field) => {
    fs.stat.mockResolvedValue({
      ...regular,
      ...(field === 'nonregular' ? { isFile: () => false } : { [field]: 999 }),
    });
    expect(await releaseArtifact(path, root)).toBeUndefined();
    expect(fs.read).not.toHaveBeenCalled();
    expect(fs.close).toHaveBeenCalledTimes(1);
  },
);

test.each(['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'nonregular'])(
  'rejects file mutation after reading: %s',
  async (field) => {
    fs.stat.mockResolvedValueOnce(regular).mockResolvedValue({
      ...regular,
      ...(field === 'nonregular' ? { isFile: () => false } : { [field]: 999 }),
    });
    expect(await releaseArtifact(path, root)).toBeUndefined();
    expect(fs.close).toHaveBeenCalledTimes(1);
  },
);

test.each(['truncated', 'growing'])(
  'rejects byte count mismatch with bounded sentinel: %s',
  async (mode) => {
    fs.read.mockImplementation(
      async (buffer: Buffer, offset: number, length: number) => {
        if (offset) return { bytesRead: 0 };
        const count =
          mode === 'truncated' ? bytes.length - 1 : bytes.length + 1;
        expect(length).toBe(bytes.length + 1);
        buffer.fill(0x20, 0, count);
        return { bytesRead: count };
      },
    );
    expect(await releaseArtifact(path, root)).toBeUndefined();
    expect(fs.close).toHaveBeenCalledTimes(1);
  },
);

test.each(['file-replaced', 'file-linked', 'parent-replaced', 'parent-linked'])(
  'rejects path change during read: %s',
  async (mode) => {
    let fileReads = 0,
      parentReads = 0;
    fs.lstat.mockImplementation(async (filename: string) => {
      if (filename.endsWith('.json')) {
        if (++fileReads > 1 && mode === 'file-replaced')
          return { ...regular, ino: 99 };
        if (fileReads > 1 && mode === 'file-linked')
          return {
            ...regular,
            isFile: () => false,
            isSymbolicLink: () => true,
          };
        return regular;
      }
      if (filename === join(root, '.output')) {
        if (++parentReads > 1 && mode === 'parent-replaced')
          return { ...directory, ino: 99 };
        if (parentReads > 1 && mode === 'parent-linked')
          return { ...directory, isSymbolicLink: () => true };
      }
      return directory;
    });
    expect(await releaseArtifact(path, root)).toBeUndefined();
    expect(fs.close).toHaveBeenCalledTimes(1);
  },
);

test.each(['read', 'stat', 'close', 'open'])(
  'filesystem errors remain unavailable without logging: %s',
  async (operation) => {
    const log = vi.spyOn(console, 'log'),
      error = vi.spyOn(console, 'error');
    try {
      fs[operation as 'read' | 'stat' | 'close' | 'open'].mockRejectedValue(
        new Error('invented-private-file-error'),
      );
      expect(await releaseArtifact(path, root)).toBeUndefined();
      expect(fs.close).toHaveBeenCalledTimes(operation === 'open' ? 0 : 1);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  },
);

test('partial reads preserve UTF-8 across chunk boundaries', async () => {
  let cursor = 0;
  fs.read.mockImplementation(
    async (buffer: Buffer, offset: number, length: number) => {
      const count = Math.min(1, length, bytes.length - cursor);
      bytes.copy(buffer, offset, cursor, cursor + count);
      cursor += count;
      return { bytesRead: count };
    },
  );
  expect(await releaseArtifact(path, root)).toEqual({ value: 'invented 🙂' });
  expect(fs.close).toHaveBeenCalledTimes(1);
});

test('unapproved paths do not issue filesystem operations', async () => {
  expect(
    await releaseArtifact('docs/release-evidence.json', root),
  ).toBeUndefined();
  expect(fs.lstat).not.toHaveBeenCalled();
  expect(fs.open).not.toHaveBeenCalled();
});

test.each([0, -1, 1.5, NaN, Infinity, 1_048_577])(
  'binary reader rejects invalid byte limits before filesystem access: %s',
  async (limit) => {
    expect(await boundedReleaseBytes(path, root, limit)).toBeUndefined();
    expect(fs.lstat).not.toHaveBeenCalled();
  },
);
test.each([
  '../invented.zip',
  '/invented.zip',
  'a//invented.zip',
  'a\\invented.zip',
  'a/./invented.zip',
])(
  'binary reader rejects unsafe paths before filesystem access: %s',
  async (path) => {
    expect(await boundedReleaseBytes(path, root, 100)).toBeUndefined();
    expect(fs.lstat).not.toHaveBeenCalled();
  },
);
