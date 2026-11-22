# WatchWatcher

Offline-first RYA Yachtmaster and ASA 105/106/108 study, visual training, and optional account sync.

## Workspace

- `services/watchwatcher-web`: Angular Material PWA for web, Android browsers, and Linux browsers.
- `services/watchwatcher-api`: Azure Functions v4 TypeScript API for sign-in, progress sync, and optional Gemini evaluation.
- `services/shared`: shared API types and Zod request schemas.
- `services/watchwatcher-web/public/assets`: bundled syllabus and COLREGs reference data cached by the service worker.

Study and deterministic grading work locally. Progress is stored in IndexedDB. Sign-in, PostgreSQL synchronization, and Gemini grading are optional online enhancements; credentials remain on the API.

## Local setup

1. Install Node.js, npm, Azure Functions Core Tools v4, and Docker Compose.
2. Copy `.env.example` to `.env`. The development-only PostgreSQL defaults match `local.settings.json`; if you change the password, update its `DATABASE_URL` too. `local.settings.json` is ignored by Git.
3. Start local PostgreSQL and Azurite: `docker compose up -d`.
4. Install workspace packages: `npm install`.
5. Build both services: `npm run build`.
6. Run the PWA: `npm --workspace services/watchwatcher-web start`.
7. Run the API in a second terminal: `npm --workspace services/watchwatcher-api start`.

The API is served at `http://localhost:7071/api`; the Angular development server proxies `/api` to Functions. Database schema migrations are intentionally left for the integration step; do not insert seed data.

## Verification

- `npm test --workspace services/watchwatcher-web`
- `npm test --workspace services/watchwatcher-api`
- `npm run build`

The development-only state selector exposes data, loading, empty, and error states. Production disables it and the Angular service worker caches the app shell and bundled learning content.

## COLREGs Study Content

The offline reference contains the 41 numbered COLREGs provisions and Annexes I–IV. Rule entries include an original study summary, key application points, International/Inland context, search terms, and one scenario-based multiple-choice exercise with immediate rationale and remediation. Rule details and exercises are bundled together in `services/watchwatcher-web/public/assets/reference/colregs_catalog.json` so the offline reference always has its matching practice item.

Content is a study aid, not authoritative legal text. It is checked against the [USCG Navigation Rules Amalgamated International & U.S. Inland](https://www.navcen.uscg.gov/navigation-rules-amalgamated); summaries and scenarios are written for this app rather than copied from the source. Local, vessel-specific, and amended rules can differ, so use the current applicable official publication for navigation decisions.

The web test suite verifies all rule numbers are present, rule and exercise IDs are unique, answers reference valid options, and each rule has complete study content. A component test covers selecting and checking an answer on a rule detail page.
