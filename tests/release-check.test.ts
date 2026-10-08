import { expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve('node_modules/tsx/dist/cli.mjs'),
  script = resolve('scripts/release-check.ts');
test.each(['matching', 'modified', 'missing', 'added', 'symlink'])(
  'release CLI rejects incompatible package evidence: %s',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'slopzap-release-check-test-'));
    try {
      const packageRoot = join(root, '.output', 'chrome-mv3');
      await mkdir(packageRoot, { recursive: true });
      await mkdir(join(root, '.output', 'verification'));
      await mkdir(join(root, 'docs'));
      const content = 'invented-private-marker-not-to-export';
      const path = join(packageRoot, 'invented.js');
      await writeFile(path, content);
      await writeFile(
        join(root, 'docs', 'release-evidence.json'),
        JSON.stringify({
          schemaVersion: 1,
          reproducibility: '.output/verification/reproducibility.json',
        }),
      );
      await writeFile(
        join(root, '.output', 'verification', 'reproducibility.json'),
        JSON.stringify({
          schemaVersion: 1,
          packagedFilesIdentical: true,
          archiveByteEqualityClaimed: false,
          files: {
            'invented.js': createHash('sha256').update(content).digest('hex'),
          },
        }),
      );
      if (mode === 'modified') await writeFile(path, 'changed invented bytes');
      if (mode === 'missing') await rm(path);
      if (mode === 'added')
        await writeFile(join(packageRoot, 'added.js'), 'invented addition');
      if (mode === 'symlink') {
        const external = join(root, 'external-invented.txt');
        await writeFile(external, content);
        await rm(path);
        await symlink(external, path);
      }
      const result = spawnSync(process.execPath, [cli, script], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(result.status).toBe(1); // Other independent/manual gates remain unmet.
      const output = JSON.parse(result.stdout);
      expect(output.checks.reproducibility).toBe(mode === 'matching');
      expect(output.releaseReady).toBe(false);
      expect(output.missing.includes('reproducibility')).toBe(
        mode !== 'matching',
      );
      expect(result.stdout).not.toContain(content);
      expect(result.stdout).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
