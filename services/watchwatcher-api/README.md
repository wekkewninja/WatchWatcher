# API Rate Limits

## Online Answer Evaluation

`POST /api/exam/evaluate` requires an authenticated session and `onlineConsent: true` on every request. It sends only `topicId`, `context`, and `answer` to Google Gemini; account, progress, and consent are not included in the provider prompt. Missing or false consent is rejected, including requests from older clients. Provider failure returns 503 rather than grading free text with keywords. Structured choice exercises remain available offline. Consent is not persisted; the exam requests it separately for each answer.

After authentication and input validation, online evaluation consumes a proposed fixed-window quota of 30 requests per hour per account, shared across instances. Failed provider calls count; invalid requests do not. The provider must explicitly report a boolean critical-failure judgment and a consistent reason (nonempty when true, null when false); uncertain, missing, or malformed judgments return 503. A pass requires both the topic score threshold and an explicit false flag. This is fallible AI judgment, not authoritative navigation guidance; structural checks cannot prove the judgment or narrative is factually correct or consistent. Guest structured practice remains separate from account progress.

Before enabling password login, registration, or account deletion, apply the database migrations and configure `DATABASE_URL`, `JWT_SECRET`, and `RATE_LIMIT_SECRET` as server-side application settings on every API instance. `RATE_LIMIT_SECRET` must be a dedicated, randomly generated secret of at least 32 characters, distinct from `JWT_SECRET`, and identical across instances. Keep it out of source control and logs. Development and test use the same requirements; there is no bypass. Missing, short, or reused secrets and unavailable PostgreSQL cause the affected operations to return 503. Replacing the secret resets the effective quotas; coordinate rotation across instances.

Password login, session, and Google account-link password verification share five attempts per 15-minute fixed window per trimmed, lowercased email, including unknown emails. Registration allows five attempts per hour per normalized email. Account deletion allows five attempts per 15 minutes per verified session account ID; an already-deleted account may confirm deletion without consuming quota. Attempts count regardless of outcome, including successful ones. An exhausted quota returns 429 with `Retry-After` in seconds. Fixed windows can allow bursts across their boundary, and an attacker who knows an identifier can exhaust its quota.

## Password Hashing And Recovery

New passwords use Node's asynchronous `crypto.scrypt` with OWASP's scrypt profile N=16384 (2^14), r=8, p=5. This profile uses approximately 16 MiB per derivation; `maxmem` is 32 MiB to accommodate implementation overhead. The 16-byte salt comes from `crypto.randomBytes`, and the 32-byte derived key is compared with `timingSafeEqual`. Stored hashes use `scrypt$v=1$N=16384,r=8,p=5$<base64url-salt>$<base64url-key>`. Only that exact version, parameters, canonical encoding, and lengths are accepted, preventing stored values from selecting excessive work factors. Changing parameters requires an explicitly supported new version.

Registration, login, Google linking, and password reauthentication accept up to 1,024 Unicode code points and 4,096 UTF-8 bytes; unpaired UTF-16 surrogates are rejected. Registration requires at least 10 Unicode code points, login and linking 8, and deletion 1. Passwords are used exactly as entered, encoded as UTF-8, without trimming, case folding, or Unicode normalization; visually identical sequences can therefore be different passwords. PostgreSQL's existing `users.password_hash` nullable `text` column accommodates the encoded value; no data migration or deletion is performed.

Legacy bcrypt hashes cannot authenticate via password login, linking, or deletion. A matching bcrypt prefix does not prove the original full password, so there is no automatic conversion. Existing rows remain intact and previously linked Google sign-in continues to work. A separately designed and approved recovery process is required for password-only legacy accounts and for linking an unlinked Google identity; do not delete accounts or data as a workaround. Password login failures remain generic for unknown, legacy, malformed, and incorrect credentials. Constant-time key comparison does not imply uniform response timing: unknown, legacy, and malformed hashes skip scrypt. Registration's existing duplicate-email response can disclose account existence.

Unknown, missing, legacy, and malformed hashes use one fixed-cost dummy scrypt derivation; valid hashes use the same scrypt parameters. This does not prove uniform end-to-end timing: database access, parsing, scheduling, and other factors may differ. The identifier quotas above run before derivation but do not limit aggregate concurrent requests or identifier spray. Aggregate denial-of-service protection remains a release blocker: benchmark CPU, memory, libuv thread-pool contention, and latency under representative load, and provision aggregate ingress/concurrency controls and monitoring before public exposure. Never log passwords, secrets, or complete password hashes.

Only HMAC-SHA256 identifiers are stored. Expired rows are not removed automatically: arrange periodic, repeated bounded batches using the expiry index, and monitor table growth. Run this statement until no rows are deleted, with a transaction committed after each batch:

```sql
DELETE FROM identifier_rate_limits
WHERE key_hash IN (
  SELECT key_hash FROM identifier_rate_limits
  WHERE expires_at <= clock_timestamp()
  ORDER BY expires_at
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
);
```

The row lock ensures cleanup cannot delete a concurrently renewed window. Choose a maintenance schedule and privileges for the deployed environment; no scheduler is provisioned here.

## Session And Deletion Retention

Deployment blocker: provision and monitor a scheduler with permission to execute `maintenance/cleanup-expired-sessions.sql` before deploying session revocation. No scheduler is configured by this repository. Run the file periodically, repeating until both DELETE counts are zero and committing each batch. Each statement deletes at most 1,000 expired rows using the expiry indexes and skips rows locked by active transactions. Alert on scheduler failures and table growth. The account index supports session cascade deletion.

A successful account deletion creates a hashed receipt for its initiating session in the deletion transaction, expiring no later than that token. An unexpired signed initiating token can use the receipt only to confirm DELETE; it cannot authenticate normal requests. Logged-out sessions and other sessions cannot confirm it. Google retry confirmation does not consume the already-used challenge again. Receipts do not resolve an ambiguous deletion after the initiating token expires or is lost on reload.

Receipt hashes bind the account ID and session ID with a NUL separator. Logout deletes the matching session and receipt in that order in one READ COMMITTED transaction; a concurrent deletion holding the session row completes first, and logout then removes its receipt. Logout retries require a valid, unexpired signed token but do not grant normal access. Receipts created with the earlier session-only hash cannot be confirmed after this change and remain until expiry cleanup. An operation authorized before token expiry may finish afterward; expired tokens cannot initiate a retry.

Logout rejects calls whose session validation happens after revocation completes. An operation that was already authorized before revocation may still complete afterward; logout does not cancel in-flight operations. Account deletion separately locks and revalidates the session in its transaction.

These are identifier quotas, not IP controls. They do not prevent identifier spray, multiple-account abuse, or distributed IP abuse. Trusted client IP derivation, ingress limits, Google challenge/sign-in limits, aggregate provider spending controls, and operational alerting remain unresolved before public exposure.