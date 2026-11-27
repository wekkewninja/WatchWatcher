# Security and Privacy Review

Reviewed: 2026-11-23

Follow-up review: 2026-11-27

## Scope and limits

This is a source, configuration, dependency, and local-test review of the web app, Functions API, PostgreSQL access, IndexedDB progress storage, Google sign-in, Gemini evaluation, and GitHub Actions. No production environment is deployed or available for inspection. This review does not test production accounts, Azure ingress, DNS, production secrets, network policy, or Azure diagnostic retention, and is not a penetration test or a claim of zero vulnerabilities.

## Data flows

- Email, password, Google credentials, learner progress, and evaluation answers travel from the browser to the API. New passwords are validated, hashed with versioned scrypt before persistence, and are not returned in account responses.
- The API issues 20-minute HS256 bearer tokens bound to server-side sessions. The browser keeps the token in memory and clears it on logout. Online logout revokes the session; offline logout cannot confirm revocation. The API checks both session and account before account-scoped access; SQL uses parameters for user-controlled values.
- Local progress is stored in IndexedDB under a guest or account-specific key. The service worker caches the app shell and bundled study content, not API responses.
- Google ID tokens are verified for audience and provider signature/claims; the API requires a verified email and one-time nonce. Existing-account linking requires the account password and explicit confirmation.
- With explicit per-answer consent, online evaluation sends the submitted topic, context, and answer to Gemini. It does not include the account ID or stored progress. The Gemini key is read from server configuration and sent in the `x-goog-api-key` header.
- Application request logs include method, path, status, duration, and invocation ID; request bodies and authorization headers are not logged by the application HTTP wrapper. Azure/platform logging settings were not inspectable.

## Findings and disposition

| Finding | Severity | Evidence and disposition |
| --- | --- | --- |
| Delayed sign-in responses could replace a newer account or restore a session after logout; delayed startup restoration could overwrite newer UI state. | High | A shared-device user could see the wrong account's data when authentication attempts overlap. Fixed by invalidating superseded authentication responses and state updates. Client tests cover password, registration, Google sign-in, logout, and startup restoration races. |
| Legacy bcrypt passwords could previously be authenticated using only their first 72 UTF-8 bytes. | Medium residual | Password authentication for legacy hashes is disabled, without modifying rows. Existing linked Google sign-in remains available; password-only accounts need an approved recovery process. New registrations use bounded, versioned scrypt; see #34. |
| Unexpected API errors could expose internal messages in Azure Production because redaction checked `NODE_ENV` while Functions uses `AZURE_FUNCTIONS_ENVIRONMENT`. | Medium | Fixed in this PR. Unknown environments default to redaction; tests cover Azure Production with `NODE_ENV=development` and Azure Development with `NODE_ENV=production`. |
| Gemini API key was placed in the provider URL query string, where infrastructure may retain URLs in access logs. | Medium | Fixed in this PR. The key is now sent in `x-goog-api-key`; the service test asserts it is absent from the URL. |
| API test tooling included Critical `vitest`/`tinypool` advisories. | Critical, development-only | Fixed in this PR by aligning API Vitest and coverage tooling to 5.1.1. The updated clean-install CI run is the final lockfile/runtime validation. |
| Three Moderate development-only advisories affected `node-pg-migrate`, `glob`, and `minimatch`. | Moderate, development-only | Fixed for #30 with a scoped `glob` 14 override. A clean install and full audit report zero vulnerabilities; PostgreSQL migration, rollback, and glob-discovery tests pass. The override crosses the migration tool's declared major-version range and must be revisited when an upstream release supports a fixed version. |
| Login, registration, Google challenge, and evaluation endpoints lacked distributed throttling. | High residual before public rollout | Shared PostgreSQL quotas protect password login, account linking, registration, deletion reauthentication, and account-scoped evaluation, but can themselves be used for targeted lockout. Ingress/IP controls, identifier-spray protection, Google challenge quotas, scheduled cleanup, and operational alerts remain open under #28; do not expose publicly until those controls are in place. |
| A bearer token could not be revoked server-side after client logout. | Low residual | Online logout revokes the active session. Offline or unconfirmed logout clears local credentials but cannot guarantee remote revocation; the user is warned and expiry bounds the window. Already-authorized operations can finish after revocation. |
| Account and progress deletion and retention were undefined. | Medium residual | Online account deletion and requesting-device cleanup are implemented; sign-out is not deletion. Offline devices cannot be remotely wiped, an ambiguous network outcome may require manual reconciliation, and backup/provider retention remains undecided. Coordinate separate Exam-history deletion with #22. See SECURITY-FOLLOW-UPS.md. |
| Registration returns a distinct duplicate-email conflict to an unauthenticated caller. | Low residual | This can reveal that an address has an account. Decide whether to use generic registration feedback and account-recovery guidance while implementing #9; login itself uses the same generic invalid-credential response for unknown email and wrong password. |
| Online evaluation sent submitted answers to Google without explicit per-request consent. | Medium residual | Consent is now required before the provider call, with structured offline practice available. Provider retention, processing location, and deletion terms remain unverified under #10. |
| CORS, security response headers, TLS termination, proxy trust, and production log retention depend on the not-yet-selected hosting/ingress configuration. | Not verified | Must be assessed against the approved deployment architecture in #13 before release; no live endpoint was probed. |

## Questions for the product/platform owner

- Which production ingress and shared store should enforce distributed rate limits, and what login/evaluation limits are acceptable? See #28.
- What legally appropriate backup, log, and provider retention periods and deletion procedures apply? See #29 and #22.
- Should duplicate registration reveal that an email is already registered, or return generic guidance? See #9.
- What provider-retention and deletion policy applies to answers sent to Gemini? See #10.
- Which Azure hosting/ingress settings will govern CORS, security headers, trusted proxies, and diagnostic retention? See #13.

No Critical or High production-dependency advisory was found by the production audit. The earlier Moderate development-only findings were subsequently remediated as described above.

The product owner has accepted responsibility for the security decisions, but production ingress, operational controls, and a legally reviewed retention policy remain unapproved. The deployment-dependent controls remain unverified under #13, and Gemini provider retention remains open under #10.

## Reproducible checks

Run from the repository root:

```sh
npm run build
npm test
npm audit --omit=dev --audit-level=high
npm audit
```

The audit run for this review found zero production vulnerabilities. The full audit reported three Moderate development-tool findings after the Vitest upgrade; it reported no Critical or High findings. CI also runs the required coverage and icon gates.

On 2026-11-27, `npm ci`, `npm run build`, `npm run test:coverage-gate`, `npm run test:coverage`, and `npm run test:icons` succeeded. Before the #30 fix, `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities and `npm audit` reported three moderate development-only findings. The account-isolation handler tests use mocked authentication and storage; they do not replace a PostgreSQL-backed end-to-end HTTP test.

After the #30 dependency override, `npm ci` and `npm audit` reported zero vulnerabilities. The migration test ran on PostgreSQL 16 with a fresh, isolated schema and passed all apply, rollback, and glob-discovery checks. To repeat it, set `MIGRATION_TEST_DATABASE_URL` to a disposable PostgreSQL database and run `npm run test:migrations`. The test creates and drops its own randomly named schema; it does not use or modify existing schemas.