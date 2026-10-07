import { expect, test } from 'vitest';
import { AdapterHealth } from '../src/content/adapter-health';

test('small samples fail open without pausing a route', () => {
  const health = new AdapterHealth();
  for (let index = 0; index < 19; index++)
    expect(health.record(false)).toBeNull();
  expect(health.snapshot()).toEqual({
    code: null,
    sampled: 19,
    rejected: 19,
    consecutiveFailures: 19,
  });
  expect(health.record(false)).toBe('adapter_parse_failures');
});

test('less than fifty percent parse success pauses after twenty distinct candidates', () => {
  const health = new AdapterHealth();
  for (let index = 0; index < 20; index++) health.record(index % 2 === 0);
  expect(health.snapshot().code).toBeNull();
  expect(health.record(false)).toBe('adapter_parse_failures');
});

test('successful candidates reset the consecutive failure counter', () => {
  const health = new AdapterHealth();
  health.record(false);
  health.record(false);
  health.record(true);
  expect(health.snapshot()).toMatchObject({
    sampled: 3,
    rejected: 2,
    consecutiveFailures: 0,
  });
});

test('twenty consecutive failures trip even after a previously healthy sample', () => {
  const health = new AdapterHealth();
  for (let index = 0; index < 100; index++) health.record(true);
  for (let index = 0; index < 19; index++)
    expect(health.record(false)).toBeNull();
  expect(health.record(false)).toBe('adapter_parse_failures');
  expect(health.snapshot().rejected).toBe(20);
});

test('the sample is a bounded rolling window, not an ever-growing history', () => {
  const health = new AdapterHealth();
  for (let index = 0; index < 1000; index++) health.record(true);
  for (let index = 0; index < 100; index++) health.record(index % 2 === 0);
  expect(health.snapshot()).toMatchObject({
    code: null,
    sampled: 100,
    rejected: 50,
  });
  // The first successful item leaves the rolling window.
  expect(health.record(false)).toBe('adapter_parse_failures');
});

test('a trip is latched until a new route health session is created', () => {
  const health = new AdapterHealth();
  for (let index = 0; index < 20; index++) health.record(false);
  const paused = health.snapshot();
  expect(health.record(true)).toBe('adapter_parse_failures');
  expect(health.snapshot()).toEqual(paused);
  expect(new AdapterHealth().snapshot().code).toBeNull();
});

test('exceptions expose a fixed code without storing exception text', () => {
  const health = new AdapterHealth();
  health.pause('adapter_parse_exception');
  expect(health.snapshot()).toEqual({
    code: 'adapter_parse_exception',
    sampled: 0,
    rejected: 0,
    consecutiveFailures: 0,
  });
});
