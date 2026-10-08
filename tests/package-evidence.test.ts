import { expect, test } from 'vitest';
import { reproducibilityMatchesPackage } from '../evaluation/package-evidence';
import { readiness } from '../evaluation/readiness';

const files = {
  'invented.js': 'a'.repeat(64),
  'chunks/invented.js': 'b'.repeat(64),
};
const report = () => ({
  schemaVersion: 1,
  packagedFilesIdentical: true,
  archiveByteEqualityClaimed: false,
  files: { ...files },
});
test('exact hashes and complete file set bind reproducibility to the current package', () => {
  expect(reproducibilityMatchesPackage(report(), files)).toBe(true);
  expect(
    reproducibilityMatchesPackage(
      report(),
      Object.fromEntries(Object.entries(files).reverse()),
    ),
  ).toBe(true);
  const result = readiness(
    {},
    { reproducibility: report(), packagedFiles: files },
  );
  expect(result.checks.reproducibility).toBe(true);
  expect(result.releaseReady).toBe(false);
  expect(result.checks.classification).toBe(false);
});
test.each([
  undefined,
  {},
  [],
  { 'invented.js': files['invented.js'] },
  { ...files, 'added.js': 'c'.repeat(64) },
  { ...files, 'invented.js': 'c'.repeat(64) },
])(
  'missing, stale or incompatible current package cannot pass %#',
  (current) => {
    expect(reproducibilityMatchesPackage(report(), current)).toBe(false);
  },
);
test.each([
  undefined,
  null,
  [],
  { packagedFilesIdentical: true },
  { ...report(), schemaVersion: 2 },
  { ...report(), packagedFilesIdentical: 'true' },
  { ...report(), archiveByteEqualityClaimed: true },
  { ...report(), archiveByteEqualityClaimed: undefined },
  { ...report(), files: {} },
  { ...report(), files: [] },
  { ...report(), files: null },
  { ...report(), files: { ...files, 'extra.js': 'c'.repeat(64) } },
])('malformed or incomplete reproduction report cannot pass %#', (value) => {
  expect(reproducibilityMatchesPackage(value, files)).toBe(false);
});
test.each([
  { 'invented.js': 'bad-hash' },
  { 'invented.js': 'A'.repeat(64) },
  { 'invented.js': 42 },
  { '../invented.js': 'a'.repeat(64) },
  { '/invented.js': 'a'.repeat(64) },
  { 'chunks//invented.js': 'a'.repeat(64) },
  { './invented.js': 'a'.repeat(64) },
  { 'chunks\\invented.js': 'a'.repeat(64) },
  { '': 'a'.repeat(64) },
  { ['x'.repeat(4097)]: 'a'.repeat(64) },
  Object.fromEntries(
    Array.from({ length: 1001 }, (_, index) => [
      `invented-${index}.js`,
      'a'.repeat(64),
    ]),
  ),
])('even matching malformed hash maps cannot become evidence %#', (invalid) => {
  expect(
    reproducibilityMatchesPackage({ ...report(), files: invalid }, invalid),
  ).toBe(false);
});
test('a naked flag no longer satisfies release readiness', () => {
  expect(
    readiness({}, { reproducibility: { packagedFilesIdentical: true } }).checks
      .reproducibility,
  ).toBe(false);
});
test('prototype-like file names require own entries and never inherit a hash', () => {
  const current = JSON.parse('{"__proto__":"' + 'a'.repeat(64) + '"}');
  expect(
    reproducibilityMatchesPackage({ ...report(), files: current }, current),
  ).toBe(true);
  expect(
    reproducibilityMatchesPackage({ ...report(), files: {} }, current),
  ).toBe(false);
});
