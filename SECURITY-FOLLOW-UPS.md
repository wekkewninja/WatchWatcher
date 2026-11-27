# Security Follow-ups

## Account and learning data (#29)

Account profiles and learning records are retained until the learner requests deletion. Account deletion requires an online connection, explicit confirmation, and fresh password or Google sign-in. A Google credential proves control of an existing Google session; it does not prove that Google asked for a password again. Exam-history persistence and separate history deletion are tracked by #22.

The API validates the bearer session and reauthentication against the same account. PostgreSQL deletes the user, linked identities, and progress in one transaction; the foreign key prevents a stale sync from recreating progress after deletion. Subsequent requests with the deleted account's token are rejected. A valid unexpired token can retry the deletion request after the account has already been removed.

The requesting browser deletes the account's IndexedDB progress and records a local tombstone to reject delayed writes. The IndexedDB version upgrade fences older clients after cleanup; an older open tab can block that upgrade until closed. Sign-in fails closed if local deletion status cannot be checked. If the server outcome is unknown, the browser keeps a deletion intent and local data, and shows an unresolved notice. If local cleanup fails after a confirmed server deletion, it keeps a retry marker. Browser storage can be unavailable or cleared independently, and a disconnected device cannot be remotely wiped. Other devices must clear their local data; this is not a guarantee of remote deletion.

Backup, diagnostic-log, and third-party provider retention must be assessed against applicable EU law and the actual deployment. GDPR does not prescribe one universal backup expiry period. No backup deletion deadline, legal compliance, or provider deletion guarantee is claimed until an owner selects and validates the applicable policy and processes.

## Distributed abuse controls (#28)

PostgreSQL is the existing shared service and can enforce atomic account-scoped quotas across Function instances. Store keyed hashes of identifiers rather than raw emails or tokens, apply identical rules to known and unknown accounts, use database time, and return generic retry information without logging secrets. Account deletion reauthentication also needs a quota.

Production ingress, trusted client-IP handling, direct-origin restrictions, operating costs, alerts, and risk ownership are not yet selected. Incoming forwarding headers must not be trusted until a specific ingress and origin-isolation policy are deployed and verified. Account-only limits do not satisfy the issue's IP-based acceptance criteria and do not replace ingress controls. No production resource should be provisioned without an approved architecture.

New passwords are limited to 72 UTF-8 bytes to prevent silent bcrypt truncation. Existing bcrypt hashes can still accept a truncated prefix; a safe recovery and migration strategy is tracked by #34. Do not describe legacy password reauthentication as proving knowledge of bytes beyond that limit.

## Verification

Use only synthetic data and a disposable PostgreSQL database. The CI migration and PostgreSQL tests create randomly named schemas and remove them after testing. No production system, user account, or third-party identity has been tested by these checks.