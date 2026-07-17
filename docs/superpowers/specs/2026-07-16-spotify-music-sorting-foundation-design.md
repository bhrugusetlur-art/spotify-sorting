# Spotify Music Sorting Foundation Design

**Date:** 2026-07-16

**Status:** Approved for implementation planning

## Purpose

Build a portfolio-ready web application that authenticates a Spotify user, retrieves every saved track in the user's library, deterministically assigns each track to one of five mood categories, and synchronizes the results into five Spotify playlists without recreating playlists or adding duplicate tracks on later runs.

The first implementation slice must be a working vertical path rather than a collection of disconnected configuration files. It includes the application shell, Spotify authentication, database schema and migrations, a dashboard, and the boundaries needed by the later sorting pipeline.

## Product Scope

The application will provide:

- A landing page explaining the product and starting Spotify login.
- Spotify OAuth using Authorization Code with PKCE.
- A server-managed session with automatic Spotify access-token refresh.
- A dashboard that shows connection state and exposes a `Sort My Music` action.
- Paginated retrieval of all saved Spotify tracks.
- A deterministic, replaceable mood-classification module with exactly five outputs: `chill`, `hype`, `focus`, `sad`, and `happy`.
- Discovery or creation of one owned Spotify playlist per mood.
- Idempotent synchronization that adds only tracks absent from the destination playlist.
- A persisted sync-run record and a user-facing summary of added, skipped, and failed tracks.
- Clear, actionable error messages without exposing credentials or Spotify tokens.

## Non-Goals for the First Version

- A separate Python or machine-learning service.
- Unsupervised clustering or model training.
- A background job queue, Redis, or distributed workers.
- Multi-tenant organization features, payments, or public sharing.
- Depending on Spotify Audio Features, because new Development Mode applications may not have access to that endpoint.
- Automatically removing or moving tracks that were previously placed in a different mood playlist.

## Architecture

The application will be a single Next.js App Router project written in TypeScript. React Server Components render server-owned data, while client components are limited to interactive controls and progress presentation. Next.js Route Handlers provide the OAuth callbacks and JSON API surface, keeping the frontend and backend in one deployable application.

PostgreSQL stores user identity, encrypted Spotify access and refresh tokens, stable playlist identifiers, prior classifications, and sync-run outcomes. Drizzle ORM defines the schema and produces committed SQL migrations. Spotify calls are isolated behind a typed client so endpoint changes, rate limiting, and tests do not leak into UI or orchestration code.

The classifier is a pure TypeScript boundary. Its first implementation uses only metadata that the configured Spotify application is allowed to retrieve and deterministic rules. The interface allows a later metadata provider or model-backed classifier without changing the synchronization pipeline.

## Technology Choices

- Next.js App Router and React
- TypeScript with strict compiler settings
- Tailwind CSS for application styling
- PostgreSQL hosted on Neon in deployed environments
- Drizzle ORM and Drizzle Kit for schema management
- Zod for environment and request validation
- Vitest for unit and service-level tests
- Playwright for browser smoke tests
- pnpm for dependency management
- GitHub Actions for lint, type-check, test, and build verification
- Vercel-compatible deployment configuration

No component library is required for the initial infrastructure. Reusable controls will use accessible HTML and focused local components; shadcn/ui can be added later if the interface grows enough to justify it.

## Component Boundaries

### Web Interface

The landing page owns only product explanation and login initiation. The dashboard reads the current application session, displays the linked Spotify account, starts a synchronization run, and presents the most recent result. UI components do not call Spotify directly.

### Authentication Service

The authentication service generates and validates PKCE values and OAuth state, exchanges authorization codes, refreshes expired access tokens, and clears invalid sessions. OAuth state and PKCE verifier values are stored in short-lived, encrypted, HTTP-only, secure cookies. Refresh tokens are encrypted before database persistence. Access tokens are used server-side and are not written to browser storage.

Required Spotify scopes are:

- `user-library-read`
- `playlist-read-private`
- `playlist-modify-private`
- `playlist-modify-public`

### Spotify Client

The Spotify client provides typed operations for:

- Fetching the current Spotify user.
- Iterating through all saved-track pages.
- Iterating through the current user's playlists.
- Creating a playlist for the current user.
- Iterating through items in an owned playlist.
- Adding items to a playlist in Spotify-supported batches.

It must recognize authentication failures, rate limits, malformed responses, and retryable server errors. Rate-limit responses honor Spotify's `Retry-After` value within a bounded retry policy.

### Classification Service

The classifier accepts a normalized track record and returns one of the five mood identifiers plus a human-readable reason and classifier version. The result must depend only on normalized input and classifier version; it cannot use unseeded randomness.

Tracks lacking sufficient metadata use a documented stable fallback based on normalized track and artist identity. This guarantees that every supported track receives one category while making low-confidence classification visible in the persisted reason.

### Synchronization Service

The synchronization service coordinates the use case:

1. Create a running sync record.
2. Fetch all saved tracks through pagination.
3. Load or calculate each track classification.
4. Load the user's stored playlist mappings.
5. Verify mapped playlists still exist and are owned by the current user.
6. Find a matching owned playlist or create one when the mapping is absent or invalid.
7. Fetch existing playlist item URIs.
8. Compute the set difference between desired and existing URIs.
9. Add missing items in supported batches.
10. Persist counts and finish the sync record as succeeded or failed.

Classification and set-difference functions remain pure and independently testable. Network and database operations are injected through small interfaces so service tests can exercise orchestration without real Spotify writes.

## Data Model

### `users`

- Internal UUID primary key
- Spotify user ID, unique and required
- Spotify display name and image URL
- Creation and update timestamps

### `spotify_accounts`

- User foreign key, unique
- Encrypted access token
- Encrypted refresh token
- Granted scopes
- Access-token expiry timestamp
- Creation and update timestamps

### `generated_playlists`

- Internal UUID primary key
- User foreign key
- Mood enum
- Spotify playlist ID
- Playlist name
- Unique constraint on user and mood
- Creation and update timestamps

### `song_classifications`

- Internal UUID primary key
- User foreign key
- Spotify track ID
- Mood enum
- Classifier version
- Human-readable reason
- Normalized metadata fingerprint
- Unique constraint on user, track, and classifier version
- Creation timestamp

### `sync_runs`

- Internal UUID primary key
- User foreign key
- Status enum: `running`, `succeeded`, or `failed`
- Total, classified, added, skipped, and failed item counts
- Sanitized failure code and message
- Started and completed timestamps

## API Surface

- `GET /api/auth/spotify/start` creates the OAuth state and redirects to Spotify.
- `GET /api/auth/spotify/callback` validates the response, stores the linked account, creates the application session, and redirects to the dashboard.
- `POST /api/auth/logout` removes the application session.
- `GET /api/account` returns the current linked-account summary.
- `POST /api/sync` starts the synchronous first-version sorting workflow and returns the completed run summary.
- `GET /api/sync/latest` returns the most recent run visible to the current user.
- `GET /api/health` verifies application process health without revealing configuration values.

The first version uses a synchronous sync request with visible in-progress UI. If real library sizes exceed deployment request-duration limits, the synchronization interface can later be moved behind a job runner without changing classification or playlist-diff behavior.

## Configuration and Security

Environment variables are parsed once at server startup with Zod. The required server variables are:

- `DATABASE_URL`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_REDIRECT_URI`
- `SESSION_SECRET`
- `TOKEN_ENCRYPTION_KEY`

The repository includes `.env.example` with non-secret placeholders. `.env`, `.env.local`, database credentials, access tokens, refresh tokens, and encryption keys are excluded from Git. Logs use stable error codes and redact authorization headers, cookie values, and token payloads.

The deployed redirect URI uses HTTPS. Local development uses `http://127.0.0.1` rather than `localhost`, matching Spotify's redirect requirements.

## Error Handling

Application errors use a small typed error vocabulary:

- `AUTH_REQUIRED`
- `AUTH_STATE_INVALID`
- `SPOTIFY_PERMISSION_DENIED`
- `SPOTIFY_RATE_LIMITED`
- `SPOTIFY_UNAVAILABLE`
- `PLAYLIST_SYNC_FAILED`
- `CONFIGURATION_INVALID`
- `INTERNAL_ERROR`

Route handlers convert internal failures into safe JSON responses or redirects. The dashboard preserves the user's existing successful state and offers a retry action. A partial synchronization is recorded as failed with counts from completed batches; rerunning remains safe because playlist contents are diffed before additions.

## Testing Strategy

Testing follows test-driven development for behavior-bearing code.

Unit tests cover:

- Environment parsing and rejected invalid configuration.
- PKCE generation and OAuth state validation.
- Token-expiry and refresh decisions.
- Track normalization and deterministic classification.
- Playlist naming and mood mapping.
- URI set difference and batch construction.

Service tests cover:

- Pagination across multiple saved-track pages.
- Reusing valid playlist mappings.
- Recovering from stale playlist mappings.
- Creating only missing playlists.
- Adding only missing tracks.
- Recording successful and partial-failure sync outcomes.

Playwright smoke tests cover the landing page, mocked login callback, authenticated dashboard, sync initiation, and result summary. GitHub Actions runs formatting checks, lint, TypeScript checking, Vitest, Playwright smoke tests, and the production build.

## Delivery Sequence

1. Create the Next.js, TypeScript, Tailwind, Vitest, and Playwright scaffold.
2. Add validated environment configuration, Drizzle schema, and the initial migration.
3. Build the landing page, health route, and test harness.
4. Implement Spotify OAuth and the application session.
5. Build the authenticated dashboard.
6. Implement the typed Spotify client and pagination.
7. Implement deterministic classification.
8. Implement playlist mapping and idempotent synchronization.
9. Add result presentation, documentation, CI, and deployment configuration.

Each behavior-bearing step starts with a failing test, implements the minimum code needed to pass, and reruns the full affected suite before proceeding.

## Success Criteria

- A new developer can install dependencies, configure `.env.local`, migrate the database, and run the app using README instructions.
- A Spotify user can authenticate and reach an authenticated dashboard.
- The application retrieves every saved-track page rather than only the first page.
- Every supported saved track receives one deterministic mood category.
- Exactly five mapped playlists are reused across repeated runs.
- A second run adds no duplicate items and does not create replacement playlists.
- Secrets and Spotify tokens never appear in client-side storage, committed files, or application logs.
- Lint, type-check, unit tests, browser smoke tests, and production build pass in CI.
