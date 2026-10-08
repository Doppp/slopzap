export function installationEvidence(
  response: unknown,
  expectedId?: string,
  expectedPath?: string,
): {
  unpackedExtensionCount: number;
  packagedExtensionRegistered: boolean;
};
