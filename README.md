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
