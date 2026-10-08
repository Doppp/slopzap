import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export type SourceGraph = ReadonlyMap<string, ReadonlySet<string>>;

export function moduleReferences(text: string, file: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const references = new Set<string>();
  const add = (node: ts.Node | undefined) => {
    if (!node || !ts.isStringLiteralLike(node))
      throw new Error(`Unresolved module reference: ${file}`);
    references.add(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      add(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node))
      add(
        ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined,
      );
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      add(node.moduleReference.expression);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    )
      add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...references];
}

export function readSourceGraph(root = '.'): SourceGraph {
  const base = resolve(root);
  const label = (path: string) => relative(base, path).split(sep).join('/');
  const config = ts.getParsedCommandLineOfConfigFile(
    join(base, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {
        throw new Error('Source boundary configuration unavailable');
      },
    },
  );
  if (!config || config.errors.length)
    throw new Error('Invalid source boundary configuration');
  const graph = new Map<string, Set<string>>();
  const scan = (path: string) => {
    if (graph.has(label(path))) return;
    const edges = new Set<string>();
    graph.set(label(path), edges); // Mark before following possible cycles.
    for (const specifier of moduleReferences(
      readFileSync(path, 'utf8'),
      label(path),
    )) {
      if (specifier.endsWith('.css')) continue;
      const dependency = ts.resolveModuleName(
        specifier,
        path,
        config.options,
        ts.sys,
      ).resolvedModule;
      if (!dependency)
        throw new Error(
          `Unresolved dependency: ${label(path)} -> ${specifier}`,
        );
      if (dependency.isExternalLibraryImport)
        edges.add(`external:${specifier}`);
      else {
        edges.add(label(dependency.resolvedFileName));
        scan(dependency.resolvedFileName);
      }
    }
  };
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) scan(path);
    }
  };
  visit(join(base, 'src'));
  visit(join(base, 'entrypoints'));
  return graph;
}

export function reachable(
  graph: SourceGraph,
  roots: readonly string[],
): Set<string> {
  const seen = new Set<string>();
  const pending = [...roots];
  while (pending.length) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const dependency of graph.get(path) ?? []) pending.push(dependency);
  }
  return seen;
}

export function boundaryViolations(graph: SourceGraph): string[] {
  const paths = [...graph.keys()];
  const violations: string[] = [];
  const check = (
    name: string,
    roots: string[],
    forbidden: (path: string) => boolean,
  ) => {
    for (const path of reachable(graph, roots))
      if (forbidden(path)) violations.push(`${name}: ${path}`);
  };
  check(
    'adapter ownership',
    paths.filter((path) => path.startsWith('src/adapters/')),
    (path) =>
      /^(external:|entrypoints\/|src\/(?:cache|state|providers|classifier|scoring|messaging|ui|content|rendering)\/)/.test(
        path,
      ),
  );
  check(
    'rendering cannot own inference',
    paths.filter((path) => path.startsWith('src/rendering/')),
    (path) =>
      /^(external:|entrypoints\/|src\/(?:cache|state|providers|classifier|messaging|ui|content|evaluation)\/|evaluation\/)/.test(
        path,
      ),
  );
  check('local computation is pure', ['src/classifier/local.ts'], (path) =>
    /^(external:|entrypoints\/|src\/(?:cache|state|providers|messaging|ui|content|rendering|adapters|evaluation)\/|evaluation\/)/.test(
      path,
    ),
  );
  check(
    'content cannot own persistence',
    ['entrypoints/content.ts', 'entrypoints/harness/main.ts'],
    (path) => path.startsWith('src/cache/'),
  );
  check(
    'mock remote is not shipped',
    paths.filter((path) => path.startsWith('entrypoints/')),
    (path) => path === 'src/providers/remote-contract.ts',
  );
  return violations.sort();
}
