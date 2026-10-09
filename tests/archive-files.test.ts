import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { archiveFiles } from '../scripts/archive-files';
import { inventedArchive } from './fixtures/archive';

const content = Buffer.from('invented archive content '.repeat(20)),
  hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex'),
  fixture = () =>
    inventedArchive([{ name: 'invented.js', content, deflate: true }]);

test.each([false, true])(
  'hashes complete stored/deflated content: %s',
  (deflate) => {
    const zip = inventedArchive([
      { name: 'invented.js', content, deflate },
      { name: 'chunks/empty.js', content: Buffer.alloc(0), deflate },
    ]);
    expect(archiveFiles(zip.bytes)).toEqual({
      'invented.js': hash(content),
      'chunks/empty.js': hash(Buffer.alloc(0)),
    });
  },
);

test.each([
  '',
  '../invented.js',
  '/invented.js',
  'a/../invented.js',
  'a/./invented.js',
  'a//invented.js',
  'a\\invented.js',
  'C:/invented.js',
  'invented.js/',
  'invented.js\0',
  'invented.js\n',
  'é.js',
  'invented.js.',
  'CON.js',
  'a/NUL',
  'COM1.js',
  'Lpt9.js',
  'a'.repeat(257),
])('rejects unsafe or unsupported entry name: %j', (name) => {
  expect(() =>
    archiveFiles(inventedArchive([{ name, content }]).bytes),
  ).toThrow('Archive verification failed');
});

test.each([
  ['invented.js', 'invented.js'],
  ['Invented.js', 'invented.js'],
  ['a', 'a/invented.js'],
  ['A/invented.js', 'a'],
])(
  'rejects duplicate, case-alias or file/directory collision: %j %j',
  (first, second) => {
    expect(() =>
      archiveFiles(
        inventedArchive([
          { name: first, content },
          { name: second, content },
        ]).bytes,
      ),
    ).toThrow('Archive verification failed');
  },
);

test.each([
  [0, 4, 0],
  [6, 2, 45],
  [8, 2, 1],
  [8, 2, 8],
  [8, 2, 16],
  [10, 2, 99],
  [16, 4, 0],
  [20, 4, 0xffff_ffff],
  [24, 4, 0xffff_ffff],
  [28, 2, 0],
  [30, 2, 1],
  [32, 2, 1],
  [34, 2, 1],
  [38, 4, 0xa000_0000],
  [38, 4, 0x1000_0000],
  [38, 4, 0x10],
  [42, 4, 1],
])(
  'rejects unsupported central metadata at offset %s',
  (offset, width, value) => {
    const zip = fixture();
    if (width === 2) zip.bytes.writeUInt16LE(value, zip.central + offset);
    else zip.bytes.writeUInt32LE(value, zip.central + offset);
    expect(() => archiveFiles(zip.bytes)).toThrow(
      'Archive verification failed',
    );
  },
);

test.each([0, 4, 6, 8, 10, 14, 18, 22, 26, 28, 30])(
  'rejects local/central disagreement at offset %s',
  (offset) => {
    const zip = fixture();
    zip.bytes[offset] = zip.bytes[offset]! ^ 1;
    expect(() => archiveFiles(zip.bytes)).toThrow(
      'Archive verification failed',
    );
  },
);

test.each([
  [0, 4, 0],
  [4, 2, 1],
  [6, 2, 1],
  [8, 2, 0],
  [10, 2, 0],
  [10, 2, 1001],
  [12, 4, 0],
  [16, 4, 0],
  [20, 2, 1],
])('rejects invalid end record at offset %s', (offset, width, value) => {
  const zip = fixture(),
    end = zip.bytes.length - 22;
  if (width === 2) zip.bytes.writeUInt16LE(value, end + offset);
  else zip.bytes.writeUInt32LE(value, end + offset);
  expect(() => archiveFiles(zip.bytes)).toThrow('Archive verification failed');
});

test.each([
  'empty',
  'truncated',
  'trailing',
  'prefix',
  'too-large',
  'crc',
  'deflate-tail',
  'lying-size',
])('rejects malformed or bounded-input violation: %s', (mode) => {
  const zip = fixture();
  let bytes = zip.bytes;
  if (mode === 'empty') bytes = Buffer.alloc(0);
  if (mode === 'truncated') bytes = bytes.subarray(0, bytes.length - 1);
  if (mode === 'trailing') bytes = Buffer.concat([bytes, Buffer.from('tail')]);
  if (mode === 'prefix') bytes = Buffer.concat([Buffer.from('prefix'), bytes]);
  if (mode === 'too-large') bytes = Buffer.alloc(1_048_577);
  if (mode === 'crc') {
    bytes.writeUInt32LE(0, 14);
    bytes.writeUInt32LE(0, zip.central + 16);
  }
  if (mode === 'lying-size') {
    bytes.writeUInt32LE(1, 22);
    bytes.writeUInt32LE(1, zip.central + 24);
  }
  if (mode === 'deflate-tail') {
    const count = bytes.readUInt32LE(18) + 1;
    bytes = Buffer.concat([
      bytes.subarray(0, zip.central),
      Buffer.from([0]),
      bytes.subarray(zip.central),
    ]);
    bytes.writeUInt32LE(count, 18);
    bytes.writeUInt32LE(count, zip.central + 1 + 20);
    bytes.writeUInt32LE(zip.central + 1, bytes.length - 22 + 16);
  }
  expect(() => archiveFiles(bytes)).toThrow('Archive verification failed');
});

test('accepts the decompressed limit and rejects an aggregate overflow', () => {
  const exact = Buffer.alloc(500_000, 0x61);
  expect(
    archiveFiles(
      inventedArchive([{ name: 'invented.js', content: exact, deflate: true }])
        .bytes,
    ),
  ).toEqual({ 'invented.js': hash(exact) });
  expect(() =>
    archiveFiles(
      inventedArchive([
        { name: 'a.js', content: exact.subarray(0, 250_000), deflate: true },
        { name: 'b.js', content: Buffer.alloc(250_001), deflate: true },
      ]).bytes,
    ),
  ).toThrow('Archive verification failed');
});

test('bounds entry count and accepts at most 1000 files', () => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({
    name: `invented-${index}.js`,
    content: Buffer.alloc(0),
  }));
  expect(
    Object.keys(archiveFiles(inventedArchive(entries).bytes)),
  ).toHaveLength(1000);
  expect(() =>
    archiveFiles(
      inventedArchive([...entries, { name: 'extra.js', content }]).bytes,
    ),
  ).toThrow('Archive verification failed');
});

test('UTF-8 flag and regular Unix attributes do not change content hashes', () => {
  const zip = fixture();
  zip.bytes.writeUInt16LE(0x800, 6);
  zip.bytes.writeUInt16LE(0x800, zip.central + 8);
  zip.bytes.writeUInt32LE(0x81a4_0000, zip.central + 38);
  expect(archiveFiles(zip.bytes)).toEqual({ 'invented.js': hash(content) });
});

test('timestamp changes are permitted only when both headers agree', () => {
  const zip = fixture();
  zip.bytes.writeUInt32LE(1, 10);
  zip.bytes.writeUInt32LE(1, zip.central + 12);
  expect(archiveFiles(zip.bytes)).toEqual({ 'invented.js': hash(content) });
});
