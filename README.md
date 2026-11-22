# WatchWatcher

Offline-first RYA Yachtmaster and ASA 105/106/108 study, visual training, and optional account sync.

## Workspace

- `services/watchwatcher-web`: Angular Material PWA for web, Android browsers, and Linux browsers.
- `services/watchwatcher-api`: Azure Functions v4 TypeScript API for sign-in, progress sync, and optional Gemini evaluation.
- `services/shared`: shared API types and Zod request schemas.
- `services/watchwatcher-web/public/assets`: bundled syllabus and COLREGs reference data cached by the service worker.

Study and deterministic grading work locally. IndexedDB progress is namespaced by signed-in account; rule exercise attempts are stored as uniquely identified events and merged idempotently with the account's PostgreSQL snapshot. Legacy shared-device progress is isolated in a guest namespace rather than assigned to whichever user signs in next. Sign-in, cloud synchronization, and Gemini grading are optional online enhancements; credentials remain on the API.

## Local setup

1. Install Node.js, npm, Azure Functions Core Tools v4, and Docker Compose.
2. Copy `.env.example` to `.env`. The development-only PostgreSQL defaults match `local.settings.json`; if you change the password, update its `DATABASE_URL` too. For Google sign-in, also set `GOOGLE_CLIENT_ID` under `Values` in the ignored `services/watchwatcher-api/local.settings.json`; Functions does not load the root `.env` file automatically.
3. Install workspace packages: `npm install`.
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

## Google Sign-in

Google sign-in uses Google Identity Services to obtain an ID token. The web app requests the public client ID from `GET /api/auth/google/config` and a short-lived, single-use nonce from `POST /api/auth/google/challenge`, then posts the credential to `POST /api/auth/google`. The API verifies signature, issuer, audience, expiry, nonce, and verified-email claim before issuing the normal WatchWatcher session. Google tokens are not stored. Configure the Google OAuth web client ID as the API setting `GOOGLE_CLIENT_ID` (in local development, add it to `Values` in the ignored `services/watchwatcher-api/local.settings.json`; in Azure, use an application setting). Restrict the OAuth client to the app's authorized origins.

If the verified Google email already belongs to a password account, the API returns a link-required state. The UI asks the user to explicitly confirm linking and re-enter that account's password; it then resubmits the still-live credential/challenge. The API verifies both credentials before associating the Google subject; matching email alone never merges accounts. Google-only accounts have no password hash until a password credential is explicitly added.

## COLREGs Study Content

The offline reference contains the 41 numbered COLREGs provisions and Annexes I–IV. Rule entries include an original study summary, key application points, International/Inland context, search terms, and one scenario-based multiple-choice exercise with immediate rationale and remediation. Rule details and exercises are bundled together in `services/watchwatcher-web/public/assets/reference/colregs_catalog.json` so the offline reference always has its matching practice item.

Content is a study aid, not authoritative legal text. It is checked against the [USCG Navigation Rules Amalgamated International & U.S. Inland](https://www.navcen.uscg.gov/navigation-rules-amalgamated); summaries and scenarios are written for this app rather than copied from the source. Local, vessel-specific, and amended rules can differ, so use the current applicable official publication for navigation decisions.

The web test suite verifies all rule numbers are present, rule and exercise IDs are unique, answers reference valid options, and each rule has complete study content. A component test covers selecting and checking an answer on a rule detail page.
