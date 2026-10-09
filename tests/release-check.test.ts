import { expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inventedPerformanceReport } from './fixtures/performance-evidence';

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

test.each(['reviewed', 'stale', 'legacy', 'short', 'missing-control'])(
  'release CLI validates reviewed performance artifact: %s',
  async (mode) => {
    const root = await mkdtemp(
      join(tmpdir(), 'slopzap-performance-check-test-'),
    );
    try {
      await mkdir(join(root, '.output', 'chrome-mv3'), { recursive: true });
      await mkdir(join(root, '.output', 'verification'));
      await mkdir(join(root, 'docs'));
      const content = 'invented-performance-fixture-not-to-export';
      await writeFile(
        join(root, '.output', 'chrome-mv3', 'invented.js'),
        content,
      );
      const report = inventedPerformanceReport();
      report.files['invented.js'] = createHash('sha256')
        .update(content)
        .digest('hex');
      if (mode === 'stale') report.files['invented.js'] = 'b'.repeat(64);
      if (mode === 'short') report.scenarios[0]!.scrollDurationSeconds = 1;
      if (mode === 'missing-control') report.scenarios.pop();
      await writeFile(
        join(root, '.output', 'verification', 'performance.json'),
        JSON.stringify(
          mode === 'legacy'
            ? { referenceHardwareAcceptance: true, durationSeconds: 1800 }
            : report,
        ),
      );
      await writeFile(
        join(root, 'docs', 'release-evidence.json'),
        JSON.stringify({
          schemaVersion: 1,
          performance: {
            report: '.output/verification/performance.json',
            referenceHardwareApproved: true,
            pairedControls: true,
            cpu1xAnd4x: true,
            detachedRetentionZero: true,
            allSpecBudgetsPassed: true,
          },
        }),
      );
      const result = spawnSync(process.execPath, [cli, script], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(result.status).toBe(1);
      const output = JSON.parse(result.stdout);
      expect(output.checks.referencePerformance).toBe(mode === 'reviewed');
      expect(output.releaseReady).toBe(false);
      expect(result.stdout).not.toContain(content);
      expect(result.stdout).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
