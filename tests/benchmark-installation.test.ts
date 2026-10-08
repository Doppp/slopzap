import { expect, test } from 'vitest';
import { installationEvidence } from '../scripts/benchmark-installation.mjs';

test('absence uses an empty unpacked registry, not total built-in target counts', () => {
  expect(installationEvidence({ extensions: [] })).toEqual({
    unpackedExtensionCount: 0,
    packagedExtensionRegistered: false,
  });
});
test('installed evidence requires exact package path, ID and enabled state without exporting them', () => {
  const response = {
    extensions: [
      {
        id: 'invented-id',
        path: '/invented/package',
        enabled: true,
        name: 'Invented extension',
      },
    ],
  };
  expect(
    installationEvidence(response, 'invented-id', '/invented/package'),
  ).toEqual({ unpackedExtensionCount: 1, packagedExtensionRegistered: true });
  expect(
    installationEvidence(response, 'other', '/invented/package')
      .packagedExtensionRegistered,
  ).toBe(false);
  expect(
    installationEvidence(response, 'invented-id', '/other/package')
      .packagedExtensionRegistered,
  ).toBe(false);
  expect(
    installationEvidence(
      {
        extensions: [
          { id: 'invented-id', path: '/invented/package', enabled: false },
        ],
      },
      'invented-id',
      '/invented/package',
    ).packagedExtensionRegistered,
  ).toBe(false);
});
test.each([
  undefined,
  null,
  {},
  { extensions: null },
  { extensions: [null] },
  { extensions: [{ id: 'a', path: '/invented', enabled: 'true' }] },
])(
  'missing/malformed installation evidence fails instead of becoming an empty list %#',
  (value) => {
    expect(() => installationEvidence(value)).toThrow(
      'Extension installation evidence unavailable',
    );
  },
);
