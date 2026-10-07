# Privacy policy

Effective for the development alpha on 2026-10-07.

SlopZap processes visible individual social-content text for its single purpose: local inspection and reversible filtering of AI-style, low-information content. It does not establish authorship.

## Device processing

On the enabled supported sites, the extension extracts a unit's authored text, bounded parent/root/quote context, platform/type and stable content identity when available. These fields are used in active runtime memory for fingerprinting and classification. The service worker receives small local batches; it does not transmit them over the network.

The extension excludes messaging and group routes, forms, inputs and editors. It does not access cookies, credentials, passwords, direct messages, browser history, arbitrary domains, or full-page HTML. Platform privacy labels are not reliably available in all DOMs; the alpha therefore offers no remote transmission mode, including for content visible behind login.

## Local storage

IndexedDB retains derived scores, controlled reason labels, classifier versions and opaque SHA-256 fingerprints. Raw page text, author metadata and visited URLs are not stored. A fingerprint is not encryption or guaranteed anonymity; someone who already knows the exact text and context may reproduce it.

Local scores expire after 90 days, insufficient-evidence results after seven days, optional model scores after one day, and corrections after one year. Expiry is enforced on read and expired records are pruned during writes. Limits are 20,000 scores and 5,000 corrections, with oldest-accessed eviction to 80% of each limit. Settings stay in `chrome.storage.local`. Cache and correction controls are separate. Chrome does not necessarily clear extension storage when ordinary browsing data is cleared; use these controls or uninstall the extension.

Quick setup stores only its version and local presentation/completion booleans, alongside your selected browsing view and site toggles. These preferences are not telemetry. No onboarding analytics, timestamps, account identifiers or progress events are collected or uploaded. Completing or skipping setup does not enable an AI provider or download a model.

## Optional Chrome on-device model

Off by default. An explicit options-page click may ask Chrome to download its model. Classification input remains on the device; SlopZap has no cloud inference endpoint. Chrome manages download availability, hardware requirements and model updates. SlopZap does not download or execute remote application code.

## Sharing, analytics and feedback

No SlopZap servers, analytics, telemetry or uploaded corrections exist. Maintainers do not receive your page text or cache. Production code does not log raw text, URLs, credentials or model responses. Automated test traces contain invented fixtures only. Please avoid posting sensitive page text in GitHub issues.

SlopZap's use of user data adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements. Data is used only for the disclosed inspection/filtering purpose; it is not sold, used for advertisements, or transferred for unrelated purposes.

Any future remote provider requires separate disclosure, explicit consent, a revised policy and tests. It is absent from this alpha.
