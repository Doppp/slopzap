import { expect, test } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  rename,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { inventedArchive } from './fixtures/archive';
import {
  CONTENT_MATCHES,
  PACKAGED_ENTRYPOINTS,
} from '../scripts/manifest-policy.mjs';
import { reproducibilityMatchesPackage } from '../evaluation/package-evidence';

const cli = resolve('node_modules/tsx/dist/cli.mjs'),
  script = resolve('scripts/archive-check.ts'),
  canary = 'invented-private-archive-content';
const modes = [
  'matching',
  'extra',
  'missing-file',
  'modified',
  'missing-archive',
  'linked-archive',
  'linked-output',
  'oversized-archive',
  'stale-reproduction',
  'missing-reproduction',
  'linked-reproduction',
  'wrong-version',
  'bad-version',
  'null-manifest',
  'malformed-manifest',
  'extra-permission',
  'missing-entrypoint',
];

async function verify(mode: string) {
  const root = await mkdtemp(join(tmpdir(), 'slopzap-archive-check-test-'));
  try {
    await mkdir(join(root, '.output', 'verification'), { recursive: true });
    const manifest = {
      manifest_version: 3,
      version: mode === 'bad-version' ? '../invented' : '0.1.0',
      permissions:
        mode === 'extra-permission' ? ['storage', 'tabs'] : ['storage'],
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'none';",
      },
      background: { service_worker: 'background.js' },
      action: { default_popup: 'popup.html' },
      options_ui: { page: 'options.html', open_in_tab: false },
      content_scripts: [
        {
          matches: CONTENT_MATCHES,
          run_at: 'document_idle',
          js: ['content-scripts/content.js'],
        },
      ],
    };
    let entries = [
      ...PACKAGED_ENTRYPOINTS.map((name) => ({
        name,
        content: Buffer.from(canary),
      })),
      {
        name: 'manifest.json',
        content: Buffer.from(
          mode === 'null-manifest'
            ? 'null'
            : mode === 'malformed-manifest'
              ? `{"${canary}":`
              : JSON.stringify(manifest),
        ),
      },
    ];
    if (mode === 'missing-entrypoint')
      entries = entries.filter((entry) => entry.name !== 'background.js');
    const hashes: Record<string, string> = {};
    for (const entry of entries) {
      const file = join(root, '.output', 'chrome-mv3', entry.name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, entry.content);
      hashes[entry.name] = createHash('sha256')
        .update(entry.content)
        .digest('hex');
    }
    if (mode === 'extra')
      entries.push({ name: 'unreviewed.js', content: Buffer.from(canary) });
    if (mode === 'missing-file')
      entries = entries.filter((entry) => entry.name !== 'popup.html');
    if (mode === 'modified')
      entries[0] = {
        name: entries[0]!.name,
        content: Buffer.from('changed invented content'),
      };
    const artifact = join(
        root,
        '.output',
        `slopzap-${mode === 'wrong-version' ? '0.2.0' : '0.1.0'}-chrome.zip`,
      ),
      reproduction = join(
        root,
        '.output',
        'verification',
        'reproducibility.json',
      ),
      output = join(root, 'github-output');
    await writeFile(output, '');
    await writeFile(
      artifact,
      mode === 'oversized-archive'
        ? Buffer.alloc(1_048_577)
        : inventedArchive(entries).bytes,
    );
    if (mode === 'missing-archive') await rm(artifact);
    if (mode === 'stale-reproduction') hashes['manifest.json'] = 'b'.repeat(64);
    await writeFile(
      reproduction,
      JSON.stringify({
        schemaVersion: 1,
        packagedFilesIdentical: true,
        archiveByteEqualityClaimed: false,
        files: hashes,
      }),
    );
    if (mode === 'missing-reproduction') await rm(reproduction);
    if (mode === 'linked-archive' || mode === 'linked-reproduction') {
      const target = mode === 'linked-archive' ? artifact : reproduction,
        external = join(root, 'external-invented');
      await writeFile(external, await readFile(target));
      await rm(target);
      await symlink(external, target);
    }
    if (mode === 'linked-output') {
      const external = join(root, 'external-output');
      await rename(join(root, '.output'), external);
      await symlink(external, join(root, '.output'));
    }
    if (mode === 'fifo-archive') {
      await rm(artifact);
      expect(spawnSync('mkfifo', [artifact]).status).toBe(0);
    }
    const result = spawnSync(process.execPath, [cli, script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5_000,
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(mode === 'matching' ? 0 : 1);
    expect(result.stderr).toBe('');
    const summary = JSON.parse(result.stdout);
    expect(summary.archiveVerified).toBe(mode === 'matching');
    expect(summary.releaseReady).toBe(false);
    expect(result.stdout + result.stderr).not.toContain(canary);
    expect(result.stdout + result.stderr).not.toContain(root);
    const handedOff = await readFile(output, 'utf8');
    if (mode === 'matching') {
      expect(handedOff).toBe('path=.output/slopzap-0.1.0-chrome.zip\n');
      const report = JSON.parse(
        await readFile(
          join(root, '.output', 'verification', 'archive.json'),
          'utf8',
        ),
      );
      expect(report).toEqual(summary);
      expect(report.files).toEqual(hashes);
      expect(report.archiveSha256).toBe(
        createHash('sha256')
          .update(await readFile(artifact))
          .digest('hex'),
      );
      expect(report.archiveByteEqualityClaimed).toBe(false);
      expect(reproducibilityMatchesPackage(report, hashes)).toBe(false);
    } else {
      expect(handedOff).toBe('');
      expect(summary.error).toBe('archive_verification_failed');
      await expect(
        readFile(join(root, '.output', 'verification', 'archive.json')),
      ).rejects.toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test.each(modes)('archive CLI verifies exact package handoff: %s', verify);
test.skipIf(process.platform === 'win32')(
  'archive CLI rejects a FIFO without waiting',
  async () => verify('fifo-archive'),
);

test('CI uploads only the verified archive output, after verification', async () => {
  const workflow = await readFile('.github/workflows/check.yml', 'utf8');
  expect(workflow).toContain('id: archive');
  expect(workflow).toContain('path: ${{ steps.archive.outputs.path }}');
  expect(workflow).not.toContain('path: .output/*.zip');
  expect(workflow.indexOf('run: pnpm archive:check')).toBeGreaterThan(
    workflow.indexOf('run: pnpm zip'),
  );
  expect(workflow.indexOf('run: pnpm archive:check')).toBeLessThan(
    workflow.indexOf('name: slopzap-chrome-alpha'),
  );
});
