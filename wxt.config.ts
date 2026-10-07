import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'SlopZap',
    description:
      'Inspect AI-style social noise with conservative, local Slop Scores.',
    minimum_chrome_version: '138',
    permissions: ['storage'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none';",
    },
  },
});
