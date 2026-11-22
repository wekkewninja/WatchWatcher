# WatchWatcher Integration Handoff

## Backend
- Folder: `services/watchwatcher-api/`
- Run: `npm --workspace services/watchwatcher-api start` from the workspace root; package prestart cleans and builds, then runs Azure Functions Core Tools on port `7071`.
- Build: `npm --workspace services/watchwatcher-api run build`
- Health: `GET /api/health`
- Local database/emulator: `docker compose up -d`; local Functions values are in ignored `services/watchwatcher-api/local.settings.json`.
- Production signing configuration: `JWT_SECRET` (minimum 32 characters), `JWT_ISSUER`, `JWT_AUDIENCE`.

## Frontend
- Folder: `services/watchwatcher-web/`
- Run: `npm --workspace services/watchwatcher-web start` on port `4200`; `proxy.conf.json` forwards `/api` to `http://127.0.0.1:7071`.
- Build: `npm --workspace services/watchwatcher-web run build`
- API swap seam: `services/watchwatcher-web/src/api/index.ts`; repoint the exported `api: ApiClient` from `mockClient` to the live client. Keep all page calls behind this seam.
- Delete mock-only files after wiring: `src/api/mock-client.ts`, `src/mocks/data.ts`, `src/api/preview-state.ts`, and `src/app/shared/preview-state-switcher.component.ts` (also remove the switcher from `src/app/app.ts` and `src/app/app.html`).
- Replace local domain types in `src/app/domain-types.ts` with shared imports; update `src/api/types.ts` against the same contract. The local seeded identity in `src/mocks/data.ts` must be replaced with API session state. Keep bearer tokens in memory, not browser storage.
- Local progress is stored in IndexedDB by `src/app/core/storage-repository.service.ts`; cloud sync conflicts/failures must never overwrite that local snapshot.
- Examiner mode defaults to structured offline Rule 19 fields. Free text is shown only while online and must be graded with an API result whose `source` is `online`; an `offline` fallback must not score free text.

## API Routes
- `GET /api/health` — public; `{ status, services }`; degraded returns 200, unhealthy returns 503.
- `POST /api/auth/register` — public; `{ name, email, password }`; 201, 409, 422.
- `POST /api/auth/login` — public; `{ email, password }`; returns `{ accountId, session, user }`.
- `POST /api/auth/session` — public planned session route; `{ email, password }`; returns `{ accountId, session, user }`.
- `GET /api/auth/me` — bearer-authenticated; returns `{ user }`.
- `GET /api/progress` — bearer-authenticated; account-scoped `{ topicMastery, weakSpotLog, drillQueue, revision, syncedAt }`.
- `PUT /api/progress` — bearer-authenticated; snapshot plus `revision`; 409 for stale revisions.
- `POST /api/exam/evaluate` — bearer-authenticated; `{ topicId, context, answer }`; returns `{ score, feedback, misconceptionTag, followUpDrill, source }`, where `source` is `online` for Gemini or `offline` for deterministic fallback. Only `source: online` may grade free text; structured Rule 19 choices remain the offline path.
- `GET /api/openapi.json` — bearer-authenticated API contract.

## Database And Migrations
- Database: PostgreSQL; connection variable `DATABASE_URL`.
- Migration tool to add during this phase: `node-pg-migrate`; migration directory: `services/watchwatcher-api/migrations/`.
- Table mapping: `users` stores account id, name, unique email, password hash, and creation time; `progress_snapshots` stores one account-scoped JSONB mastery/weak-spot/drill snapshot with revision and sync timestamp.
- Create migrations for these contracts. **Create NO seed data.**

## Shared Contracts
- Shared source: `services/shared/types/` and `services/shared/schemas/`.
- API currently compiles these via relative imports. Frontend typed-client alias for integration: `@watchwatcher/shared/types` mapped to `services/shared/types/index.ts`.

## Service Classification
- Azure Static Web Apps: Essential web hosting target; this scaffold does not deploy.
- Azure Functions: Enhancement API; offline study remains available without it.
- PostgreSQL: Enhancement for account-scoped progress sync; local IndexedDB remains authoritative offline.
- Blob Storage/Azurite: Enhancement/Functions host storage; `AzureWebJobsStorage`, `AZURITE_CONNECTION_STRING`, and production `AZURE_STORAGE_ACCOUNT`.
- Gemini evaluation: Enhancement; server-only `GEMINI_API_KEY`, deterministic grading remains available offline.
