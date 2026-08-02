# Mood Sorter

Mood Sorter is a Next.js application that connects to Spotify and prepares five stable mood playlists for a user's liked songs. This foundation slice includes secure Spotify login, encrypted account persistence, an authenticated dashboard, tests, and CI. Classification and playlist synchronization are the next implementation slice.

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

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

`pnpm test:integration` and `pnpm test:e2e` require a migrated throwaway database in `DATABASE_URL`; run `pnpm db:migrate` first. The fixtures write test rows and remove only rows they created. Never point either command at real data.

## Security

Never commit `.env.local`, database credentials, Spotify access or refresh tokens, session secrets, or token-encryption keys. Spotify credentials are handled only by server-side modules and encrypted before database storage.
