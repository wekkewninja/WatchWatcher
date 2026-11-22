# Project Plan

**Status**: Integrating
**Created**: 2026-11-21
**Mode**: NEW

---

## 1. Project Overview

**Goal**: Build WatchWatcher, an offline-first RYA/ASA Yachtmaster study and visual-training Angular app for responsive use on Android, Linux desktop, and web browsers. Keep syllabus study, COLREGs lookup, visual simulations, deterministic exam fallback, and local progress available offline; add the confirmed sign-in and PostgreSQL selections as online-only account and progress-sync enhancements. This plan delivers an installable web app, not native Android or Linux packages.

**App Type**: SPA + API

**API Login**: Yes

**Mode**: NEW

**Deployment Plan**: No deployment plan found

---

## 2. WatchWatcher API — Backend

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Runtime** | Node |
| **Framework** | Azure Functions |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test |
| **Orchestration** | docker-compose |

The API supports account-scoped progress sync and optional online Gemini grading. Local progress and deterministic grading remain authoritative for offline use; PostgreSQL and online evaluation are enhancements. Keep the Gemini credential in API configuration rather than shipping it in the Angular client.

---

## 3. Frontend — Web App

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Framework** | Angular |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test --workspace services/watchwatcher-web |

The Angular PWA runs in browsers on Android, Linux desktop, and the web, with a service worker caching the app shell and bundled study content for offline use. Store mastery, weak spots, and drills locally in IndexedDB behind `StorageRepository`; the API is optional for online account features and progress sync.

---

## 4. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| Azure Static Web Apps | Host the Angular PWA for web and browser-based use on Android and Linux desktop; this plan does not produce native packages | — | `npm start` | Essential for the web target |
| Azure Functions | Optional API for sign-in, progress sync, and online Gemini evaluation | `DATABASE_URL`, `GEMINI_API_KEY` | Local Functions host | Enhancement; core learning remains offline |
| PostgreSQL | Account-scoped cloud progress sync; local IndexedDB remains available offline | `DATABASE_URL` | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/watchwatcher` | Enhancement |
| Blob Storage | Azure Functions host storage (`AzureWebJobsStorage`) | `AzureWebJobsStorage` | `UseDevelopmentStorage=true` | Enhancement; required only when the optional API runs |

---

## 5. Prerequisites

Verify every `❓` tool before running or debugging. Docker is the selected emulator runtime; its CLI is present, but the engine was not reachable during this recheck.

Run prerequisites rechecked on 2026-11-22. Node.js, npm, Azure Functions Core Tools, Docker CLI, Docker Compose, and Chrome were detected. The Docker engine was not reachable; the Azure Functions VS Code extension was not found in the checked extension folders.

### Run

| Tool | Service(s) | Installed | Version |
|------|------------|-----------|---------|
| Node.js | WatchWatcher Web, WatchWatcher API | ✅ | v26.13.1 |
| npm | WatchWatcher Web, WatchWatcher API | ✅ | 11.20.0 |
| Azure Functions Core Tools | WatchWatcher API | ✅ | 4.17.0 |

### Debug

| Tool | Service(s) | Installed | Version |
|------|------------|-----------|---------|
| Docker | WatchWatcher API, PostgreSQL, Blob Storage emulators | ❓ | CLI 29.1.4-rd; engine not reachable |
| Docker Compose | WatchWatcher API, PostgreSQL, Blob Storage emulators | ✅ | v5.0.1 |
| Chrome | WatchWatcher Web | ✅ | 157.0.8103.80 |
| `ms-azuretools.vscode-azurefunctions` | WatchWatcher API | ❓ | Not found in checked VS Code extension folders |

---

## 6. Design System & UI

**Component Library**: Angular Material
**Style Direction**: A chart-table study instrument: compact, highly legible surfaces, precise vector diagrams, and clear safety-state emphasis. Pair deep teal navigation with a vermilion action accent and cool chart-paper surfaces; use restrained 4–8px corners and distinct hierarchy for thresholds and warnings.
**Typography**: Atkinson Hyperlegible for study text; system sans-serif fallbacks for the static preview and platform controls.

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#146C67` | Study navigation, selected syllabus items, and primary learning actions |
| `accent` | `#D85B45` | Safety warnings, active exam actions, and important visual markers |
| `surface` | `#F3F7F4` | Chart-paper page background |
| `text` | `#172B2A` | Syllabus, examiner feedback, and reference text |
| `muted` | `#58706D` | Bearings, timestamps, mastery context, and supporting labels |
| `border` | `#CBD8D3` | Chart grid dividers, input outlines, and table rules |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Study Desk | `/` | Resume the next study topic and review mastery, weak spots, and offline readiness | `header + nav + hero + main + card-list + footer` |
| Examiner Workspace | `/examiner` | Answer threshold-gated scenarios and inspect exact-scale navigation and Rule 19 visual aids | `header + nav + main + two-column(table+card-list) + actions` |
| Syllabus Map | `/syllabus` | Scan all six modules, mastery, pass thresholds, and locked topics | `header + nav + table + tabs` |
| COLREGs Reference | `/colregs` | Search the bundled 72-entry COLREGs reference offline | `header + nav + form + list` |

### Sample Content

Study Desk — module/topic:
| Module / topic | Mastery | Pass threshold | State |
|---|---:|---:|---|
| COLREGs — Rule 19 restricted visibility | 72% | 85% | Remediation due |
| Chartwork — course to steer | 86% | 80% | Ready to advance |
| Heavy Weather — leeward MOB recovery | 68% | 85% | Retry required |

Examiner Workspace — scenario:
| Scenario | Student result | Safety threshold | State |
|---|---|---:|---|
| CTS: 5.0 kn east, 1.0 kn tide set south | COG 101.3°T, SOG 5.10 kn | 80% | Vector check ready |
| Rule 19: target on port bow at 315° relative | Starboard alteration selected | 85% | Verification due |
| DSC Mayday sequence | 78% rubric score | 85% | Progression locked |

Syllabus Map — module:
| Module | Topics complete | Mastery | Pass threshold |
|---|---:|---:|---:|
| COLREGs / IRPCS | 8 / 12 | 72% | 85% |
| Chartwork & Terrestrial Navigation | 9 / 11 | 86% | 80% |
| Tidal Heights & Tidal Streams | 5 / 9 | 64% | 80% |
| Marine Meteorology | 6 / 8 | 79% | 80% |
| Passage Planning & Pilotage | 4 / 8 | 58% | 80% |
| Heavy Weather, Boat Handling & Emergencies | 3 / 10 | 68% | 85% |

COLREGs Reference — rule:
| Rule | Topic | Lookup terms | Availability |
|---|---|---|---|
| Rule 5 | Look-out | sight, hearing, appraisal | Offline |
| Rule 6 | Safe speed | visibility, traffic, maneuverability | Offline |
| Rule 19 | Restricted visibility | radar, fog, avoiding action | Offline |
| Rule 34 | Maneuvering and warning signals | whistle, alteration, doubt | Offline |

For preview coverage, the Study Desk shows populated modules and a loading skeleton; the Syllabus Map includes an empty weak-spot tab; the COLREGs Reference includes an inline search error with retry. The Examiner Workspace shows populated scenario data.

---

## 7. Project Structure

```text
WatchWatcher/
├── .github/workflows/ci.yml
├── .gitignore
├── README.md
├── package.json
├── angular.json
├── tsconfig.json
├── services/watchwatcher-api/
│   ├── host.json
│   ├── package.json
│   ├── src/functions/
│   ├── src/services/
│   └── tests/
└── services/watchwatcher-web/
    ├── package.json
    ├── vitest.config.ts
    ├── public/
    │   ├── assets/
    │   │   ├── syllabus/curriculum_seed.json
    │   │   └── reference/colregs_72.json
    │   └── manifest.webmanifest
    └── src/
        ├── main.ts
        ├── service-worker.ts
        └── app/
            ├── core/services/
            │   ├── storage-repository.service.ts
            │   ├── student-memory.service.ts
            │   ├── syllabus-repository.service.ts
            │   ├── examiner-ai.service.ts
            │   ├── navigation-math.service.spec.ts
            │   ├── offline-examiner.service.spec.ts
            │   └── storage-repository.service.spec.ts
            ├── features/
            │   ├── study-desk/
            │   ├── examiner-workspace/
            │   ├── syllabus-map/
            │   └── colregs-reference/
            └── shared/
                ├── chart-vector-canvas/
                └── colregs-animated-view/
```

---

## 8. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Status Codes |
|---|--------|------|-------------|-------------|--------------|-------------|
| 1 | GET | `/api/health` | Health check for the optional API | — | `{ status, services }` | 200, 503 |
| 2 | POST | `/api/auth/session` | Start an authenticated session for account features | `{ credentials }` | `{ accountId, session }` | 200, 401, 422 |
| 3 | GET | `/api/progress` | Read the signed-in account's cloud progress snapshot | — | `{ topicMastery, weakSpotLog, drillQueue }` | 200, 401, 500 |
| 4 | PUT | `/api/progress` | Synchronize local progress when online | `{ topicMastery, weakSpotLog, drillQueue }` | `{ syncedAt, revision }` | 200, 401, 409, 422 |
| 5 | POST | `/api/exam/evaluate` | Optional online structured evaluation; client uses deterministic rubric offline | `{ topicId, context, answer }` | `{ score, feedback, misconceptionTag, followUpDrill }` | 200, 401, 422, 503 |

---

## 9. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create the migrations
3. Run **azure-debug-plan** → **azure-debug-generate** for Docker emulators and VS Code debugging
4. Run the **azure-deploy** agent when ready; it uses **azure-app-onboard** for architecture, cost estimation, IaC generation, provisioning, and health verification
