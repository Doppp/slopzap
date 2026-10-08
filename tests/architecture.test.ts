import { expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  boundaryViolations,
  moduleReferences,
  reachable,
  readSourceGraph,
} from '../scripts/source-boundaries';

test('all source entrypoints preserve the reviewed ownership boundaries', () => {
  const graph = readSourceGraph();
  expect(graph.has('entrypoints/background.ts')).toBe(true);
  expect(graph.has('src/providers/remote-contract.ts')).toBe(true);
  expect(boundaryViolations(graph)).toEqual([]);
  expect(reachable(graph, ['entrypoints/background.ts'])).toContain(
    'src/cache/db.ts',
  );
});

test('source scanning covers aliases, re-exports, type imports and literal dynamic loads', () => {
  expect(
    moduleReferences(
      `
    import type { Invented } from '@/src/providers/types';
    export * from './invented-barrel';
    export type { Shape } from '../shared/types';
    const load = () => import('./lazy');
    const other = require('./helper');
    import legacy = require('./legacy');
    type ShapeOnly = import('./typed').Shape;
  `,
      'invented.ts',
    ),
  ).toEqual([
    '@/src/providers/types',
    './invented-barrel',
    '../shared/types',
    './lazy',
    './helper',
    './legacy',
    './typed',
  ]);
  expect(() => moduleReferences('import(dynamicPath)', 'invented.ts')).toThrow(
    'Unresolved module reference',
  );
  expect(
    moduleReferences(
      '// import("./not-an-import")\nconst text = "require(fake)";',
      'invented.ts',
    ),
  ).toEqual([]);
});

test('indirect adapter privileges, renderer inference and content persistence fail the policy', () => {
  const graph = new Map([
    ['src/adapters/invented.ts', new Set(['src/shared/bridge.ts'])],
    ['src/rendering/invented.ts', new Set(['src/shared/bridge.ts'])],
    ['entrypoints/content.ts', new Set(['src/shared/bridge.ts'])],
    [
      'src/shared/bridge.ts',
      new Set([
        'src/cache/db.ts',
        'src/providers/chrome-prompt.ts',
        'src/state/onboarding.ts',
      ]),
    ],
  ]);
  expect(boundaryViolations(graph)).toContain(
    'adapter ownership: src/state/onboarding.ts',
  );
  expect(boundaryViolations(graph)).toContain(
    'rendering cannot own inference: src/providers/chrome-prompt.ts',
  );
  expect(boundaryViolations(graph)).toContain(
    'content cannot own persistence: src/cache/db.ts',
  );
});

test('transitive mock shipping and browser APIs in local scoring fail the policy', () => {
  const graph = new Map([
    ['entrypoints/background.ts', new Set(['src/shared/bridge.ts'])],
    ['src/shared/bridge.ts', new Set(['src/providers/remote-contract.ts'])],
    ['src/classifier/local.ts', new Set(['external:wxt/browser'])],
  ]);
  expect(boundaryViolations(graph)).toEqual([
    'local computation is pure: external:wxt/browser',
    'mock remote is not shipped: src/providers/remote-contract.ts',
  ]);
});

test('cyclic pure helpers terminate without loosening ownership checks', () => {
  const graph = new Map([
    ['src/rendering/invented.ts', new Set(['src/shared/first.ts'])],
    ['src/shared/first.ts', new Set(['src/shared/second.ts'])],
    ['src/shared/second.ts', new Set(['src/shared/first.ts'])],
  ]);
  expect(reachable(graph, ['src/rendering/invented.ts']).size).toBe(3);
  expect(boundaryViolations(graph)).toEqual([]);
});

test('alias resolution follows indirect helpers outside the initial source folders', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'slopzap-architecture-'));
  try {
    for (const [file, text] of [
      [
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: {
            module: 'Preserve',
            moduleResolution: 'Bundler',
            paths: { '@/*': ['./*'] },
          },
        }),
      ],
      ['src/adapters/invented.ts', "export * from '@/tools/bridge';"],
      ['tools/bridge.ts', "export * from '../src/cache/db';"],
      ['src/cache/db.ts', 'export const invented = true;'],
      ['entrypoints/content.ts', 'export const invented = true;'],
    ] as const) {
      const path = join(fixture, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    const graph = readSourceGraph(fixture);
    expect(reachable(graph, ['src/adapters/invented.ts'])).toContain(
      'src/cache/db.ts',
    );
    expect(boundaryViolations(graph)).toContain(
      'adapter ownership: src/cache/db.ts',
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
