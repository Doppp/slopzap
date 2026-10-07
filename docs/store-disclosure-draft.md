# Chrome Web Store disclosure draft

SlopZap is an open-source local browser extension for inspecting formulaic, low-information social content. The current build is a development alpha and is not submitted to the Chrome Web Store. The listing must not promise accurate AI-authorship detection or automatic classifier-based blocking.

## Listing copy

**Name:** SlopZap

**Summary:** Inspect AI-style social noise with conservative, local Slop Scores.

**Description:** SlopZap annotates individual public-site posts, comments and replies with provisional Slop Scores. Switch between Goggles, Normal, Slop Only and a reversible Blocker for your local corrections. Scores can be wrong and cannot prove that an author used AI. The alpha targets LinkedIn, X/Twitter, YouTube comments, desktop Reddit and Medium; live compatibility remains under validation. Messages, groups and compose fields are excluded.

Local analysis requires no account, API key, backend or telemetry. Optional Chrome on-device AI requires explicit preparation, may download a large browser-managed model and depends on supported hardware. SlopZap does not send text to an inference server. No Sign in with ChatGPT or remote provider is offered in this build.

## Data and permissions

Website content is processed transiently for the extension's single user-facing purpose, including bounded context. Raw text, HTML, author information and URLs are not persisted. Local storage retains preferences, setup booleans, derived scores and exact-item corrections, with bounded retention and separate clearing controls. Optional timing diagnostics retain bounded numeric samples in tab memory. A deliberate diagnostic export can include platform names, preferences, counts, timings and controlled failure codes for up to 20 supported tabs; nothing is uploaded.

The only API permission is `storage`. Static content-script matches are restricted to the six exact supported origins, including both X and Twitter. No all-URLs, history, cookies, tabs, identity, activeTab, notifications, clipboard or remote-network permission is requested. The use of handled user data must comply with the Chrome Web Store User Data Policy, including Limited Use; `PRIVACY.md` contains the policy statement.

Use the public [privacy policy](https://github.com/Doppp/slopzap/blob/master/PRIVACY.md) as the review source. The submitter must ensure the final Dashboard privacy/data-handling declarations match this build. Local website-content processing is still user-data handling; do not claim the extension handles no data merely because no server receives it.

## Submission checklist

- Pass the release evidence check and update the development-alpha claims only when supported.
- Provide a working support/privacy URL, required screenshots and complete accurate metadata.
- Review the Store's data categories against actual local processing, diagnostics and retention.
- Keep the model download disclosure visible and optional; do not add remote inference or credentials without a separate privacy/security review.
- Submit only with the owner's developer account and confirmed listing details. No submission or fee payment is authorized by this draft.

Policy basis: [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies), reviewed 7 October 2026. This is a technical disclosure draft, not approval by Google or legal advice.
