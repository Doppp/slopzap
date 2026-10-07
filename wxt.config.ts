import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'SlopZap',
    description:
      'Inspect AI-style social noise with conservative, local Slop Scores.',
    minimum_chrome_version: '138',
    version_name: '0.1.0 development alpha',
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    action: {
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
        48: 'icons/48.png',
      },
    },
    permissions: ['storage'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none';",
    },
  },
});
