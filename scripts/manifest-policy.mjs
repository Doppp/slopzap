export const CONTENT_MATCHES = [
  'https://www.reddit.com/*',
  'https://www.youtube.com/*',
  'https://www.linkedin.com/*',
  'https://x.com/*',
  'https://twitter.com/*',
  'https://medium.com/*',
];
export const PACKAGED_ENTRYPOINTS = [
  'background.js',
  'content-scripts/content.js',
  'popup.html',
  'options.html',
  'onboarding.html',
  'harness.html',
  'comparison.html',
];

const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, expected) =>
  Array.isArray(value) &&
  value.length === expected.length &&
  new Set(value).size === value.length &&
  expected.every((item) => value.includes(item));
const absentOrEmpty = (value) => value === undefined || exact(value, []);

// Fail closed in build tooling, not on a user's page. This pins the reviewed
// alpha wiring; permission/context changes require updating policy and tests.
export function assertManifestPolicy(manifest) {
  const knownFields = [
    'manifest_version',
    'name',
    'description',
    'version',
    'icons',
    'minimum_chrome_version',
    'version_name',
    'action',
    'permissions',
    'content_security_policy',
    'background',
    'options_ui',
    'content_scripts',
    'host_permissions',
    'optional_permissions',
    'optional_host_permissions',
    'web_accessible_resources',
    'externally_connectable',
  ];
  if (
    !record(manifest) ||
    Object.keys(manifest).some((key) => !knownFields.includes(key))
  )
    throw new Error('Unexpected manifest field or context');
  if (
    manifest.manifest_version !== 3 ||
    !exact(manifest.permissions, ['storage'])
  )
    throw new Error('Unexpected extension permissions');
  if (
    !absentOrEmpty(manifest.optional_permissions) ||
    !absentOrEmpty(manifest.optional_host_permissions) ||
    !absentOrEmpty(manifest.host_permissions) ||
    !absentOrEmpty(manifest.web_accessible_resources) ||
    manifest.externally_connectable !== undefined
  )
    throw new Error('Unexpected privileged network or page access');
  if (
    !record(manifest.content_security_policy) ||
    !exact(Object.keys(manifest.content_security_policy), [
      'extension_pages',
    ]) ||
    manifest.content_security_policy.extension_pages !==
      "script-src 'self'; object-src 'none';"
  )
    throw new Error('Unexpected extension CSP');
  if (
    !record(manifest.background) ||
    !exact(Object.keys(manifest.background), ['service_worker']) ||
    manifest.background.service_worker !== 'background.js' ||
    !record(manifest.action) ||
    manifest.action.default_popup !== 'popup.html' ||
    !record(manifest.options_ui) ||
    manifest.options_ui.page !== 'options.html' ||
    manifest.options_ui.open_in_tab !== false
  )
    throw new Error('Unexpected extension entrypoint wiring');
  if (
    !Array.isArray(manifest.content_scripts) ||
    manifest.content_scripts.length !== 1
  )
    throw new Error('Missing or duplicate content script');
  const script = manifest.content_scripts[0];
  if (
    !record(script) ||
    !exact(Object.keys(script), ['matches', 'run_at', 'js']) ||
    !exact(script.matches, CONTENT_MATCHES) ||
    script.run_at !== 'document_idle' ||
    !exact(script.js, ['content-scripts/content.js'])
  )
    throw new Error('Unexpected content-script access or wiring');
}
