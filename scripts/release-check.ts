import { readiness } from '../evaluation/readiness';
import { packageFiles } from './package-files.mjs';
import { releaseArtifact, releaseEvidence } from './release-inputs';
const evidence = await releaseEvidence();
function report(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).report
    : undefined;
}
const classification = await releaseArtifact(report(evidence?.classification)),
  benchmark = await releaseArtifact(report(evidence?.performance)),
  reproducibility = await releaseArtifact(evidence?.reproducibility);
const packagedFiles = await packageFiles('.output/chrome-mv3').catch(
  () => undefined,
);
const result = readiness(evidence, {
  ...(classification ? { classification } : {}),
  ...(benchmark ? { benchmark } : {}),
  ...(reproducibility ? { reproducibility } : {}),
  ...(packagedFiles ? { packagedFiles } : {}),
});
console.log(JSON.stringify(result, null, 2));
if (!result.releaseReady) process.exitCode = 1;
