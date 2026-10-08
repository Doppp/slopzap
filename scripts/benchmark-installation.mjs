// CDP lists unpacked extensions separately from Chrome's built-in components.
// Project numeric/boolean evidence only; never export IDs, names or load paths.
export function installationEvidence(response, expectedId, expectedPath) {
  if (
    !response ||
    !Array.isArray(response.extensions) ||
    response.extensions.some(
      (entry) =>
        !entry ||
        typeof entry.id !== 'string' ||
        typeof entry.path !== 'string' ||
        typeof entry.enabled !== 'boolean',
    )
  )
    throw new Error('Extension installation evidence unavailable');
  return {
    unpackedExtensionCount: response.extensions.length,
    packagedExtensionRegistered:
      expectedId !== undefined &&
      expectedPath !== undefined &&
      response.extensions.some(
        (entry) =>
          entry.id === expectedId &&
          entry.path === expectedPath &&
          entry.enabled === true,
      ),
  };
}
