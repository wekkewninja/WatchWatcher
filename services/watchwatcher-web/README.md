# WatchwatcherWeb

## Account deletion

Account settings offers online deletion after explicit confirmation and fresh password or Google authentication. Account data is retained until deletion. A confirmed deletion signs out the deleted account, rejects later sessions for that account, and removes its local progress; if local storage is unavailable, the app reports the failure and retries pending cleanup on startup or by request. A persistent per-account tombstone prevents stale local writes from recreating deleted progress. IndexedDB version 3 fences older version-2 clients after cleanup; an older open tab can block the upgrade, leaving cleanup pending until it closes and cleanup is retried. Other accounts and guest progress are unaffected. Offline devices cannot be remotely erased; clear their local data separately. Durable retry requires browser local storage or a successfully committed IndexedDB tombstone.

Session acceptance checks both the local deletion marker and any readable IndexedDB tombstone. If IndexedDB is unavailable, the in-memory and localStorage markers still apply; after a reload, a missing localStorage marker cannot be replaced by an unreadable IndexedDB tombstone.

Before sending a deletion request, the app stores an account-specific intent without credentials. If the response is lost, the outcome remains unconfirmed and local data is retained. Retry deletion with fresh authentication while signed in to that same account. Sessions are held only in memory, so after reload, without a valid session, the app cannot confirm whether the server deleted the account; a failed sign-in alone does not prove deletion. A definite pre-deletion 401, 422, 429, or reauthentication failure removes the intent only when there was no earlier ambiguous attempt. Deletion is blocked if the intent cannot be stored.

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
