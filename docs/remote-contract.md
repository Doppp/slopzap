# Mock remote provider boundary

Milestone 13 supplies a test-only coordinator, not a remote service. No production entrypoint imports it, `REMOTE_PRODUCTION_ENABLED` remains false, and the module implements no HTTP, OAuth or credential storage. Tests use invented content and injected mock transports. Production integration remains gated by [SPEC.md §18.2](../SPEC.md#182-openai-provider-and-authentication-decision); these fixes do not authorize a new billing, credential, companion or relay architecture.

## Queue and payload limits

The queue admits at most 128 pending requesters, including duplicate-key waiters. Success, cancellation, failure and close release that capacity once. Requester IDs are bounded opaque strings; outgoing IDs are generated independently, without transmitting caller IDs or fingerprints. Inputs contain only authored text, parent/root/quote context, kind and platform. The four text fields are capped at 6,000/800/500/600 characters respectively. Unknown fields, inherited unit fields, invalid priorities and malformed keys fail before dispatch.

Duplicate keys share work only when all six unit fields match. A conflicting target fails rather than receiving another target's score. This checks consistency, not whether the caller computed a genuine fingerprint; a future trusted integration must still establish that identity.

P0 and P1 retain 75-ms and 250-ms debounce delays. Ordinary dispatch uses at most two coordinator slots, twelve items and 12,000 estimated input characters per batch, with articles isolated from social batches. Each transport attempt gets a fresh payload copy so its mutations cannot alter internal jobs or a later retry. Responses retain the existing exact schema, matched-ID and numeric-range checks.

## Cancellation and retries

Cancelling one duplicate waiter leaves other active requesters intact. Cancelling the final waiter removes its job before notifying the transport, allowing a reentrant same-key request to create a fresh job. Old batch cleanup cannot delete that replacement.

Every attempt selects only jobs with active waiters; a partially cancelled batch cannot resend the cancelled target on retry. Ignored-abort backoff promises are wrapped in the same cancellation and twenty-second total deadline as transport waits, so they cannot indefinitely occupy coordinator slots. Close rejects pending callers and prevents further dispatch.

Only network failures represented by a null status, 408, 429 and integer 500–599 statuses retry, once. Retry delays must be finite numbers from zero through 10,000 ms; the wait honors that delay with the existing 500–1,499-ms jitter floor. Authentication, unsupported status and schema failures do not retry.

These are application-control guarantees. Cancellation cannot recall previously submitted data or forcibly terminate injected code that ignores abort. Two coordinator slots do not prove that an uncooperative underlying transport has stopped its own work. Production requires a separately reviewed, cooperating transport, streaming first-response timeout, consent, authentication and privacy design; none is supplied by this mock.

## Verification and remaining acceptance

Forty-eight new unit cases cover partial cancellation, slot recovery, bounded fan-out, key consistency, reentrant replacement, payload mutation, strict statuses/delays, total timeout, malformed inputs and scheduling. The full development suite passes 583 unit tests and 58 browser tests. Structural build checks continue to reject a production dependency on this module, and all 28 packaged files remain reproducible with the unchanged build fingerprint.

Mock responses are not provider-quality measurements, and structural import checks are not a complete capability audit. No live content was used, no remote account was connected, and no release approval or classifier safety gate changed. Milestone 14's reference profiling and manual security/privacy acceptance remain separate.
