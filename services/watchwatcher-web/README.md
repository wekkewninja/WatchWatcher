# WatchwatcherWeb

## Interface locale

Application-owned interface copy is stored in the namespaced English catalog in `src/app/core/locale.service.ts` and rendered with the `t` pipe or `LocaleService.translate`. Missing keys and interpolation values throw rather than rendering blank text. The English locale (`en`) is the default and is persisted under `app-locale`; the toolbar selector currently offers English only. Add future interface translations as catalogs without moving authored COLREGs wording, reference entries, syllabus/course material, or question banks out of their existing content bundles.

## Account deletion

Account settings offers online deletion after explicit confirmation and fresh password or Google authentication. Account data is retained until deletion. A confirmed deletion signs out the deleted account, rejects later sessions for that account, and removes its local progress; if local storage is unavailable, the app reports the failure and retries pending cleanup on startup or by request. A persistent per-account tombstone prevents stale local writes from recreating deleted progress. IndexedDB version 3 fences older version-2 clients after cleanup; an older open tab can block the upgrade, leaving cleanup pending until it closes and cleanup is retried. Other accounts and guest progress are unaffected. Offline devices cannot be remotely erased; clear their local data separately. Durable retry requires browser local storage or a successfully committed IndexedDB tombstone.

Session acceptance checks both the local deletion marker and any readable IndexedDB tombstone. If IndexedDB is unavailable, the in-memory and localStorage markers still apply; after a reload, a missing localStorage marker cannot be replaced by an unreadable IndexedDB tombstone.

Before sending a deletion request, the app stores an account-specific intent without credentials. If the response is lost, the outcome remains unconfirmed and local data is retained. For two minutes the initiating tab can use its in-memory initiating session only to check a deletion receipt; this check cannot delete a live account and does not restore access to other APIs. Sign-out, account transition, expiry, confirmation, or reload removes this capability. After reload, without a valid session, the app cannot confirm whether the server deleted the account; a failed sign-in alone does not prove deletion. A definite pre-deletion 401, 422, 429, or reauthentication failure removes the intent only when there was no earlier ambiguous attempt. Deletion is blocked if the intent cannot be stored.

For an unresolved request, the notice offers an explicit, per-account local-only erase. This does not resolve or cancel any server request. A durable local cleanup marker fences writes before the IndexedDB transaction atomically deletes that account's progress and creates a tombstone. Guest progress and other accounts are not erased. The account's in-memory session and cached identity are cleared; failed remote sign-out retains the existing expiry warning. Blocked IndexedDB or unavailable localStorage is reported, and cleanup can be retried after storage is restored and other tabs are closed. A failure to persist the completion marker remains pending even if the transaction committed. Concurrent intents remain visible until server deletion is confirmed; a rejection after local cleanup begins is conservatively retained.

The local-only fence is deliberately not removed in that browser profile, because delayed work from an old tab could otherwise recreate erased data. If deletion actually failed and the learner wants access again, sign in using a separate browser profile. This is an explicit choice to use server data again; it may reappear there, and an outstanding deletion could still complete. The original profile remains fenced. Clearing all site data in a browser is not account-scoped and can erase guest and other account data, so it is not the recommended recovery action.

Same-profile recovery remains unavailable. Safely reopening the fence requires a database upgrade that blocks older clients, plus a transactional per-account generation carried through every previously started operation and coordinated with concurrent confirmed deletions. The existing writes do not carry that generation, and removing the existing markers or tombstone would allow delayed work to restore erased data. Failed authentication is not evidence that deletion succeeded or failed.

Within the same browser profile, deletion and local-cleanup markers notify other open tabs to clear the matching account's in-memory bearer and identity and remove its active view; ordinary sign-out is scoped to the current tab. Notifications depend on browser storage events and are not a cross-device mechanism. If confirmation cannot be saved and IndexedDB cleanup also fails, the open tab reports that neither verification nor cleanup could be persisted and retains the previously saved intent where possible. If all browser storage is blocked, cleared, or evicted, no durable notice, fence, retry, or notification can be guaranteed after the tab closes; another tab may retain its session or data. Restore storage and retry before closing the tab, and handle other devices separately.

Open tabs running older app code may not handle every notification or remove an already displayed view. Reload or close those tabs after updating; a blocked database upgrade requires closing the older connections before retrying cleanup.

### Other devices

Currently, confirmed deletion cascades server-side to progress and sessions, but another device can retain its own local progress and cached identity. An expired or revoked session, a failed sign-in, and a network error do not prove deletion. Each device requires separate local handling, and offline devices cannot be remotely erased.

A future implementation can register a per-device public key while a session is valid, then atomically create short-lived, account-bound deletion receipts for registered devices when deletion commits. On reconnect, a device can use its non-extractable private key to sign a fresh challenge over HTTPS, receive only its own verified deletion result, fence its account's writes, and offer explicit account-specific cleanup with retry status. Device registrations must be revocable, protected from enumeration and replay, retained only for a documented period, and tested for account switches, expired receipts, storage failure, and offline clients. Browser key storage is not a defense against active same-origin compromise. Do not infer deletion from 401 responses or broadcast account identifiers. The existing receipt is tied only to the requesting session and expires with it; it does not establish an outcome for other devices. A lost, expired, or inaccessible key or receipt leaves the outcome unknown, and no protocol can erase an offline device.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.3.0.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
