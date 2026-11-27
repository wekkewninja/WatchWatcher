# WatchWatcher

Offline-first RYA Yachtmaster and ASA 105/106/108 study, visual training, and optional account sync.

## Workspace

- `services/watchwatcher-web`: Angular Material PWA for web, Android browsers, and Linux browsers.
- `services/watchwatcher-api`: Azure Functions v4 TypeScript API for sign-in, progress sync, and optional Gemini evaluation.
- `services/shared`: shared API types and Zod request schemas.
- `services/watchwatcher-web/public/assets`: bundled syllabus and COLREGs reference data cached by the service worker.

Study, structured-choice grading, and objective-based progress calculations work locally. Curriculum and Exam free-text grading require explicit per-answer consent and online evaluation. IndexedDB progress is namespaced by signed-in account; rule and objective practice attempts plus completed Exam sessions are stored as uniquely identified events and merged idempotently with the account's revision-aware PostgreSQL snapshot. Practice mastery and Exam results remain distinct, and Exam history deletion synchronizes tombstones so offline deletion is not undone. Legacy shared-device progress is isolated in a guest namespace rather than assigned to whichever user signs in next. Sign-in, cloud synchronization, and Gemini grading are optional online enhancements; credentials remain on the API.

## Local setup

The default Node.js version is pinned to 22.22.3 in `.nvmrc`, the minimum required by the locked Angular toolchain. Supported runtimes are Node 22.22.3 or newer within the 22.x line and Node 26.x, with npm 10.x or 11.x. Node 20 and Node 23–25 are intentionally unsupported; `.npmrc` enables strict engine checks. To select the default with nvm or nvm-windows, run `nvm install 22.22.3` and `nvm use 22.22.3`.

1. Install the supported Node.js/npm version, Azure Functions Core Tools v4, and Docker Compose.
2. Copy `.env.example` to `.env`. The development-only PostgreSQL defaults match `local.settings.json`; if you change the password, update its `DATABASE_URL` too. Under `Values` in the ignored `services/watchwatcher-api/local.settings.json`, set `RATE_LIMIT_SECRET` to a new random secret of at least 32 characters, distinct from `JWT_SECRET`. For Google sign-in, also set `GOOGLE_CLIENT_ID`. Functions does not load the root `.env` file automatically. Do not commit these settings.
3. Install workspace packages from the lockfile: `npm ci`.
4. Start local PostgreSQL and Azurite: `docker compose up -d postgres azurite`.
5. Apply the API schema migration: `docker compose run --rm db-migrate`.
6. Build both services: `npm run build`.
7. Run the PWA: `npm --workspace services/watchwatcher-web start`.
8. Run the API in a second terminal: `npm --workspace services/watchwatcher-api start`.

The API is served at `http://localhost:7071/api`; the Angular development server proxies `/api` to Functions. Migrations create schema only and do not insert seed data.

## Verification

- `npm test --workspace services/watchwatcher-web`
- `npm test --workspace services/watchwatcher-api`
- `npm run build`

The development-only state selector exposes data, loading, empty, and error states. Production disables it and the Angular service worker caches the app shell and bundled learning content.

## Main Branch Quality Gate

The GitHub Actions workflow `CI` produces the check named `verify`. It runs for pull requests to `main` and pushes to `main`, using the Node version pinned in `.nvmrc` and a clean lockfile install. Reproduce its checks locally with:

```sh
npm ci
npm run build
npm run test:coverage-gate
npm run test:coverage
npm run test:icons
npm audit --omit=dev --audit-level=high
```

Stop any running development processes before `npm ci`; they can lock files in `node_modules`, particularly on Windows. The Angular and API coverage runs also execute their normal tests. `test:coverage-gate` checks the aggregator's thresholds and fail-closed behavior; `test:coverage` generates the two reports and enforces at least 85% combined line coverage, at least 85% for noncritical source, and at least 90% across critical logic.

Coverage includes every `.ts` source file under `services/watchwatcher-web/src`, `services/watchwatcher-api/src`, and `services/shared`, including files not imported by tests. It excludes declaration files and `.spec.ts`/`.test.ts` files; generated build output, configuration, fixtures, and non-TypeScript assets outside those source roots are not included. The API report covers shared source so it is counted once. The gate sums covered and total instrumentable lines, rather than averaging workspace percentages, and fails if a report or source-file entry is missing or malformed. Reports are written under each workspace's `coverage` directory.

The 90% critical-logic subset is the browser API client, auth-state service, auth guard, local storage repository and learner progress/sync service; the API authentication, Google identity verification, evaluation and PostgreSQL services; and shared request validation and offline evaluation. The remaining included application source must also reach 85%. The gate reports the critical subset, the remaining source, and the combined result separately.

The production dependency audit blocks High and Critical findings. Lower-severity and development-only findings are reported by a separate non-blocking audit; review them rather than assuming they are safe. An unavailable audit service also fails the required production audit. Investigate test, build, coverage, or audit failures locally and fix them before merging; do not lower the threshold or hide application code to pass.

After the updated workflow is merged into `main` and its `verify` check from GitHub Actions has passed there, enable branch protection for `main`: require pull requests and that status check, apply restrictions to administrators, block force pushes and deletion, and do not require a separate approval. Inspect the active protection after applying it. Administrators retain the ability to change repository settings; in a genuine emergency, document who changed the protection, why, and when, then restore and verify the original rule immediately afterward. Do not merge a PR without explicit human authorization.

## Google Sign-in

Google sign-in uses Google Identity Services to obtain an ID token. The web app requests the public client ID from `GET /api/auth/google/config` and a short-lived, single-use nonce from `POST /api/auth/google/challenge`, then posts the credential to `POST /api/auth/google`. The API verifies signature, issuer, audience, expiry, nonce, and verified-email claim before issuing the normal WatchWatcher session. Google tokens are not stored. Configure the Google OAuth web client ID as the API setting `GOOGLE_CLIENT_ID` (in local development, add it to `Values` in the ignored `services/watchwatcher-api/local.settings.json`; in Azure, use an application setting). Restrict the OAuth client to the app's authorized origins.

If the verified Google email already belongs to a password account, the API returns a link-required state. The UI asks the user to explicitly confirm linking and re-enter that account's password; it then resubmits the still-live credential/challenge. The API verifies both credentials before associating the Google subject; matching email alone never merges accounts. Google-only accounts have no password hash until a password credential is explicitly added.

## COLREGs Study Content

The offline reference contains the 41 numbered COLREGs provisions and Annexes I–IV. Rule entries include an original study summary, key application points, International/Inland context, search terms, and one scenario-based multiple-choice exercise with immediate rationale and remediation. Rule details and exercises are bundled together in `services/watchwatcher-web/public/assets/reference/colregs_catalog.json` so the offline reference always has its matching practice item.

Content is a study aid, not authoritative legal text. It is checked against the [USCG Navigation Rules Amalgamated International & U.S. Inland](https://www.navcen.uscg.gov/navigation-rules-amalgamated); summaries and scenarios are written for this app rather than copied from the source. Local, vessel-specific, and amended rules can differ, so use the current applicable official publication for navigation decisions.

The web test suite verifies all rule numbers are present, rule and exercise IDs are unique, answers reference valid options, and each rule has complete study content. A component test covers selecting and checking an answer on a rule detail page.
