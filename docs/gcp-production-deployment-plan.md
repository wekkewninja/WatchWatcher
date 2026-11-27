# GCP Production Deployment Proposal

Status: cloud deployment deferred by user request while the full application is tested locally in Docker Compose. No GCP or Azure resources, DNS, or credentials have been created or changed. This proposal is retained for issue #13 if cloud deployment resumes. The current preferences are an early pilot of up to 10 users, `europe-west1`, an existing Google OAuth project as a candidate, and a €10/month ceiling. The project ID, billing status, ownership, enabled services, and any Azure subscription/resources have not been inventoried. Provisioning requires explicit approval after inventory and a cost plan compatible with that ceiling.

## Current application

- Angular PWA in `services/watchwatcher-web`, currently served as static build output.
- Node.js/TypeScript API in `services/watchwatcher-api`, currently registered against Azure Functions v4 HTTP triggers (`@azure/functions`).
- PostgreSQL is the persistent account/progress store; existing migrations are under `services/watchwatcher-api/migrations`.
- `IBlobStorageService` currently exposes only `healthCheck()`. The Azure Blob/Azurite implementation checks account properties; the application does not currently upload or download user objects through this interface.
- Gemini evaluation is an optional API feature configured with `GEMINI_API_KEY` and explicit per-answer consent.
- Existing GitHub Actions CI validates PRs and `main`; it does not deploy.

## Proposed GCP architecture

| Concern | Proposed service | Notes |
| --- | --- | --- |
| Static PWA | Firebase Hosting | Publish the Angular production build; start with the Firebase-provided `web.app` hostname. Add a custom domain only after ownership/DNS approval. The existing OAuth project can host Firebase resources if billing, ownership, and isolation requirements are satisfied. |
| API | Cloud Run service, `watchwatcher-api` | Port the Azure Functions route registrations to a Node HTTP server while preserving `/api/*` contracts and the existing shared service layer. Do not run Azurite or require Azure Functions Core Tools in production. Scale to zero and set a conservative maximum instance count. |
| API routing | Firebase Hosting rewrite for `/api/**` to Cloud Run | Same-origin API calls avoid a separate browser CORS configuration. Firebase Hosting-to-Cloud Run requires a billing-enabled Firebase/GCP project; attaching billing changes a Spark project to Blaze. |
| Database | Cloud SQL for PostgreSQL, single-zone pilot instance | Preserve PostgreSQL and current migrations. Use private/managed Cloud SQL connectivity from Cloud Run; keep the DB non-public. A single-zone instance is a pilot availability trade-off, not HA. |
| Migrations | Cloud Run Job `watchwatcher-migrate` | Run once per release before API rollout. Keep migrations additive/backward-compatible; a migration failure must stop deployment. Never run destructive rollback automatically. |
| Object storage | Cloud Storage Standard, conditional | Create a regional bucket only if production needs actual object storage or the health contract is intentionally retained. Current code has no object operations, so do not create a bucket merely to mimic Azure Blob. |
| Secrets | Secret Manager | Store DB credentials, `JWT_SECRET`, `RATE_LIMIT_SECRET`, and `GEMINI_API_KEY`; grant access only to the API service account. `GOOGLE_CLIENT_ID` is configuration, not a private key. |
| Images | Artifact Registry | Store immutable API images tagged with the commit SHA. |
| Identity | GitHub Actions OIDC / Workload Identity Federation | No long-lived service-account key in GitHub. Separate deploy identity from runtime service identity and grant least privilege. |

## Cross-cloud recommendation

For the production stack described in issue #13, **Azure is the lower-risk choice** unless GCP is a firm platform requirement. This repository already uses Azure Functions v4 and Azure Blob Storage; Azure preserves those runtime/storage integrations. PostgreSQL migrations are portable to either provider. GCP would require porting the HTTP host to Cloud Run and replacing the Azure storage health adapter with a Google Cloud Storage adapter.

For a small pilot, Azure Static Web Apps Free and Azure Functions Consumption/Flex Consumption have no-cost quotas. Blob storage at low volume is inexpensive. The published Azure PostgreSQL Flexible Server B1ms reference is about **USD 12.41/month for compute before storage**; regional pricing and eligibility must be checked in the calculator. Therefore Azure is still slightly above the €10 ceiling for a persistent managed database, but is substantially closer than the GCP dedicated Cloud SQL baseline. Eligible new Azure accounts may have temporary promotional credits; do not treat them as recurring budget.

Recommendation: use Azure for the intended managed production deployment if the budget can rise modestly above €10/month. If €10 is a hard limit for a temporary test only, evaluate the single-VM Compose option and explicitly accept its lack of HA/SLA, manual operations, and uncertain fit after disk/IP/backups. Do not represent that VM configuration as production-ready. No Azure subscription/resource inventory was possible because Azure CLI/authentication is unavailable in this workspace.

## Lower-cost test-stage alternative

For a disposable cloud test stage under a strict budget, one possible alternative is a small Compute Engine VM running the web server/API/PostgreSQL with Docker Compose and an attached persistent disk. The current selected path is local Docker Compose, not this cloud VM. The container image is not the main cost; the VM, persistent disk, public IPv4, backups, and egress are. Keep PostgreSQL bound to localhost/private interfaces, expose only HTTPS through a reverse proxy, and schedule encrypted off-VM backups to Cloud Storage. This can be materially cheaper than Cloud SQL, but it is self-managed, single-zone, has no managed database SLA, and requires OS/database patching, monitoring, restore tests, and manual recovery. A VM failure or disk problem can interrupt the whole stack. A very small VM may not have enough memory for Node, PostgreSQL, and the web server together.

Do not run PostgreSQL on Cloud Run's writable filesystem: Cloud Run disks are instance-scoped ephemeral storage and all contents are deleted when that instance shuts down. Cloud Run can host the stateless API, but the database needs Cloud SQL, an external managed PostgreSQL service, or a VM with persistent storage.

The Compute Engine Always Free `e2-micro` allowance applies only in `us-west1`, `us-central1`, or `us-east1`; it does not apply in the selected `europe-west1` region. A minimal European VM may approach a low pilot budget, but VM CPU/RAM, persistent disk, external IPv4, snapshots/backups, network egress, and logging all contribute. The exact bill cannot be established from the public pricing page alone; use the Pricing Calculator for the chosen machine, disk, IP, and region. An e2-micro's limited memory may also be insufficient for API plus PostgreSQL together. Treat this option as test-only and do not claim production reliability. It is an alternative to evaluate, not an approved architecture or provision request.

## API porting work required

Cloud Run runs containers/HTTP servers; it does not natively host the Azure Functions programming model. The current function modules import `@azure/functions` and register handlers with `app.http`. Before enabling deployment, move route logic behind a portable HTTP router (for example, Express) or add a thoroughly tested Cloud Run adapter. Reuse the current auth, database, evaluation, validation, and error-handling services. Keep route names, methods, schemas, OpenAPI, API tests, and health behavior aligned. Replace `ManagedIdentityBlobStorageService` with a GCS adapter only if the object-storage/health requirement is confirmed.

The API container must listen on `0.0.0.0:$PORT` (default 8080), handle SIGTERM, and not log credentials or submitted free-text answers. Production configuration must not include Azurite or development defaults.

## Release workflow

1. PRs and non-`main` branches run validation only and receive no production identity or secrets.
2. A successful CI run for a push to `main` triggers a serialized production workflow for that exact SHA. A `workflow_run` trigger must verify `conclusion == success`, `event == push`, and `head_branch == main` before obtaining the OIDC token.
3. Build and push an immutable API image to Artifact Registry; build the frontend from the same SHA.
4. Execute the migration job once and block rollout on failure.
5. Deploy the Cloud Run revision, then publish the frontend/Hosting rewrite for the same SHA.
6. Verify `/` and `/api/health`; record the SHA, release URLs, and health result.
7. On failure, leave the prior Cloud Run revision and Firebase Hosting release available for rollback. Recovery should redeploy the previous SHA; schema rollback is not automatic.

Protect the GitHub `production` environment, scope the WIF provider to this repository and the `main` branch, and make deploy workflow permissions read-only plus `id-token: write` only where needed. Keep deployment concurrency to one production run.

## Preliminary cost model

Assumptions: up to 10 pilot users, `europe-west1`, one API service scaling to zero, one single-zone Cloud SQL instance for the production baseline, low object storage, Firebase's default domain, and no unusually high Gemini, egress, or log usage. The user requested a test-stage ceiling of **€10/month**. Prices are usage-sensitive and USD amounts below are an order-of-magnitude planning range, not a quote.

- Cloud SQL is the fixed-cost driver. A dedicated 1-vCPU / 3.75-GiB single-zone instance is roughly USD 50/month in the published `us-central1` reference rates before disk, backups, networking, and region differences. Budget roughly **USD 55–100/month** for a small dedicated pilot database in Europe, pending the exact `europe-west1` calculator configuration. That baseline is substantially above €10/month before the API, logs, backups, and traffic. Shared-core instances are cheaper but are not covered by the Cloud SQL SLA and are not the proposed production baseline.
- The single-VM Compose option may fit a test budget better, but no exact `europe-west1` VM estimate is verified yet. Public Free Tier compute hours are limited to US regions; they cannot be assumed for this European pilot.
- Cloud Run request-based billing can scale to zero; low pilot traffic may fit within applicable free quotas, but free-tier rates are based on published regional rules and must be checked for `europe-west1`. Set max instances to bound accidental scaling.
- Firebase Hosting should remain within no-cost quotas at low pilot usage, but Hosting rewrites to Cloud Run require billing to be enabled. Check bandwidth and rewrite usage against Blaze pricing.
- Cloud Storage costs should be negligible for a small regional bucket, if one is needed. It has no Always Free allowance in `europe-west1`; do not provision it until the application need is confirmed.
- Artifact Registry, Cloud Build, logging, backups, network egress, Gemini API use, and domain registration can add charges. Configure budget alerts, but note that budget alerts are notifications, not a hard spending cap.

Official pricing references: [Cloud Run](https://cloud.google.com/run/pricing), [Cloud SQL](https://cloud.google.com/sql/pricing), [Firebase Hosting](https://firebase.google.com/pricing), and [Cloud Storage](https://cloud.google.com/storage/pricing).

## Inventory and outstanding approvals

No GCP inventory could be collected: `gcloud` is not installed/authenticated, and no project ID was supplied. The existing Google OAuth project is a candidate but has not been verified for billing, IAM ownership, enabled APIs, existing resources, or production suitability. No domain/DNS ownership or existing production endpoints were available in the repository. The repo's `.azure/requirements.json` describes an earlier, incompatible app scaffold and is not an authoritative inventory for this deployed Angular/Azure Functions codebase.

Before provisioning or configuring live deployment, confirm:

- Existing OAuth project's ID, owning organization, billing status, and authority to enable APIs/create resources; confirm whether production may reuse it or needs a separate project.
- Resolve the budget mismatch: approve a higher cap for managed PostgreSQL production, or approve evaluating the explicitly test-only single-VM Compose option (or an existing external database) against the €10 cap and document its reliability/security trade-offs.
- Monthly budget alert threshold and acceptance of the single-zone database availability trade-off.
- Confirm the default `web.app` hostname (no custom domain was supplied).
- Whether GCS is required beyond a health check.
- Whether existing Azure production data/resources exist and need migration; this has not been inventoried.
- Written approval of the costed configuration before any resource creation, billing attachment, or production workflow activation.
