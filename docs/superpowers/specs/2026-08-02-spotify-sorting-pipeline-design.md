# Spotify Sorting Pipeline Design

**Date:** 2026-08-02

**Status:** Draft — approved conversationally, pending written review

## Purpose

Complete the first end-to-end `Sort My Music` workflow. An authenticated user starts one synchronous run, the application retrieves the user's entire saved-track library, assigns every supported unique track to exactly one of five deterministic moods, and idempotently adds missing tracks to five private managed playlists. The result survives a page refresh and accurately reports partial progress when Spotify prevents the run from finishing.

This design extends the implemented foundation. It deliberately keeps external I/O behind typed boundaries and all classification, fingerprinting, playlist discovery, set-difference, and batching logic pure and testable.

## Scope

The implementation includes:

- Current Spotify Web API response parsing and pagination for saved tracks, current-user playlists, and playlist items.
- Bounded retry, token-refresh, timeout, and error-redaction behavior for Spotify requests.
- Stable Spotify account linking using the current profile's immutable account identifier while preserving the public user identifier for ownership checks.
- Track normalization, metadata fingerprints, and the deterministic `metadata-v1` classifier.
- Reuse or safe recovery of exactly one private managed playlist for each mood.
- Idempotent playlist synchronization in Spotify-supported batches.
- Persisted classification, playlist mapping, and sync-run outcomes.
- `POST /api/sync`, `GET /api/sync/latest`, and dashboard pending, success, failure, and retry states.
- Unit, PostgreSQL integration, service, route, component, and browser coverage.

## Spotify API Compatibility

The client targets the Web API contract current on 2026-08-02:

- [Get User's Saved Tracks](https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks) uses a maximum page size of 50.
- [Get Current User's Playlists](https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists) uses a maximum page size of 50.
- [Create Playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist) is `POST /me/playlists`.
- Playlist reads and writes use the current [Get Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items) and [Add Items to Playlist](https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist) endpoints. Add requests contain at most 100 URIs.
- The [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) limits Development Mode playlist-content access to owned or collaborative playlists and renames the old `tracks` playlist surface to `items`.
- The [Current User's Profile](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile) includes immutable `account_id`, which is the account-link key. The profile `id` remains necessary for playlist owner comparisons.
- The [rate-limit guide](https://developer.spotify.com/documentation/web-api/concepts/rate-limits) documents a rolling 30-second window and ordinary `429` responses with `Retry-After`. The [July 2026 quota update](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates) adds a possible `reason: QUOTA_EXCEEDED` response body.

All external payloads are parsed with Zod. Schemas accept documented nullable or omitted fields and reject data required for correctness when it is absent. The application never stores or logs raw Spotify responses.

## Architecture

The workflow is a layered synchronous vertical slice:

1. Route handlers authorize the request and translate typed outcomes to safe HTTP responses.
2. A synchronization orchestrator coordinates repositories and the typed Spotify client.
3. Pure domain functions normalize tracks, fingerprint metadata, classify moods, discover managed playlists, compute differences, and create batches.
4. Repositories persist classifications, generated-playlist mappings, and sync runs.
5. The dashboard starts a run and renders either the current or most recently persisted result.

No PostgreSQL transaction remains open during a Spotify network request. The service performs small atomic database changes around external I/O and is designed so a later job-runner adapter can call the same orchestration boundary.

## Identity Migration

Spotify's `account_id` is the durable account-link key. The existing `spotify_user_id` remains the current public profile ID used to verify that a playlist is owned by the authenticated user.

The `users` table gains nullable, unique `spotify_account_id`. It is nullable only so the migration can preserve existing rows created before `account_id` was available. Each successful login reconciles identity in one database transaction:

1. Look up a user by `spotify_account_id` when the profile supplies it.
2. If absent, look up the legacy row by `spotify_user_id`.
3. If the legacy row exists, set its account ID and refresh its current public user ID and profile fields.
4. Otherwise insert a new user with both identifiers.

The transaction must not create a second user for an already-linked legacy account. A uniqueness conflict caused by concurrent callbacks is resolved by re-reading the account-ID row. The OAuth profile schema requires both identifiers for new logins, while migrated database rows may remain null until their next login.

## Component Boundaries

### Spotify Web API Client

The client exposes typed operations for:

- all saved-track pages;
- all current-user playlist pages;
- all items in an owned destination playlist;
- creating a private playlist; and
- adding an ordered list of track URIs.

Pagination generates the next request from validated `offset`, `limit`, `total`, and returned item count. It does not fetch an arbitrary URL copied from a response. Iteration stops when the page is short, the next offset reaches the validated total, or the response explicitly has no next page. A repeated offset, a page that makes no progress while claiming more data, or an invalid total fails with `SPOTIFY_RESPONSE_INVALID` rather than looping.

The client accepts injected `fetch`, clock, sleeper, and timeout values. This keeps retry timing deterministic in tests.

### Track Normalization

A supported library item is a non-local Spotify track with a non-empty track ID and URI. Episodes, local files, null items, and malformed track records are unsupported and increment the run's failed count.

Normalization produces a canonical record containing:

- track ID and URI;
- track name;
- ordered artist IDs and names;
- album ID and name;
- duration in milliseconds;
- explicit flag; and
- release year when the album release date contains a valid four-digit year.

Text is Unicode NFKD-normalized, lowercased, stripped of combining marks, collapsed to single spaces, and trimmed before keyword matching. The canonical fingerprint input preserves normalized semantic values and stable array order. Duplicate saved-library occurrences count toward `total` but classification and playlist addition operate on the first normalized record for each unique track ID.

### Metadata Fingerprint

The metadata fingerprint is lowercase hexadecimal SHA-256 over a canonical JSON array in this exact order:

1. track ID;
2. normalized track name;
3. ordered artist ID/name pairs;
4. album ID;
5. normalized album name;
6. duration;
7. explicit flag; and
8. release year or `null`.

Canonical JSON uses native JSON primitives and arrays only, which avoids object-key ordering differences. A stored classification is reusable only when both `classifier_version` and `metadata_fingerprint` match.

### `metadata-v1` Classifier

The classifier returns `mood`, `reason`, `classifierVersion`, and `metadataFingerprint`. It uses no unseeded randomness or network input.

Keyword matching uses whole normalized tokens and phrases. Track-name matches score 3, album-name matches score 2, and artist-name matches score 1. Each keyword contributes once per field. Version 1 has these exact keyword groups:

| Mood | Keywords and phrases |
| --- | --- |
| `chill` | `chill`, `calm`, `relax`, `mellow`, `ambient`, `acoustic`, `sunset`, `sleep` |
| `hype` | `hype`, `party`, `anthem`, `workout`, `rage`, `pump`, `dance`, `club` |
| `focus` | `focus`, `study`, `concentration`, `instrumental`, `piano`, `coding`, `work`, `lofi`, `lo-fi` |
| `sad` | `sad`, `heartbreak`, `lonely`, `tears`, `goodbye`, `lost`, `blue`, `broken` |
| `happy` | `happy`, `joy`, `smile`, `sunshine`, `celebration`, `uplifting`, `cheerful`, `good vibes` |

The mood with the highest positive score wins. Score ties use the fixed order `chill`, `hype`, `focus`, `sad`, `happy`. The reason names the winning matched terms and fields without copying unrelated user data.

When no keyword scores, the fallback calculates SHA-256 over the UTF-8 string `metadata-v1:<track-id>:<primary-artist-id-or-empty>`, interprets the first eight hex digits as an unsigned integer, and selects `value mod 5` from `chill`, `hype`, `focus`, `sad`, `happy`. The reason is `Stable metadata fallback.` This makes the assignment reproducible across processes and database resets.

### Repositories

- The classification repository finds reusable results and upserts changed `metadata-v1` outcomes for a user and track.
- The generated-playlist repository reads and replaces the one mapping per user and mood.
- The sync-run repository atomically starts a run, records a terminal result, and reads the latest run with its mapped playlists.

Repositories expose domain records rather than Drizzle query objects.

## Managed Playlist Identity and Recovery

Destination playlists are private and use these exact names:

- `Mood Sorter — Chill`
- `Mood Sorter — Hype`
- `Mood Sorter — Focus`
- `Mood Sorter — Sad`
- `Mood Sorter — Happy`

The description is `Managed by Mood Sorter. Mood: <mood>.`, with the lowercase mood substituted exactly.

For each mood, resolution follows this order:

1. Reuse the stored mapping when the current-user playlist listing contains that playlist ID, its owner ID equals the current profile's public user ID, and `public` is exactly `false`.
2. Otherwise recover a listed playlist only when its exact name, exact description marker, owner ID, and `public === false` all match.
3. If multiple recoverable playlists exist, choose the lexicographically smallest Spotify playlist ID and store that mapping.
4. Otherwise create a private playlist and store its returned ID immediately.

A stored valid mapping is authoritative even if its name or description was edited later, but ownership and privacy are always revalidated. A playlist whose `public` field is `true`, `null`, or absent is not a valid destination; version 1 does not change playlist privacy and instead recovers another exact private match or creates a private replacement. The application never adopts an unrelated same-name playlist, a followed playlist, or a playlist owned by another user. It loads all current-user playlist pages once per run and performs resolution from that snapshot plus newly created playlists.

## Synchronization Flow

1. Atomically acquire a running sync for the user.
2. Fetch every saved-track page.
3. Count every library item in `total`, normalize supported items, and de-duplicate supported records by track ID.
4. Reuse classifications whose version and fingerprint match; calculate and persist all others.
5. Fetch every current-user playlist page once.
6. Resolve one private managed destination per mood.
7. Fetch all items for each destination playlist and build its existing track-URI set.
8. Preserve saved-library encounter order within each mood, compute the URI set difference, and count present URIs as skipped.
9. Split missing URIs into sequential batches of at most 100 and add one batch at a time.
10. Persist a succeeded or failed terminal summary and return it with the five known playlist mappings.

The service does not remove playlist items, reorder existing items, or move tracks previously assigned by an older classifier version.

### Count Semantics

- `total`: every saved-library item encountered, including duplicates and unsupported items.
- `classified`: supported unique tracks assigned to a mood during this run, whether the persisted classification was reused or recomputed.
- `added`: track URIs in Spotify add batches that returned success.
- `skipped`: supported unique destination track URIs already present when the destination was read. Duplicate library occurrences do not inflate this count.
- `failed`: unsupported or malformed library-item occurrences plus every supported unique track that has not been confirmed as added or skipped when any terminal failure stops the run, including tracks assigned to later moods that were never attempted.

For every terminal run, `added + skipped + (failed - unsupported occurrences) = classified`. This invariant spans all five moods: if mood 1 fails, all still-unconfirmed tracks in moods 1 through 5 count as failed. `total` is occurrence-based while the other successful outcome counts operate on supported unique tracks, so the five displayed counts do not form a single arithmetic partition when the saved library contains duplicate occurrences. No count claims rolled-back work.

### Concurrency and Stale Runs

A partial unique PostgreSQL index on `sync_runs(user_id) WHERE status = 'running'` permits only one active run per user. Each running row has a cryptographically random lease token known only to its orchestrator. Acquisition happens in a transaction using an injected clock and a row lock on the existing running row:

- a running row younger than 15 minutes returns `SYNC_ALREADY_RUNNING` and HTTP 409;
- a running row at least 15 minutes old is marked failed with code `SYNC_INTERRUPTED`, message `The previous sorting run did not finish.`, and the injected completion time; then a new running row is inserted; and
- concurrent insert conflicts are translated to `SYNC_ALREADY_RUNNING`.

The repository exposes `assertActiveLease(runId, leaseToken)`. The orchestrator calls it immediately before every Spotify-mutating request, including playlist creation and each add batch, and terminal updates use `WHERE id = runId AND lease_token = leaseToken AND status = 'running'`. A stale replacement first marks the old row failed, so an old request that resumes afterward fails its next lease assertion and cannot overwrite the replacement's result. Tests pause an old orchestrator, replace its stale lease, resume it, and prove that it performs no subsequent Spotify mutation or terminal update.

This is cooperative fencing because Spotify does not accept an application fencing token. A mutation already in flight when the 15-minute boundary is crossed may complete, but no later mutation can begin from the replaced run. Rerun discovery and URI difference repair that bounded race. Version 1 assumes the synchronous request normally completes within 15 minutes and does not add heartbeat infrastructure.

## Spotify Request Failure Policy

Every Spotify request has an injected finite timeout. Each logical request has two explicit budgets: one authentication replay and two resilience retries. It therefore makes at most four transport attempts: the initial attempt, at most two shared resilience retries, and at most one additional replay caused by a first `401`. A retryable mixed sequence consumes the applicable shared budget rather than resetting it when the status category changes.

- A first `401` forces one access-token refresh and replays the request. A second `401` clears the application session and fails with `AUTH_REQUIRED`.
- An ordinary `429` with a valid nonnegative integer `Retry-After` waits no more than 10 seconds and consumes one of the two resilience retries. `reason: QUOTA_EXCEEDED`, missing or invalid retry guidance, or an exhausted resilience budget fails with `SPOTIFY_RATE_LIMITED` without another wait.
- Network errors and `500`, `502`, or `503` responses consume the same two resilience retries. The first consumed resilience retry waits 250 ms and the second waits 1,000 ms, regardless of whether an intervening retryable response used a different category.
- `403` is `SPOTIFY_PERMISSION_DENIED`.
- A schema failure or pagination invariant failure is `SPOTIFY_RESPONSE_INVALID`.
- Other non-success responses are nonretryable `SPOTIFY_UNAVAILABLE` unless a more specific safe code applies.

There is no random jitter in version 1. A `401` does not replenish the resilience budget, and a resilience retry does not replenish the authentication replay. For example, `401 → 429 → 500 → 200` uses the absolute maximum of four attempts; another retryable response in place of the final `200` is terminal.

Partial Spotify writes are not rolled back. Successful add batches remain counted and persisted. A rerun rediscovers any created playlist, reads its actual items, and only attempts the remaining difference.

Failure messages and logs never include access or refresh tokens, authorization headers, cookies, raw response bodies, track names, playlist contents, or arbitrary Spotify error text.

## Data Model Changes

The next migration makes these changes:

- Add nullable unique `users.spotify_account_id`.
- Add a nullable UUID `sync_runs.lease_token`, populated for running rows and retained on terminal rows for auditability.
- Add a partial unique index allowing only one running `sync_runs` row per user.
- Add an index on `sync_runs(user_id, started_at DESC)` for latest-result reads.

Existing `generated_playlists`, `song_classifications`, and `sync_runs` columns remain sufficient. No raw track table is added. A replaced playlist mapping updates `spotify_playlist_id`, `playlist_name`, and `updated_at`; prior sync history remains unchanged.

## API Contract

### Shared Result Shape

Successful and partial-failure responses use:

```json
{
  "run": {
    "id": "uuid",
    "status": "succeeded",
    "counts": {
      "total": 100,
      "classified": 96,
      "added": 70,
      "skipped": 26,
      "failed": 4
    },
    "failure": null,
    "startedAt": "2026-08-02T20:00:00.000Z",
    "completedAt": "2026-08-02T20:00:05.000Z"
  },
  "playlists": [
    {
      "mood": "chill",
      "name": "Mood Sorter — Chill",
      "spotifyPlaylistId": "spotify-id",
      "url": "https://open.spotify.com/playlist/spotify-id"
    }
  ]
}
```

Playlist results appear in the fixed mood order. Only stored, user-owned mappings are returned. URLs are constructed from validated playlist IDs.

### `POST /api/sync`

- Requires an authenticated application session.
- Returns HTTP 200 with the shared result when the run succeeds.
- Returns HTTP 409 and `{ "error": { "code": "SYNC_ALREADY_RUNNING", "message": "A sorting run is already in progress." } }` when a fresh run exists.
- Returns HTTP 429 for `SPOTIFY_RATE_LIMITED`.
- Returns HTTP 502 for terminal Spotify or playlist failures. When a run was acquired, the response also includes the persisted failed `run` and known `playlists` fields so the UI can show accurate partial progress.
- Returns HTTP 401 for `AUTH_REQUIRED` and clears the unusable session when appropriate.
- Returns HTTP 500 only for sanitized internal failures.

### `GET /api/sync/latest`

- Requires an authenticated application session.
- Returns HTTP 200 with the shared result for the latest run and currently stored playlist mappings.
- Returns HTTP 200 with `{ "run": null, "playlists": [] }` when no run exists.
- Returns HTTP 401 for `AUTH_REQUIRED`.

All error responses use `{ "error": { "code": "SAFE_CODE", "message": "Safe user-facing message." } }`. The public vocabulary adds `SYNC_ALREADY_RUNNING`, `SPOTIFY_RESPONSE_INVALID`, and `SYNC_INTERRUPTED` to the existing application codes. `SYNC_INTERRUPTED` is primarily a persisted terminal code exposed by the latest-result endpoint.

## Dashboard Behavior

The authenticated dashboard loads the latest result on first render and provides an enabled `Sort My Music` button.

While `POST /api/sync` is pending:

- the button is disabled;
- the label and live status indicate that sorting is in progress; and
- the UI does not claim granular progress that the synchronous API cannot provide.

On success, the dashboard displays all five counts and five `Open in Spotify` links. On failure, it preserves any previously successful playlist links, displays the safe message and persisted partial counts when available, and enables retry. A 409 shows that another run is in progress without starting another request. A 401 directs the user to log in again.

Refreshing the page restores the latest persisted result through `GET /api/sync/latest`. The UI must remain keyboard-accessible, announce pending and terminal states, and keep the existing responsive layout.

## Testing Strategy

Behavior-bearing work follows test-driven development.

### Unit Tests

- all-page iteration, stopping rules, no-progress and cycle guards;
- Zod parsing of current Spotify responses and documented nullability;
- one forced token refresh and bounded replay;
- `Retry-After` boundaries, quota exhaustion, network errors, 5xx backoff, mixed retry categories, and the four-attempt absolute cap;
- track normalization, de-duplication, canonical fingerprints, keyword priority, tie-breaking, and stable fallback;
- exact managed names and descriptions, ownership- and privacy-safe discovery including `public: true` and privacy-unknown candidates, URI set difference, deterministic order, and 100-item batching.

### PostgreSQL Integration Tests

- account-ID-first login and legacy user reconciliation;
- classification reuse and fingerprint-driven recomputation;
- playlist mapping insert and replacement;
- one-running partial unique constraint and conflict translation;
- 15-minute stale-run recovery, lease-token fencing, and conditional terminal updates using an injected clock;
- succeeded and failed counts, safe failures, and latest-result reads.

### Synchronization Service Tests

- multiple saved pages produce five resolved playlists;
- a second identical run creates and adds nothing;
- changed metadata recomputes only affected classifications;
- a stale mapping recovers an exact owned managed playlist without taking over an unrelated one;
- a mood-1 or later-batch failure records completed work and counts every unconfirmed track across later moods as failed;
- a fresh concurrent run conflicts, a stale run is replaced, and the resumed old orchestrator performs no later mutation or terminal update.

### Route, Component, and Browser Tests

- route authorization and safe status mapping;
- dashboard initial, pending, success, persisted-result, partial-failure, and retry states;
- Playwright covers authenticated initiation, generic pending UI, success summary, failure and retry, and refresh with the persisted latest result.

Browser tests may mock `/api/sync`; service tests own backend orchestration coverage. Tests never require live Spotify credentials or perform live Spotify writes. CI continues to run migrations, lint, type-check, unit and service tests, PostgreSQL integration tests, Chromium Playwright, and the production build.

## Non-Goals

- Spotify Audio Features, machine learning, model training, or an external classifier service.
- A job queue, worker process, websocket, server-sent events, or granular progress reporting.
- Removing, moving, or reordering playlist items.
- Taking over unrelated same-name playlists.
- Public managed playlists.
- Unbounded parallel Spotify calls, unbounded retries, or random retry jitter.
- Live Spotify credentials or writes in automated tests.

## Success Criteria

- One authenticated request processes every saved-track page and creates or recovers five stable private managed playlist mappings.
- Every supported unique track receives exactly one reproducible mood and a persisted versioned fingerprint.
- The first complete run adds all missing URIs in deterministic batches of at most 100.
- A second identical run creates no playlists and adds no items.
- A partial write failure preserves accurate counts and a rerun adds only the remaining difference.
- Concurrent runs cannot both acquire the same user, and stale runs recover deterministically after 15 minutes.
- The dashboard renders persisted counts and playlist links after refresh without exposing sensitive data.
- Migrations, lint, type-check, unit tests, PostgreSQL integration tests, Chromium Playwright, and production build pass.
