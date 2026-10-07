import { expect, test } from 'vitest';
import {
  observationOutcome,
  projectDom,
  projectSnapshot,
} from '../scripts/live-smoke-summary';

const runtime = {
  supported: true,
  platform: 'reddit',
  stats: { bound: 3, candidates: 3, classifications: 3 },
  health: { code: null, sampled: 3, rejected: 0, consecutiveFailures: 0 },
};
const dom = {
  domCandidates: 3,
  annotations: 3,
  authRoute: false,
  challengeFramePresent: false,
};
const observation = {
  ...dom,
  navigationFailed: false,
  domSnapshotAvailable: true,
  status: 200,
  runtime: projectSnapshot(runtime),
};

test('live summaries retain only controlled fields and discard content and preferences', () => {
  expect(
    projectSnapshot({
      ...runtime,
      settings: { onDevice: true },
      text: 'Invented private material',
      url: 'https://example.invalid/',
      stats: { ...runtime.stats, rawResponse: 'invented' },
    }),
  ).toEqual(runtime);
  expect(
    projectDom({ ...dom, title: 'Invented title', html: '<p>invented</p>' }),
  ).toEqual(dom);
});

test('live snapshot projection rejects malformed counters and arbitrary codes', () => {
  for (const value of [
    null,
    [],
    {},
    { ...runtime, platform: 'arbitrary content' },
    { ...runtime, stats: { ...runtime.stats, bound: -1 } },
    { ...runtime, stats: { ...runtime.stats, candidates: Infinity } },
    { ...runtime, health: { ...runtime.health, code: 'raw exception text' } },
    { ...runtime, health: { ...runtime.health, sampled: 101 } },
    { ...runtime, health: { ...runtime.health, rejected: 4 } },
  ])
    expect(projectSnapshot(value)).toBeNull();
  expect(
    projectSnapshot({ ...runtime, supported: false, platform: 'discarded' })
      ?.platform,
  ).toBeNull();
  for (const value of [
    null,
    {},
    { ...dom, annotations: 'invented text' },
    { ...dom, domCandidates: 1.5 },
    { ...dom, authRoute: 'false' },
  ])
    expect(projectDom(value)).toBeNull();
});

test('inaccessible pages and missing instrumentation never become unit observations', () => {
  expect(observationOutcome({ ...observation, navigationFailed: true })).toBe(
    'navigation_unavailable',
  );
  expect(
    observationOutcome({ ...observation, domSnapshotAvailable: false }),
  ).toBe('dom_snapshot_unavailable');
  expect(observationOutcome({ ...observation, authRoute: true })).toBe(
    'authentication_route',
  );
  expect(observationOutcome({ ...observation, status: 403 })).toBe(
    'http_error',
  );
  expect(
    observationOutcome({
      ...observation,
      domCandidates: 0,
      challengeFramePresent: true,
    }),
  ).toBe('possible_access_challenge');
  expect(observationOutcome({ ...observation, domCandidates: 0 })).toBe(
    'no_target_units',
  );
  expect(observationOutcome({ ...observation, runtime: null })).toBe(
    'runtime_snapshot_unavailable',
  );
});

test('observed candidates still require bindings and do not override runtime failures', () => {
  expect(
    observationOutcome({
      ...observation,
      runtime: projectSnapshot({
        ...runtime,
        stats: { ...runtime.stats, bound: 0 },
      }),
    }),
  ).toBe('no_bound_units');
  expect(
    observationOutcome({
      ...observation,
      runtime: projectSnapshot({
        ...runtime,
        health: { ...runtime.health, code: 'adapter_parse_failures' },
      }),
    }),
  ).toBe('runtime_paused');
  expect(observationOutcome(observation)).toBe('units_observed');
});
