function hashMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 1000) return undefined;
  if (
    entries.some(
      ([path, hash]) =>
        !path ||
        path.length > 4096 ||
        path
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        path.includes('\\') ||
        typeof hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    return undefined;
  return value as Record<string, string>;
}

export function reproducibilityMatchesPackage(
  report: unknown,
  currentFiles: unknown,
): boolean {
  if (!report || typeof report !== 'object' || Array.isArray(report))
    return false;
  const source = report as Record<string, unknown>;
  if (
    source.schemaVersion !== 1 ||
    source.packagedFilesIdentical !== true ||
    source.archiveByteEqualityClaimed !== false
  )
    return false;
  const expected = hashMap(source.files),
    current = hashMap(currentFiles);
  if (!expected || !current) return false;
  return (
    Object.keys(expected).length === Object.keys(current).length &&
    Object.entries(current).every(
      ([path, hash]) =>
        Object.hasOwn(expected, path) && expected[path] === hash,
    )
  );
}
