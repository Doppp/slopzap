import { expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  releaseArtifact,
  MAX_RELEASE_JSON_BYTES,
} from '../scripts/release-inputs';

const cli = resolve('node_modules/tsx/dist/cli.mjs'),
  script = resolve('scripts/release-check.ts'),
  canary = 'invented-private-evidence-do-not-print';

test.each([
  'malformed',
  'null',
  'array',
  'primitive',
  'missing',
  'oversized-root',
  'linked-root',
  'linked-docs',
  'malformed-report',
  'oversized-report',
  'linked-report',
  'linked-report-directory',
  'linked-output-directory',
  'directory-report',
  'fifo-root',
  'fifo-report',
])('release CLI fails closed without content or paths: %s', async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'slopzap-evidence-input-test-'));
  try {
    await mkdir(join(root, 'docs'));
    await mkdir(join(root, '.output', 'chrome-mv3'), { recursive: true });
    await mkdir(join(root, '.output', 'verification'));
    await writeFile(join(root, '.output', 'chrome-mv3', 'invented.js'), canary);
    const evidence = join(root, 'docs', 'release-evidence.json'),
      report = join(root, '.output', 'verification', 'reproducibility.json'),
      rootJson = JSON.stringify({
        schemaVersion: 1,
        reproducibility: '.output/verification/reproducibility.json',
      }),
      reportJson = JSON.stringify({
        schemaVersion: 1,
        packagedFilesIdentical: true,
        archiveByteEqualityClaimed: false,
        files: {
          'invented.js': createHash('sha256').update(canary).digest('hex'),
        },
      });
    await writeFile(evidence, rootJson);
    await writeFile(report, reportJson);
    if (mode === 'malformed') await writeFile(evidence, `{"${canary}":`);
    if (mode === 'null') await writeFile(evidence, 'null');
    if (mode === 'array') await writeFile(evidence, '[{"schemaVersion":1}]');
    if (mode === 'primitive') await writeFile(evidence, '"schemaVersion"');
    if (mode === 'missing') await rm(evidence);
    if (mode === 'oversized-root')
      await writeFile(evidence, rootJson + ' '.repeat(1_048_576));
    if (mode === 'malformed-report') await writeFile(report, `{"${canary}":`);
    if (mode === 'oversized-report')
      await writeFile(report, reportJson + ' '.repeat(1_048_576));
    if (mode === 'linked-root' || mode === 'linked-report') {
      const target = mode === 'linked-root' ? evidence : report,
        external = join(root, 'external.json');
      await writeFile(external, mode === 'linked-root' ? rootJson : reportJson);
      await rm(target);
      await symlink(external, target);
    }
    if (
      mode === 'linked-docs' ||
      mode === 'linked-report-directory' ||
      mode === 'linked-output-directory'
    ) {
      const target =
          mode === 'linked-docs'
            ? join(root, 'docs')
            : mode === 'linked-report-directory'
              ? join(root, '.output', 'verification')
              : join(root, '.output'),
        external = join(root, 'external');
      await mkdir(external);
      if (mode === 'linked-docs')
        await writeFile(join(external, 'release-evidence.json'), rootJson);
      else if (mode === 'linked-report-directory')
        await writeFile(join(external, 'reproducibility.json'), reportJson);
      else {
        await mkdir(join(external, 'verification'));
        await mkdir(join(external, 'chrome-mv3'));
        await writeFile(
          join(external, 'verification', 'reproducibility.json'),
          reportJson,
        );
        await writeFile(join(external, 'chrome-mv3', 'invented.js'), canary);
      }
      await rm(target, { recursive: true });
      await symlink(external, target);
    }
    if (mode === 'directory-report') {
      await rm(report);
      await mkdir(report);
    }
    if (mode === 'fifo-root' || mode === 'fifo-report') {
      const target = mode === 'fifo-root' ? evidence : report;
      await rm(target);
      const fifo = spawnSync('mkfifo', [target]);
      expect(fifo.status).toBe(0);
    }
    const result = spawnSync(process.execPath, [cli, script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(output.releaseReady).toBe(false);
    const rootRejected = [
      'malformed',
      'null',
      'array',
      'primitive',
      'missing',
      'oversized-root',
      'linked-root',
      'linked-docs',
      'fifo-root',
    ].includes(mode);
    expect(output.checks.schema).toBe(!rootRejected);
    expect(output.checks.reproducibility).toBe(false);
    expect(result.stdout + result.stderr).not.toContain(canary);
    expect(result.stdout + result.stderr).not.toContain(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(['.output/verification', '.output/benchmarks', 'evaluation/reports'])(
  'reads object reports within the approved directory: %s',
  async (directory) => {
    const root = await mkdtemp(join(tmpdir(), 'slopzap-json-object-test-'));
    try {
      await mkdir(join(root, directory), { recursive: true });
      const path = `${directory}/invented.json`;
      await writeFile(join(root, path), '{"schemaVersion":1,"value":false}');
      expect(await releaseArtifact(path, root)).toEqual({
        schemaVersion: 1,
        value: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each([
  undefined,
  null,
  42,
  {},
  ['.output/verification/report.json'],
  'docs/release-evidence.json',
  '/tmp/report.json',
  '../report.json',
  '.output/verification/../report.json',
  '.output/verification/nested/report.json',
  '.output/verification/report.JSON',
  '.output/verification/report.json\n',
  '.output\\verification\\report.json',
  '.output/verification/report.json?x=1',
  `.output/verification/${'a'.repeat(256)}.json`,
])(
  'rejects unapproved artifact path before filesystem access: %j',
  async (path) => {
    expect(
      await releaseArtifact(path, '/nonexistent-invented-root'),
    ).toBeUndefined();
  },
);

test.each([
  'exact-limit',
  'over-limit',
  'empty',
  'array',
  'null',
  'number',
  'string',
  'invalid-utf8',
  'trailing-json',
  'missing',
  'prototype-key',
])('bounded JSON input rules: %s', async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'slopzap-json-bound-test-'));
  try {
    await mkdir(join(root, 'evaluation', 'reports'), { recursive: true });
    const path = 'evaluation/reports/invented.json',
      json = '{"schemaVersion":1}';
    let bytes: string | Buffer = json;
    if (mode === 'exact-limit')
      bytes += ' '.repeat(MAX_RELEASE_JSON_BYTES - json.length);
    if (mode === 'over-limit')
      bytes += ' '.repeat(MAX_RELEASE_JSON_BYTES - json.length + 1);
    if (mode === 'empty') bytes = '';
    if (mode === 'array') bytes = '[]';
    if (mode === 'null') bytes = 'null';
    if (mode === 'number') bytes = '1';
    if (mode === 'string') bytes = '"invented"';
    if (mode === 'invalid-utf8')
      bytes = Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
    if (mode === 'trailing-json') bytes += '{}';
    if (mode === 'prototype-key')
      bytes = '{"__proto__":{"slopzapInventedPollution":true}}';
    if (mode !== 'missing') await writeFile(join(root, path), bytes);
    const value = await releaseArtifact(path, root);
    if (mode === 'exact-limit') expect(value).toEqual({ schemaVersion: 1 });
    else if (mode === 'prototype-key') {
      expect(Object.hasOwn(value!, '__proto__')).toBe(true);
      expect(Object.hasOwn(Object.prototype, 'slopzapInventedPollution')).toBe(
        false,
      );
    } else expect(value).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
