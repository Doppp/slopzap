import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const workflow = readFileSync('.github/workflows/check.yml', 'utf8');
test('CI action references are immutable commits from the reviewed repositories', () => {
  const references = [...workflow.matchAll(/^\s+- uses: ([^\s#]+)/gm)].map(
    (match) => match[1]!,
  );
  expect(references).toHaveLength(6);
  for (const reference of references)
    expect(reference).toMatch(
      /^(actions\/(checkout|setup-node|upload-artifact)|pnpm\/action-setup)@[a-f0-9]{40}$/,
    );
});
test('CI does not persist checkout credentials or grant write permissions', () => {
  expect(workflow).toContain('persist-credentials: false');
  expect(workflow).toMatch(/^permissions:\n  contents: read$/m);
  expect(workflow).not.toMatch(/^\s+[\w-]+:\s*write\s*$/m);
  expect(workflow).not.toMatch(
    /pull_request_target|workflow_run|allow-unsafe-pr-checkout:\s*true/,
  );
  expect(workflow).toContain('on: [push, pull_request]');
});
