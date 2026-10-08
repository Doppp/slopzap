import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertManifestPolicy,
  CONTENT_MATCHES,
  PACKAGED_ENTRYPOINTS,
} from '../scripts/manifest-policy.mjs';

function manifest() {
  return {
    manifest_version: 3,
    permissions: ['storage'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none';",
    },
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html' },
    options_ui: { page: 'options.html', open_in_tab: false },
    content_scripts: [
      {
        matches: [...CONTENT_MATCHES],
        run_at: 'document_idle',
        js: ['content-scripts/content.js'],
      },
    ],
  };
}

test('reviewed static isolated-world wiring accepts every supported origin', () => {
  const valid = manifest();
  valid.content_scripts[0]!.matches.reverse();
  expect(() => assertManifestPolicy(valid)).not.toThrow();
  expect(() =>
    assertManifestPolicy({
      ...valid,
      host_permissions: [],
      optional_permissions: [],
      optional_host_permissions: [],
      web_accessible_resources: [],
    }),
  ).not.toThrow();
});

test.each([
  ['unreviewed devtools context', { devtools_page: 'devtools.html' }],
  ['unreviewed sandbox context', { sandbox: { pages: ['sandbox.html'] } }],
  [
    'unreviewed credential config',
    { oauth2: { client_id: 'invented', scopes: [] } },
  ],
  ['missing content script', { content_scripts: [] }],
  [
    'duplicate content script',
    {
      content_scripts: [
        ...manifest().content_scripts,
        ...manifest().content_scripts,
      ],
    },
  ],
  ['missing storage', { permissions: [] }],
  ['extra permission', { permissions: ['storage', 'tabs'] }],
  ['duplicate permission', { permissions: ['storage', 'storage'] }],
  [
    'host network access',
    { host_permissions: ['https://api.example.invalid/*'] },
  ],
  ['optional access', { optional_host_permissions: ['<all_urls>'] }],
  [
    'page-accessible resource',
    {
      web_accessible_resources: [
        { resources: ['background.js'], matches: ['<all_urls>'] },
      ],
    },
  ],
  ['external connection', { externally_connectable: null }],
  [
    'unpackaged worker',
    { background: { service_worker: 'https://example.invalid/worker.js' } },
  ],
  [
    'unreviewed worker context',
    { background: { service_worker: 'background.js', type: 'module' } },
  ],
  ['missing popup', { action: {} }],
  ['missing Settings', { options_ui: {} }],
  [
    'weakened CSP',
    {
      content_security_policy: {
        extension_pages: "script-src 'self' 'unsafe-eval'; object-src 'none';",
      },
    },
  ],
])('build rejects %s', (_, patch) => {
  expect(() => assertManifestPolicy({ ...manifest(), ...patch })).toThrow();
});

test.each([
  ['missing origin', { matches: CONTENT_MATCHES.slice(1) }],
  ['broad origin', { matches: ['<all_urls>'] }],
  ['duplicate origin', { matches: [...CONTENT_MATCHES, CONTENT_MATCHES[0]] }],
  ['unpackaged script', { js: ['https://example.invalid/script.js'] }],
  ['early injection', { run_at: 'document_start' }],
  ['main world', { world: 'MAIN' }],
  ['frames', { all_frames: true }],
  ['inherited origin', { match_origin_as_fallback: true }],
  ['blank frames', { match_about_blank: true }],
])('content script rejects %s', (_, patch) => {
  const valid = manifest();
  expect(() =>
    assertManifestPolicy({
      ...valid,
      content_scripts: [{ ...valid.content_scripts[0], ...patch }],
    }),
  ).toThrow();
});

const buildCheck = resolve('scripts/check-build.mjs');
function packageFixture(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'slopzap-build-policy-'));
  try {
    const output = join(directory, '.output/chrome-mv3');
    for (const entry of [...PACKAGED_ENTRYPOINTS, 'manifest.json']) {
      const path = join(output, entry);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        entry === 'manifest.json'
          ? JSON.stringify(manifest())
          : '// invented policy fixture',
      );
    }
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function checkPackage(directory: string) {
  return execFileSync(process.execPath, [buildCheck], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('build integration accepts complete wiring and retains the package-size budget', () => {
  expect(PACKAGED_ENTRYPOINTS).toHaveLength(7);
  packageFixture((directory) => {
    expect(checkPackage(directory)).toContain('MV3 permissions checked');
    writeFileSync(
      join(directory, '.output/chrome-mv3/invented-padding.bin'),
      Buffer.alloc(500_001),
    );
    expect(() => checkPackage(directory)).toThrow('Bundle exceeds 500 KB');
  });
});

test.each(PACKAGED_ENTRYPOINTS)('build fails when %s is absent', (entry) => {
  packageFixture((directory) => {
    unlinkSync(join(directory, '.output/chrome-mv3', entry));
    expect(() => checkPackage(directory)).toThrow(
      `Missing packaged entrypoint: ${entry}`,
    );
  });
});

test('package scanning rejects symlinks without following their targets', () => {
  packageFixture((directory) => {
    const output = join(directory, '.output/chrome-mv3');
    symlinkSync('invented-cycle', join(output, 'invented-cycle'));
    expect(() => checkPackage(directory)).toThrow(
      'Unexpected packaged symlink',
    );
    unlinkSync(join(output, 'invented-cycle'));
    unlinkSync(join(output, 'manifest.json'));
    symlinkSync('background.js', join(output, 'manifest.json'));
    expect(() => checkPackage(directory)).toThrow(
      'Unexpected packaged manifest',
    );
  });
});
