# Spotify Sorting Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete synchronous `Sort My Music` workflow: current Spotify API ingestion, deterministic five-mood classification, private managed-playlist synchronization, persisted results, and an interactive dashboard.

**Architecture:** A typed Spotify Web API adapter and three narrow repositories sit behind a dependency-injected synchronization service. Track normalization, classification, playlist resolution, URI differences, batching, count accounting, and result serialization remain pure; Next.js route handlers and the client dashboard are thin adapters around those boundaries.

**Tech Stack:** Next.js 16 App Router, React 19, strict TypeScript 6, Zod 4, Drizzle ORM, PostgreSQL 17, Vitest 4, Testing Library, Playwright, pnpm 10.34.5.

## Global Constraints

- Mood order is exactly `chill`, `hype`, `focus`, `sad`, `happy`.
- Classifier version is exactly `metadata-v1`; output is deterministic and never calls Spotify or another model.
- Saved-track and current-playlist pages use limit 50; playlist-item additions use sequential batches of at most 100 URIs.
- Spotify request budgets are one authentication replay plus two shared resilience retries, with four total transport attempts maximum.
- Managed playlists are private, user-owned, and use exact names `Mood Sorter — <Title Mood>` and description `Managed by Mood Sorter. Mood: <mood>.`.
- One `running` sync per user is enforced by PostgreSQL; a run becomes stale at exactly 15 minutes.
- No database transaction remains open across a Spotify request.
- No live Spotify credentials or writes are used by automated tests.
- No background queue, granular progress channel, Audio Features dependency, track removals, or playlist reordering is added.
- Every behavior-bearing change follows RED → GREEN → REFACTOR and ends with focused tests plus a task-level commit.

## File Structure

### Spotify and authentication

- `src/lib/spotify/oauth.ts`: OAuth tokens and current-profile parsing, including `account_id`.
- `src/lib/spotify/web-api-types.ts`: Zod schemas and safe internal Spotify response records.
- `src/lib/spotify/web-api.ts`: bounded request policy, pagination, playlist reads/writes.
- `src/lib/auth/repository.ts`: account-ID-first identity reconciliation and token persistence.
- `src/lib/auth/token-service.ts`: cached/forced refresh access-token provider behavior.

### Pure sorting domain

- `src/lib/sorting/types.ts`: shared mood, normalized-track, classification, playlist, count, and result types.
- `src/lib/sorting/normalize.ts`: library-item normalization, text normalization, release-year extraction, de-duplication, fingerprinting.
- `src/lib/sorting/classifier.ts`: `metadata-v1` keyword scoring and stable fallback.
- `src/lib/sorting/playlists.ts`: exact managed metadata, ownership/privacy-safe resolution, URI set difference, and batching.

### Persistence and orchestration

- `src/lib/sync/classification-repository.ts`: memory and Drizzle classification stores.
- `src/lib/sync/playlist-repository.ts`: memory and Drizzle generated-playlist mappings.
- `src/lib/sync/run-repository.ts`: memory and Drizzle run acquisition, lease fencing, terminal writes, and latest reads.
- `src/lib/sync/service.ts`: end-to-end orchestration and partial-failure accounting.
- `src/lib/sync/result.ts`: stable API serialization and safe public messages.

### Web adapters

- `src/lib/sync/handlers.ts`: dependency-injected POST/latest HTTP handlers.
- `src/app/api/sync/route.ts`: production POST wiring.
- `src/app/api/sync/latest/route.ts`: production latest-result wiring.
- `src/components/dashboard.tsx`: interactive pending/success/failure UI.
- `src/app/dashboard/page.tsx`: authenticated account and latest-result server load.

### Database and tests

- `src/lib/db/schema.ts`: account ID, lease token, and indexes.
- `drizzle/0001_sorting_pipeline.sql`, `drizzle/meta/0001_snapshot.json`, and `drizzle/meta/_journal.json`: generated committed migration artifacts.
- Unit tests beside each module; PostgreSQL tests in `tests/integration/`; browser tests in `tests/e2e/`.

---

### Task 1: Account Identity and Pipeline Schema Migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/spotify/oauth.ts`
- Modify: `src/lib/spotify/oauth.test.ts`
- Modify: `src/lib/auth/repository.ts`
- Modify: `src/lib/auth/repository.test.ts`
- Modify: `src/lib/auth/oauth-flow.ts`
- Modify: `src/lib/auth/oauth-flow.test.ts`
- Modify: `src/lib/auth/token-service.ts`
- Modify: `src/lib/auth/token-service.test.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/lib/errors.test.ts`
- Modify: `tests/integration/repository.test.ts`
- Create: `drizzle/0001_sorting_pipeline.sql` through `pnpm exec drizzle-kit generate --name sorting_pipeline`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0001_snapshot.json`

**Interfaces:**
- Produces: `SpotifyProfile.accountId: string` and `LinkedAccount.spotifyAccountId: string | null`.
- Produces: `LinkedAccountRepository.upsert(input)` that reconciles by account ID before legacy public user ID.
- Produces: `getValidSpotifyAccessToken({ forceRefresh?: boolean })`.
- Produces error codes `SYNC_ALREADY_RUNNING`, `SYNC_INTERRUPTED`, and `SPOTIFY_RESPONSE_INVALID`.
- Produces `users.spotifyAccountId`, `syncRuns.leaseToken`, one-running partial unique index, and latest-run index.

- [x] **Step 1: Write failing OAuth and memory-repository tests**

Add a profile assertion and legacy reconciliation test:

```ts
expect(await client.profile("access")).toEqual({
  accountId: "account-stable",
  id: "public-user",
  displayName: "Ada",
  imageUrl: null,
});

const legacy = await repository.upsert(linkedInput({ spotifyAccountId: null, spotifyUserId: "legacy" }));
const reconciled = await repository.upsert(linkedInput({
  spotifyAccountId: "account-stable",
  spotifyUserId: "legacy",
}));
expect(reconciled.userId).toBe(legacy.userId);
```

- [x] **Step 2: Run unit tests and verify RED**

Run: `pnpm test src/lib/spotify/oauth.test.ts src/lib/auth/repository.test.ts src/lib/auth/oauth-flow.test.ts src/lib/auth/token-service.test.ts src/lib/errors.test.ts`

Expected: FAIL because `account_id`, `spotifyAccountId`, forced refresh, and new error codes are not implemented.

- [x] **Step 3: Add exact schema fields and identity signatures**

Implement these shapes:

```ts
export type SpotifyProfile = {
  accountId: string;
  id: string;
  displayName: string | null;
  imageUrl: string | null;
};

export type LinkedAccount = {
  userId: string;
  spotifyAccountId: string | null;
  spotifyUserId: string;
  displayName: string | null;
  imageUrl: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  scopes: string;
  accessTokenExpiresAt: Date;
};
```

In `users`, add nullable unique `spotifyAccountId`. In `syncRuns`, add nullable UUID `leaseToken`. Add:

```ts
uniqueIndex("sync_runs_one_running_per_user")
  .on(table.userId)
  .where(sql`${table.status} = 'running'`),
index("sync_runs_user_started_at_idx").on(table.userId, table.startedAt),
```

- [x] **Step 4: Implement account-ID-first reconciliation and forced refresh**

The repository transaction must perform this exact search order:

```ts
const accountMatch = input.spotifyAccountId
  ? await findUserBySpotifyAccountId(tx, input.spotifyAccountId)
  : null;
const user = accountMatch ?? await findUserBySpotifyUserId(tx, input.spotifyUserId);
```

Update the matched row's current public ID and profile, then upsert encrypted tokens. On a concurrent unique-account conflict, re-read the account-ID row inside a new transaction and update its token row. Memory behavior must match Drizzle behavior.

Add `forceRefresh?: boolean` to `getValidSpotifyAccessToken`; bypass the 60-second cache window when true while retaining the old refresh token if Spotify omits a replacement.

- [x] **Step 5: Generate and inspect the migration**

Run: `pnpm exec drizzle-kit generate --name sorting_pipeline`

Expected SQL includes `spotify_account_id`, `lease_token`, a unique account-ID index, `sync_runs_one_running_per_user`, and `sync_runs_user_started_at_idx`. It must not drop or rewrite existing tables.

- [x] **Step 6: Add PostgreSQL identity tests and verify GREEN**

Add cases proving a legacy public-ID row is updated in place, an account-ID relink with a changed public ID keeps the internal UUID, and two users cannot share one account ID.

Run:

```bash
pnpm test src/lib/spotify/oauth.test.ts src/lib/auth/repository.test.ts src/lib/auth/oauth-flow.test.ts src/lib/auth/token-service.test.ts src/lib/errors.test.ts
pnpm test:integration
```

Expected: all focused and integration tests PASS.

- [x] **Step 7: Commit Task 1**

```bash
git add src/lib/db/schema.ts src/lib/spotify/oauth.ts src/lib/spotify/oauth.test.ts src/lib/auth src/lib/errors.ts src/lib/errors.test.ts tests/integration/repository.test.ts drizzle
git commit -m "feat: reconcile spotify account identity"
```

### Task 2: Spotify Web API Client and Bounded Request Policy

**Files:**
- Create: `src/lib/spotify/web-api-types.ts`
- Create: `src/lib/spotify/web-api.ts`
- Create: `src/lib/spotify/web-api.test.ts`

**Interfaces:**
- Consumes: access tokens from `SpotifyAccessTokenProvider.get(forceRefresh: boolean): Promise<string>`.
- Produces: `SpotifyWebApi` with `savedTracks()`, `currentUserPlaylists()`, `playlistItems(id)`, `createPlaylist(input)`, and `addPlaylistItems(id, uris)`.
- Produces safe internal records `SpotifySavedItem`, `SpotifyPlaylistSummary`, and `SpotifyPlaylistItem`.

- [x] **Step 1: Write failing request-policy tests**

Cover ordinary success, one `401` forced refresh, second `401`, `QUOTA_EXCEEDED`, valid/invalid `Retry-After`, mixed `401 → 429 → 500 → 200`, timeout, network errors, `500/502/503`, `403`, and malformed JSON. Use injected fake `fetch`, `sleep`, and token provider; assert literal waits `[250, 1000]` or capped retry seconds.

```ts
const api = new SpotifyWebApi({
  fetch: fetcher,
  tokens: { get: tokenGetter },
  sleep: async (ms) => waits.push(ms),
  timeoutMs: 5_000,
  onAuthInvalid: clearSession,
});
```

- [x] **Step 2: Run request-policy tests and verify RED**

Run: `pnpm test src/lib/spotify/web-api.test.ts`

Expected: FAIL because the client modules do not exist.

- [x] **Step 3: Implement schemas and the four-attempt state machine**

Use Zod schemas that accept documented nullable playlist fields but require correctness-critical IDs and URIs. Implement one loop with these counters:

```ts
let authReplayRemaining = 1;
let resilienceRetriesRemaining = 2;
let resilienceRetryNumber = 0;
let attempts = 0;
while (attempts < 4) {
  attempts += 1;
  // 401 consumes auth only; 429/network/5xx consume shared resilience.
}
```

Never log or surface response bodies. Map errors only to approved `AppError` codes.

- [x] **Step 4: Write failing pagination and mutation tests**

Test 50-item saved pages, 50-item playlist pages, playlist-item pages, short final pages, validated totals, repeated/no-progress offsets, private creation via `POST /me/playlists`, and an add body `{ uris }` with at most 100 items.

- [x] **Step 5: Implement validated offset pagination and operations**

Expose async methods returning complete arrays. Generate each next request from the validated page values rather than response `next` URLs. Reject negative totals, repeated offsets, and non-empty no-progress pages with `SPOTIFY_RESPONSE_INVALID`.

- [x] **Step 6: Verify Task 2 GREEN**

Run: `pnpm test src/lib/spotify/web-api.test.ts`

Expected: all request, schema, pagination, and mutation tests PASS.

- [x] **Step 7: Commit Task 2**

```bash
git add src/lib/spotify/web-api-types.ts src/lib/spotify/web-api.ts src/lib/spotify/web-api.test.ts
git commit -m "feat: add bounded spotify web api client"
```

### Task 3: Track Normalization, Fingerprints, and `metadata-v1`

**Files:**
- Create: `src/lib/sorting/types.ts`
- Create: `src/lib/sorting/normalize.ts`
- Create: `src/lib/sorting/normalize.test.ts`
- Create: `src/lib/sorting/classifier.ts`
- Create: `src/lib/sorting/classifier.test.ts`

**Interfaces:**
- Consumes: `SpotifySavedItem` from Task 2.
- Produces: `normalizeLibrary(items): { total; unsupported; tracks }`.
- Produces: `fingerprintTrack(track): string` and `classifyTrack(track): TrackClassification`.

- [x] **Step 1: Write failing normalization and fingerprint tests**

Use literal fixtures for supported tracks, duplicate IDs, null items, local tracks, missing IDs/URIs, episodes, Unicode accents, whitespace, release years, ordered artists, and changed metadata.

```ts
expect(normalizeText("  Café—CALM  ")).toBe("cafe—calm");
expect(normalizeLibrary([supported, supported]).tracks).toHaveLength(1);
expect(fingerprintTrack(track)).toMatch(/^[a-f0-9]{64}$/);
```

- [x] **Step 2: Run normalization tests and verify RED**

Run: `pnpm test src/lib/sorting/normalize.test.ts`

Expected: FAIL because the sorting domain does not exist.

- [x] **Step 3: Implement canonical normalization and SHA-256 fingerprinting**

Define:

```ts
export const MOODS = ["chill", "hype", "focus", "sad", "happy"] as const;
export type Mood = (typeof MOODS)[number];

export type NormalizedTrack = {
  id: string;
  uri: string;
  name: string;
  normalizedName: string;
  artists: Array<{ id: string; name: string; normalizedName: string }>;
  albumId: string | null;
  albumName: string;
  normalizedAlbumName: string;
  durationMs: number;
  explicit: boolean;
  releaseYear: number | null;
};

export type TrackClassification = {
  spotifyTrackId: string;
  mood: Mood;
  classifierVersion: "metadata-v1";
  reason: string;
  metadataFingerprint: string;
};

export type SyncCounts = {
  total: number;
  classified: number;
  added: number;
  skipped: number;
  failed: number;
};

export type SafeFailure = { code: ErrorCode; message: string };
export type GeneratedPlaylist = {
  userId: string;
  mood: Mood;
  spotifyPlaylistId: string;
  playlistName: string;
};
```

Fingerprint the exact canonical array from the spec using `createHash("sha256")` and JSON arrays only.

- [x] **Step 4: Write failing classifier tests**

Test each mood, whole-token/phrase matching, field weights 3/2/1, once-per-field scoring, fixed tie order, accent normalization, `lofi` and `lo-fi`, stable fallback, and a changed primary artist changing the fallback.

- [x] **Step 5: Implement exact keyword scoring and fallback**

Export:

```ts
export const CLASSIFIER_VERSION = "metadata-v1";
export function classifyTrack(track: NormalizedTrack): TrackClassification;
```

Reasons must list only winning terms/fields, or exactly `Stable metadata fallback.`. The fallback hashes `metadata-v1:<track-id>:<primary-artist-id-or-empty>` and uses the first eight hex digits modulo five.

- [x] **Step 6: Verify Task 3 GREEN**

Run: `pnpm test src/lib/sorting/normalize.test.ts src/lib/sorting/classifier.test.ts`

Expected: all normalization, fingerprint, and classifier tests PASS.

- [x] **Step 7: Commit Task 3**

```bash
git add src/lib/sorting
git commit -m "feat: classify normalized tracks by mood"
```

### Task 4: Managed Playlist Domain

**Files:**
- Create: `src/lib/sorting/playlists.ts`
- Create: `src/lib/sorting/playlists.test.ts`

**Interfaces:**
- Consumes: `Mood` and playlist summaries.
- Produces: `managedPlaylistMetadata(mood)`, `resolveManagedPlaylist(input)`, `missingUris(desired, existing)`, and `batchUris(uris)`.

- [x] **Step 1: Write failing playlist-domain tests**

Test exact names/descriptions, stored-mapping authority, owner mismatch, `public: true`, `public: null`, absent privacy, exact recovery marker, unrelated same-name playlists, lexicographic tie selection, stable URI order, existing URI removal, duplicate desired URIs, empty batches, and 100/101 boundaries.

```ts
expect(managedPlaylistMetadata("chill")).toEqual({
  name: "Mood Sorter — Chill",
  description: "Managed by Mood Sorter. Mood: chill.",
  public: false,
});
```

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm test src/lib/sorting/playlists.test.ts`

Expected: FAIL because playlist domain functions do not exist.

- [x] **Step 3: Implement pure playlist functions**

Return a discriminated result from resolution:

```ts
type PlaylistResolution =
  | { kind: "reuse"; playlist: SpotifyPlaylistSummary }
  | { kind: "recover"; playlist: SpotifyPlaylistSummary }
  | { kind: "create"; metadata: ManagedPlaylistMetadata };
```

Only `public === false` is valid. De-duplicate desired URIs before difference calculation and return batches in encounter order.

- [x] **Step 4: Verify Task 4 GREEN**

Run: `pnpm test src/lib/sorting/playlists.test.ts`

Expected: all playlist-domain tests PASS.

- [x] **Step 5: Commit Task 4**

```bash
git add src/lib/sorting/playlists.ts src/lib/sorting/playlists.test.ts
git commit -m "feat: resolve private managed playlists"
```

### Task 5: Classification, Playlist, and Sync-Run Repositories

**Files:**
- Create: `src/lib/sync/classification-repository.ts`
- Create: `src/lib/sync/classification-repository.test.ts`
- Create: `src/lib/sync/playlist-repository.ts`
- Create: `src/lib/sync/playlist-repository.test.ts`
- Create: `src/lib/sync/run-repository.ts`
- Create: `src/lib/sync/run-repository.test.ts`
- Create: `tests/integration/sync-repositories.test.ts`

**Interfaces:**
- Produces: memory and Drizzle implementations of the three repository interfaces.
- Consumes: Task 1 schema and Task 3 domain types.
- Produces: lease acquisition result `{ id, userId, leaseToken, startedAt }`.

- [x] **Step 1: Write failing in-memory repository contract tests**

Define and test these interfaces:

```ts
export interface ClassificationRepository {
  find(userId: string, trackId: string, version: string): Promise<TrackClassification | null>;
  upsert(userId: string, classification: TrackClassification): Promise<void>;
}

export interface GeneratedPlaylistRepository {
  list(userId: string): Promise<GeneratedPlaylist[]>;
  upsert(input: GeneratedPlaylist): Promise<GeneratedPlaylist>;
}

export interface SyncRunRepository {
  acquire(userId: string, now: Date): Promise<ActiveSyncRun>;
  assertActiveLease(runId: string, leaseToken: string): Promise<void>;
  succeed(runId: string, leaseToken: string, counts: SyncCounts, completedAt: Date): Promise<SyncRun>;
  fail(runId: string, leaseToken: string, counts: SyncCounts, failure: SafeFailure, completedAt: Date): Promise<SyncRun>;
  latest(userId: string): Promise<SyncRun | null>;
}
```

Test classification replacement for the same user/track/version, mapping replacement for one user/mood, fresh conflict, exactly-15-minute stale replacement, wrong lease rejection, conditional terminal update, and latest ordering.

- [x] **Step 2: Run memory tests and verify RED**

Run: `pnpm test src/lib/sync/classification-repository.test.ts src/lib/sync/playlist-repository.test.ts src/lib/sync/run-repository.test.ts`

Expected: FAIL because repository modules do not exist.

- [x] **Step 3: Implement memory repositories**

Use injected `randomUUID` for deterministic lease tests. Throw `AppError("SYNC_ALREADY_RUNNING")` for a fresh lease and `AppError("SYNC_INTERRUPTED")` when an old lease attempts to mutate after replacement.

- [x] **Step 4: Write failing PostgreSQL contract tests**

Test fingerprint/version reuse, playlist replacement, unique running-row enforcement under `Promise.allSettled`, stale-row failure fields, lease assertions, conditional terminal writes, and latest-run ordering. Use per-test UUID users and delete them in `afterEach`.

- [x] **Step 5: Implement Drizzle repositories**

Acquire inside a short transaction. Lock the current running row before comparing `startedAt`, mark a stale row failed, then insert the new lease. Translate partial-index conflicts to `SYNC_ALREADY_RUNNING`. Terminal updates must include ID, lease token, and `running` status in the `WHERE` clause and reject zero updated rows.

- [x] **Step 6: Verify Task 5 GREEN**

Run:

```bash
pnpm test src/lib/sync/classification-repository.test.ts src/lib/sync/playlist-repository.test.ts src/lib/sync/run-repository.test.ts
pnpm test:integration
```

Expected: all memory and PostgreSQL repository tests PASS.

- [x] **Step 7: Commit Task 5**

```bash
git add src/lib/sync/*repository* tests/integration/sync-repositories.test.ts
git commit -m "feat: persist sorting state and sync leases"
```

### Task 6: End-to-End Synchronization Service

**Files:**
- Create: `src/lib/sync/service.ts`
- Create: `src/lib/sync/service.test.ts`
- Create: `src/lib/sync/result.ts`
- Create: `src/lib/sync/result.test.ts`

**Interfaces:**
- Consumes: `SpotifyWebApi`, the three repositories, Task 3 classifier, and Task 4 playlist functions.
- Produces: `syncLibrary({ userId, spotifyUserId }): Promise<SyncResult>` and `loadLatestSyncResult(userId): Promise<SyncResult | null>`.

- [x] **Step 1: Write the successful first-run service test**

Use complete in-memory fakes for all Spotify methods. Feed multiple saved pages through the real normalized item shape, assert five private creations in mood order, sequential add calls, persisted mappings, succeeded counts, and five result links.

```ts
export type SpotifyWebApiPort = Pick<SpotifyWebApi,
  "savedTracks" | "currentUserPlaylists" | "playlistItems" | "createPlaylist" | "addPlaylistItems"
>;

export type SyncServiceDependencies = {
  spotify: SpotifyWebApiPort;
  classifications: ClassificationRepository;
  playlists: GeneratedPlaylistRepository;
  runs: SyncRunRepository;
  now: () => Date;
};

export type SyncInput = { userId: string; spotifyUserId: string };
```

- [x] **Step 2: Run first-run test and verify RED**

Run: `pnpm test src/lib/sync/service.test.ts`

Expected: FAIL because `syncLibrary` does not exist.

- [x] **Step 3: Implement the minimum successful orchestration**

Acquire a lease; fetch saved tracks; normalize/de-duplicate; reuse matching classifications; fetch current playlists once; resolve/create five destinations; fetch destination items; difference and batch; assert the lease immediately before each create/add; persist success. Never hold a DB transaction around any Spotify call.

- [x] **Step 4: Add idempotency, changed metadata, and recovery tests**

Test a second identical run creates/adds nothing, changed fingerprint recomputes only that track, stale mapping recovers the exact private owned marker, a public stored mapping is replaced, and unrelated same-name playlists are untouched.

- [x] **Step 5: Add partial-failure and stale-resume tests**

Test a mood-1 batch failure after one successful batch; verify all later-mood tracks become failed and:

```ts
expect(counts.added + counts.skipped + (counts.failed - unsupportedCount))
  .toBe(counts.classified);
```

Pause an old service before its next add, replace the 15-minute lease, resume it, and assert there is no later Spotify mutation or terminal overwrite.

- [x] **Step 6: Implement terminal accounting and safe result serialization**

On any terminal error after acquisition, calculate unconfirmed supported tracks across every mood, add unsupported occurrences, store a safe code/message, and return known mappings. Serialize playlists in fixed mood order and construct URLs only as `https://open.spotify.com/playlist/${validatedId}`.

- [x] **Step 7: Verify Task 6 GREEN**

Run: `pnpm test src/lib/sync/service.test.ts src/lib/sync/result.test.ts`

Expected: all success, idempotency, recovery, partial failure, and lease-fencing tests PASS.

- [x] **Step 8: Commit Task 6**

```bash
git add src/lib/sync/service.ts src/lib/sync/service.test.ts src/lib/sync/result.ts src/lib/sync/result.test.ts
git commit -m "feat: synchronize mood playlists idempotently"
```

### Task 7: Sync API Handlers and Production Wiring

**Files:**
- Create: `src/lib/sync/handlers.ts`
- Create: `src/lib/sync/handlers.test.ts`
- Create: `src/app/api/sync/route.ts`
- Create: `src/app/api/sync/route.test.ts`
- Create: `src/app/api/sync/latest/route.ts`
- Create: `src/app/api/sync/latest/route.test.ts`
- Modify: `src/lib/auth/session.ts` only if a shared cookie-clearing helper is required

**Interfaces:**
- Consumes: current account resolution, Task 1 token service, Task 2 client, Task 5 repositories, Task 6 service.
- Produces: POST and GET route handlers with the approved JSON/status contract.

- [x] **Step 1: Write failing dependency-injected handler tests**

Test unauthenticated 401, successful 200, fresh-run 409, rate-limit 429, terminal Spotify failure 502 with persisted `run` and known `playlists`, unexpected 500, and latest no-run `{ run: null, playlists: [] }`.

```ts
const handlers = createSyncHandlers({
  currentAccount,
  syncLibrary,
  latestResult,
  clearSession,
});
```

- [x] **Step 2: Run handler tests and verify RED**

Run: `pnpm test src/lib/sync/handlers.test.ts`

Expected: FAIL because handlers do not exist.

- [x] **Step 3: Implement safe HTTP translation**

Use exact public messages from the design. Never serialize caught exception messages. On `AUTH_REQUIRED`, invoke the injected session clearer. Include failed run payload only when the service acquired and persisted a run.

- [x] **Step 4: Write failing route wiring tests**

Mock only production dependency factories; prove `POST` and `GET` delegate to the injected handler contract and retain authorization/status mapping.

- [x] **Step 5: Add production route wiring**

Build one `SpotifyWebApi` per request with an access-token provider that calls `getValidSpotifyAccessToken({ forceRefresh })`. Construct Drizzle repositories and pass an injected clock. Export only `POST` or `GET` from each App Router module.

- [x] **Step 6: Verify Task 7 GREEN**

Run: `pnpm test src/lib/sync/handlers.test.ts src/app/api/sync/route.test.ts src/app/api/sync/latest/route.test.ts`

Expected: all handler and route tests PASS.

- [x] **Step 7: Commit Task 7**

```bash
git add src/lib/sync/handlers.ts src/lib/sync/handlers.test.ts src/app/api/sync src/lib/auth/session.ts
git commit -m "feat: expose spotify sorting api"
```

### Task 8: Interactive Dashboard and Persisted Results

**Files:**
- Modify: `src/components/dashboard.tsx`
- Modify: `src/components/dashboard.test.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/loading.tsx` if the copy no longer matches
- Modify: `tests/e2e/authenticated-dashboard.spec.ts`
- Create: `tests/e2e/sync-dashboard.spec.ts`

**Interfaces:**
- Consumes: `SyncResult | null` as `initialResult` and POST `/api/sync`.
- Produces: accessible pending, succeeded, failed, 409, and 401 states.

- [x] **Step 1: Write failing component tests**

Cover initial enabled action, pending disabled state and live status, success counts and five links, safe failure with retry, preserved prior links, 409 message, and 401 login link. Use a controlled deferred `fetch` promise for pending behavior rather than timers.

```tsx
<Dashboard
  account={{ displayName: "Ada", imageUrl: null }}
  initialResult={null}
/>
```

- [x] **Step 2: Run component tests and verify RED**

Run: `pnpm test src/components/dashboard.test.tsx`

Expected: FAIL because the button is disabled and result states do not exist.

- [x] **Step 3: Implement the client dashboard**

Add `"use client"`, submit with `fetch("/api/sync", { method: "POST" })`, and maintain `idle | pending | succeeded | failed` state. Use `aria-live="polite"`, disabled pending button, fixed mood cards, literal count labels, secure external links with `target="_blank" rel="noreferrer"`, and retry without clearing prior playlist links.

- [x] **Step 4: Load the persisted result on the server page**

After authenticating, query `loadLatestSyncResult(account.userId)` through the Drizzle repositories and pass the result to `Dashboard`. Keep the unauthenticated redirect unchanged.

- [x] **Step 5: Write browser tests and verify RED**

Intercept `/api/sync` in Playwright for a deferred pending response, success payload, safe failure then retry success, and persisted initial result after page reload. Do not add a production authentication bypass or Spotify write.

- [x] **Step 6: Complete browser behavior and verify GREEN**

Run:

```bash
pnpm test src/components/dashboard.test.tsx
pnpm test:e2e
```

Expected: component tests and all Chromium tests PASS.

- [x] **Step 7: Commit Task 8**

```bash
git add src/components/dashboard.tsx src/components/dashboard.test.tsx src/app/dashboard tests/e2e
git commit -m "feat: add sort my music dashboard flow"
```

### Task 9: Documentation, Full Verification, and Delivery Gate

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if implementation adds a required environment value; otherwise leave unchanged.
- Modify: `docs/superpowers/plans/2026-08-03-spotify-sorting-pipeline.md` to check completed steps.
- Update ignored: `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.html`, manifest, and cache.

**Interfaces:**
- Consumes every preceding task.
- Produces a developer-verifiable workflow and final evidence package.

- [x] **Step 1: Add README behavior and safety documentation**

Document the exact five playlists, deterministic metadata classifier, repeat-run idempotency, synchronous request expectation, safe partial-failure retry, and the complete local verification commands. Do not promise Audio Features, background jobs, removals, or live-test writes.

- [x] **Step 2: Run migration against a fresh PostgreSQL 17 database**

Create an explicitly named disposable database container, run `pnpm db:migrate`, inspect that both migrations are recorded, and verify the running-row partial index exists.

- [x] **Step 3: Run the complete local suite**

Run with CI-equivalent environment values and pnpm 10.34.5:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
git diff --check
```

Expected: every command exits 0; report exact unit, integration, and browser test counts.

- [x] **Step 4: Refresh and validate Graphify**

Run the incremental Graphify pipeline, validate `graph.json`, regenerate `GRAPH_REPORT.md` and `graph.html`, report graph diff and benchmark, and ensure only ignored graph artifacts changed.

- [x] **Step 5: Run independent high-effort review**

Give the reviewer the approved spec, this plan, complete diff, migration, and test outputs. Require findings ordered by severity and exact file/line references. Resolve every actionable finding with a failing regression test before changing production code.

- [x] **Step 6: Commit documentation and review fixes**

```bash
git add README.md docs/superpowers/plans/2026-08-03-spotify-sorting-pipeline.md
git commit -m "docs: document spotify sorting workflow"
```

- [x] **Step 7: Re-run the full verification after review fixes**

Repeat Step 3 from a clean working tree. Do not rely on earlier task-level test runs.

- [x] **Step 8: Integrate and monitor `main`**

Fast-forward the feature branch into `main`, push `main`, watch the GitHub Actions run through a terminal result, and report any residual warnings separately from failures.
