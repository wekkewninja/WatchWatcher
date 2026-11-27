# API Rate Limits

Before enabling password login, registration, or account deletion, apply the database migrations and configure `DATABASE_URL`, `JWT_SECRET`, and `RATE_LIMIT_SECRET` as server-side application settings on every API instance. `RATE_LIMIT_SECRET` must be a dedicated, randomly generated secret of at least 32 characters, distinct from `JWT_SECRET`, and identical across instances. Keep it out of source control and logs. Development and test use the same requirements; there is no bypass. Missing, short, or reused secrets and unavailable PostgreSQL cause the affected operations to return 503. Replacing the secret resets the effective quotas; coordinate rotation across instances.

Password login, session, and Google account-link password verification share five attempts per 15-minute fixed window per trimmed, lowercased email, including unknown emails. Registration allows five attempts per hour per normalized email. Account deletion allows five attempts per 15 minutes per verified session account ID; an already-deleted account may confirm deletion without consuming quota. Attempts count regardless of outcome, including successful ones. An exhausted quota returns 429 with `Retry-After` in seconds. Fixed windows can allow bursts across their boundary, and an attacker who knows an identifier can exhaust its quota.

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

These are identifier quotas, not IP controls. They do not prevent identifier spray or distributed IP abuse. Production ingress, trusted proxy handling, Google challenge/sign-in and evaluation limits, and operational alerting remain to be designed before public exposure.