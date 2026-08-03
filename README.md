# Mood Sorter

Mood Sorter is a Next.js application that connects to Spotify and sorts a user's liked songs into five stable, private mood playlists. It includes secure Spotify login, encrypted account persistence, an authenticated dashboard, deterministic classification, playlist synchronization, tests, and CI.

## Prerequisites

- Node.js 24
- pnpm 10
- PostgreSQL database
- Spotify Developer application

## Local setup

```bash
pnpm install
cp .env.example .env.local
```

Generate local secrets and copy the outputs into `.env.local`:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

In the Spotify Developer Dashboard, register this exact redirect URI:

```text
http://127.0.0.1:3000/api/auth/spotify/callback
```

Apply the database migration and run the application:

```bash
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:3000`.

## Architecture

- `src/app` contains pages and Route Handlers.
- `src/lib/config` validates server environment variables.
- `src/lib/auth` owns PKCE, linked accounts, access-token refresh, and application sessions.
- `src/lib/spotify` owns Spotify OAuth HTTP calls.
- `src/lib/db` owns the Drizzle schema and PostgreSQL client.
- `src/lib/security` encrypts OAuth and token payloads.

## Sorting behavior and safety

Selecting **Sort My Music** makes one synchronous request: the dashboard stays pending until the current sorting run succeeds or returns a safe failure. It is not a background job.

The sorter manages exactly these five private playlists:

- `Mood Sorter — Chill`
- `Mood Sorter — Hype`
- `Mood Sorter — Focus`
- `Mood Sorter — Sad`
- `Mood Sorter — Happy`

For each liked track, the `metadata-v1` classifier deterministically scores normalized track, album, and artist names against mood keywords. A stable hash of the track and primary artist provides the fallback when there is no keyword match. Classifications are saved with a metadata fingerprint and reused unless that metadata changes.

Runs are safe to repeat. The application reuses its stored mapping when it still identifies one of the user's private managed playlists; otherwise it recovers an exact metadata match or creates a replacement. Before adding tracks, it reads the destination and sends only missing Spotify URIs in batches. The flow is additive: existing destination items are skipped, so an interrupted or partially failed run can be retried without duplicating items that were already confirmed. Completed mappings and classifications remain available to the retry, and the dashboard retains known playlist links while showing a safe failure message.

Only a playlist owned by the connected Spotify account and marked private is eligible for reuse or recovery. Keep the managed playlist names and descriptions intact if you want a later run to recover them automatically.

## Verification

Use pnpm 10.34.5 and a newly migrated, disposable PostgreSQL database. Set inert local values for the required server environment variables; do not use Spotify credentials or a database containing real data.

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mood_sorter_test
export SPOTIFY_CLIENT_ID=ci-spotify-client-id
export SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
export SESSION_SECRET=ci-session-secret-not-used-outside-continuous-integration
export TOKEN_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=

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

If Chromium is not already installed for Playwright, run `pnpm exec playwright install chromium` before the sequence. `pnpm test:integration` and `pnpm test:e2e` require the migrated throwaway database in `DATABASE_URL`; their fixtures create and clean up only their own test rows. Never point migration or tests at a real, shared, or persistent database. The browser tests use mocked application/Spotify responses and do not perform live Spotify writes.

## Security

Never commit `.env.local`, database credentials, Spotify access or refresh tokens, session secrets, or token-encryption keys. Spotify credentials are handled only by server-side modules and encrypted before database storage.
