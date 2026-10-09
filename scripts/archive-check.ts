import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { packageFiles, packageFingerprint } from './package-files.mjs';
import { archiveFiles, MAX_ARCHIVE_BYTES } from './archive-files';
import { boundedReleaseBytes, releaseArtifact } from './release-inputs';
import {
  packagedFilesMatch,
  reproducibilityMatchesPackage,
} from '../evaluation/package-evidence';
import {
  assertManifestPolicy,
  PACKAGED_ENTRYPOINTS,
} from './manifest-policy.mjs';

try {
  const root = process.cwd(),
    before = await packageFiles('.output/chrome-mv3'),
    manifestBytes = await boundedReleaseBytes(
      '.output/chrome-mv3/manifest.json',
      root,
      500_000,
    );
  if (PACKAGED_ENTRYPOINTS.some((entry) => !Object.hasOwn(before, entry)))
    throw new Error();
  if (
    !manifestBytes ||
    createHash('sha256').update(manifestBytes).digest('hex') !==
      before['manifest.json']
  )
    throw new Error();
  const manifest = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
  );
  assertManifestPolicy(manifest);
  const version: unknown = manifest.version;
  if (
    typeof version !== 'string' ||
    version.length > 23 ||
    !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version) ||
    version.split('.').some((part) => Number(part) > 65535)
  )
    throw new Error();
  const artifact = `.output/slopzap-${version}-chrome.zip`,
    bytes = await boundedReleaseBytes(artifact, root, MAX_ARCHIVE_BYTES);
  if (!bytes || !packagedFilesMatch(archiveFiles(bytes), before))
    throw new Error();
  const after = await packageFiles('.output/chrome-mv3'),
    reproduction = await releaseArtifact(
      '.output/verification/reproducibility.json',
      root,
    );
  if (
    !packagedFilesMatch(before, after) ||
    !reproducibilityMatchesPackage(reproduction, after)
  )
    throw new Error();
  const report = {
    schemaVersion: 1,
    kind: 'archive-verification',
    artifact,
    archiveVerified: true,
    archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    packagedBuildSha256: packageFingerprint(after),
    files: after,
    archiveByteEqualityClaimed: false,
    releaseReady: false,
  };
  await mkdir('.output/verification', { recursive: true });
  await writeFile(
    '.output/verification/archive.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `path=${artifact}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.log(
    JSON.stringify({
      archiveVerified: false,
      releaseReady: false,
      error: 'archive_verification_failed',
    }),
  );
  process.exitCode = 1;
}
