# Security policy

This repository is a development alpha with no supported stable release yet. Report security defects privately through GitHub's **Report a vulnerability** feature when available. Do not post credentials or private content in public issues. If private reporting is unavailable, open an issue requesting a private reporting channel without exploit details.

Webpage content and model responses are untrusted. Content scripts run in an isolated world; output is schema-validated and rendered with DOM text nodes. Model output has no tools and never selects DOM nodes. The manifest uses packaged scripts, strict CSP, narrow site matches and only the storage permission. No OAuth/API tokens are stored and no remote inference is shipped.

The threat model includes malicious page markup, injected instructions, stale asynchronous results, oversized input, model output manipulation, dependency compromise and misleading annotations. Automatic classification hiding is gated pending evaluation. Local corrections are user actions.

Before a stable release, audit runtime messaging, dependency changes, permission scope, host restoration, sensitive-route exclusions, model lifecycle and storage retention. Do not treat open Shadow DOM as a credential boundary; injected UI contains no secrets.
