# Security Follow-ups

## Decisions To Implement

- The product owner is also the production security owner. Compare Azure Front Door/WAF and API Management, including the lowest viable total cost, before selecting or provisioning ingress. No budget or paid resources are approved yet.
- Keep the existing five-attempt, 15-minute account sign-in limit and provide a recovery path. Propose and test separate limits for registration, Google flows, evaluation, and trusted IPs. Public release remains blocked until trusted ingress, origin isolation, cleanup, and monitoring are approved.
- Revoke sessions server-side on online logout. Offline logout must clear the local session immediately and warn that remote revocation was not confirmed; the existing short token expiry bounds that residual window.
- Keep account and learning data until the learner requests deletion. Deletion requires online confirmation and fresh password or Google sign-in; an explicit fresh Google credential is accepted even if Google reuses its existing session.
- Investigate cleanup on other offline devices. When the outcome of an account deletion is uncertain, preserve local data and ask the learner before clearing it.
- Assess EU requirements and actual infrastructure before proposing backup, diagnostic-log, and provider retention periods. Do not claim a universal GDPR retention deadline or compliance certification.
- Require an informed opt-in before sending learner answers to Gemini and offer an offline alternative.
- Support long Unicode passwords using a versioned hashing scheme that does not truncate UTF-8 input. There are no existing accounts that must be preserved; do not delete any existing data without separate approval.

## Account and learning data (#29)

Account profiles and learning records are retained until the learner requests deletion. Account deletion requires an online connection, explicit confirmation, and fresh password or Google sign-in. A Google credential proves control of an existing Google session; it does not prove that Google asked for a password again. Exam-history persistence and separate history deletion are tracked by #22.

The API validates the bearer session and reauthentication against the same account. PostgreSQL deletes the user, linked identities, sessions, and progress in one transaction; the foreign key prevents a stale sync from recreating progress after deletion. A short-lived receipt lets the initiating unexpired token confirm deletion without authorizing any other operation. Server-side logout revokes the active session; requests already authorized before revocation may still finish. Offline or unconfirmed logout clears local credentials and warns about the remaining token lifetime.

The requesting browser deletes the account's IndexedDB progress and records a local tombstone to reject delayed writes. The IndexedDB version upgrade fences older clients after cleanup; an older open tab can block that upgrade until closed. Sign-in fails closed if local deletion status cannot be checked. If the server outcome is unknown, the browser keeps a deletion intent and local data and offers separately confirmed local cleanup. Local cleanup does not establish server deletion. The same browser profile remains fenced afterward; recovering a still-existing account currently requires a separate profile. If local cleanup fails after a confirmed server deletion, it keeps a retry marker where storage permits. Browser storage can be unavailable or cleared independently, and a disconnected device cannot be remotely wiped. Other devices must clear their local data; this is not a guarantee of remote deletion.

Backup, diagnostic-log, and third-party provider retention must be assessed against applicable EU law and the actual deployment. GDPR does not prescribe one universal backup expiry period. No backup deletion deadline, legal compliance, or provider deletion guarantee is claimed until an owner selects and validates the applicable policy and processes.

## Distributed abuse controls (#28)

PostgreSQL is the existing shared service and can enforce atomic account-scoped quotas across Function instances. Store keyed hashes of identifiers rather than raw emails or tokens, apply identical rules to known and unknown accounts, use database time, and return generic retry information without logging secrets. Account deletion reauthentication also needs a quota.

The product owner owns these controls; production ingress, trusted client-IP handling, direct-origin restrictions, costs, and alerts remain to be approved. Incoming forwarding headers must not be trusted until a specific ingress and origin-isolation policy are deployed and verified. Account-only limits do not satisfy the issue's IP-based acceptance criteria and do not replace ingress controls. No production resource should be provisioned without an approved architecture.

New passwords use versioned scrypt with bounded full UTF-8 input; legacy bcrypt hashes fail closed without modifying stored accounts. Password-only legacy accounts need a separately designed recovery process if any are discovered. Online AI evaluation requires per-answer consent and an authenticated, account-scoped quota; structured practice is available offline. See the API README for parameters and operational requirements.

## Ingress Comparison

As of 2026-11-27, the Microsoft pricing pages displayed indicative USD base prices of $35/month for Front Door Standard and $147.17/month for API Management Basic classic, or $150.01/month for Basic v2. These are not quotes: region, agreement, currency, traffic, WAF rules, logging, database, Functions, and AI costs can change the total. Front Door Standard supports custom WAF rules; Premium adds managed rules and other security features. API Management Consumption is cheaper at low volume but the `rate-limit-by-key` policy does not list that tier as supported. Verify current SKU availability and policy support before selection.

Front Door Standard with custom WAF is a candidate for the lowest fixed gateway cost, not an approved or proven cheapest complete architecture. Its rate counters are per edge location and can be approximate; API Management counters are per gateway and also approximate. Neither alone supplies strict global quotas or blocks distributed attacks. Shared PostgreSQL quotas, tested origin restrictions, aggregate capacity limits, alerts, a recovery path for targeted account lockout, and a cost estimate using actual traffic are still required. Front Door appends to `X-Forwarded-For`; client-supplied values must not be trusted. Its documented socket IP is distinct from a potentially spoofed client IP, and origin restrictions must verify both the service network and the specific Front Door instance.

Proposed gateway starting points for measurement, not approved enforcement: per socket IP in five minutes, 30 login/session requests, 10 registrations, 20 Google challenges, 15 Google sign-ins, and 20 evaluations. Review false positives for shared networks and the providers' low-threshold accuracy before enabling. The existing shared account limits remain five login attempts per 15 minutes, five registrations per hour, five deletion attempts per 15 minutes, and 30 evaluations per hour. The product owner must approve all gateway thresholds and recovery procedures after testing.

Sources: [Front Door pricing](https://azure.microsoft.com/en-us/pricing/details/frontdoor/), [WAF pricing](https://azure.microsoft.com/en-us/pricing/details/web-application-firewall/), [API Management pricing](https://azure.microsoft.com/en-us/pricing/details/api-management/), [Front Door rate limits](https://learn.microsoft.com/en-us/azure/web-application-firewall/afds/waf-front-door-rate-limit), [Front Door headers](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-http-headers-protocol), and [API Management rate limits](https://learn.microsoft.com/en-us/azure/api-management/rate-limit-by-key-policy).

## Retention Assessment

Record the actual controller, applicable jurisdiction, processing purposes, providers, regions, and lawful bases with qualified privacy advice before production. GDPR's storage-limitation and erasure requirements do not prescribe one universal backup expiry. Define deletion and restoration procedures for live PostgreSQL, backups, logs, local devices, expired session/receipt and quota rows, Google identity, and Gemini data separately. Decide retention periods and exceptions for legal obligations, ensure restored backups cannot silently reinstate deleted accounts, test the procedure, and publish the resulting notice. The Gemini provider's terms, processing location, retention, and deletion capabilities remain unverified; per-answer consent does not establish any provider retention guarantee. See [GDPR Articles 5 and 17](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

## Verification

Use only synthetic data and a disposable PostgreSQL database. The CI migration and PostgreSQL tests create randomly named schemas and remove them after testing. No production system, user account, or third-party identity has been tested by these checks.