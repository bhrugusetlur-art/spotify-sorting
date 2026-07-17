# Spotify Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a deployable Next.js foundation where a Spotify user can authenticate securely, persist the linked account in PostgreSQL, and reach an authenticated dashboard that is ready for the sorting pipeline.

**Architecture:** Use one Next.js App Router application for pages and Route Handlers. Keep environment parsing, cryptography, Spotify OAuth, persistence, and session handling in focused server-only modules with injectable boundaries. PostgreSQL and Drizzle persist encrypted Spotify credentials and the complete future-facing schema, while Vitest and Playwright verify behavior.

**Tech Stack:** Node.js 24, pnpm 10, Next.js App Router, React, TypeScript, Tailwind CSS, PostgreSQL, Drizzle ORM, Zod, Vitest, Testing Library, Playwright, GitHub Actions

## Global Constraints

- Use TypeScript strict mode and the `@/*` alias for `src/*`.
- Use `pnpm`; commit `pnpm-lock.yaml`.
- Keep Spotify access and refresh tokens server-side and encrypted at rest.
- Store OAuth state and PKCE verifier in an encrypted, HTTP-only, same-site cookie.
- Use `http://127.0.0.1:3000/api/auth/spotify/callback` for local Spotify redirects; do not use `localhost`.
- Request only `user-library-read`, `playlist-read-private`, `playlist-modify-private`, and `playlist-modify-public`.
- Do not depend on Spotify Audio Features.
- Do not add Python, Redis, a background queue, machine-learning clustering, or a component library.
- Start every behavior-bearing change with a failing test and observe the expected failure before implementation.
- This plan delivers the foundation slice only. Saved-track classification and playlist synchronization belong to the next implementation plan.

## File Map

- `package.json` — commands and dependency manifest.
- `src/app/*` — App Router pages, styles, and HTTP routes.
- `src/lib/config/env.ts` — validated server environment access.
- `src/lib/db/schema.ts` — complete PostgreSQL schema shared by current and later slices.
- `src/lib/db/client.ts` — lazy Drizzle/PostgreSQL client creation.
- `src/lib/security/crypto.ts` — AES-GCM sealing for tokens and OAuth cookies.
- `src/lib/auth/pkce.ts` — PKCE and OAuth state generation.
- `src/lib/auth/session.ts` — signed application session tokens and cookie settings.
- `src/lib/auth/repository.ts` — linked-account persistence interface and Drizzle implementation.
- `src/lib/spotify/oauth.ts` — Spotify authorization URL, code exchange, refresh, and profile fetch.
- `src/components/*` — accessible landing and dashboard presentation.
- `tests/e2e/*` — browser smoke tests.
- `.github/workflows/ci.yml` — repeatable verification.

---

### Task 1: Application Scaffold and Health Contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/server-only.ts`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Test: `src/lib/health.test.ts`
- Create: `src/lib/health.ts`
- Test: `src/lib/errors.test.ts`
- Create: `src/lib/errors.ts`
- Create: `src/app/api/health/route.ts`
- Create: `.gitignore`

**Interfaces:**
- Consumes: none.
- Produces: `healthStatus(): { status: "ok" }` and a `GET /api/health` route returning that payload.

- [ ] **Step 1: Create configuration-only scaffold files**

Create `package.json` with these scripts and then install the named packages so pnpm writes exact versions and the lockfile:

```json
{
  "name": "spotify-music-sorting",
  "private": true,
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1",
    "build": "next build",
    "start": "next start --hostname 127.0.0.1",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "check": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  }
}
```

Run:

```bash
corepack enable
pnpm add next react react-dom @next/env drizzle-orm postgres zod server-only
pnpm add -D typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss eslint eslint-config-next drizzle-kit vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @playwright/test
```

Expected: dependencies and `pnpm-lock.yaml` are created without peer-dependency errors.

Create the compiler and framework configuration:

```ts
// next-env.d.ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// This file is generated and maintained by Next.js.
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

```js
// postcss.config.mjs
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

```js
// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "coverage/**", "playwright-report/**", "test-results/**"]),
]);
```

```ts
// vitest.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
  } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
});
```

```ts
// src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

```ts
// src/test/server-only.ts
export {};
```

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mood Sorter",
  description: "Sort Spotify liked songs into stable mood playlists.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```css
/* src/app/globals.css */
@import "tailwindcss";

:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; background: #090b0a; color: #f4f7f5; font-family: Arial, sans-serif; }
button, a { font: inherit; }
```

```gitignore
# .gitignore
.next/
node_modules/
.env
.env.local
coverage/
playwright-report/
test-results/
*.tsbuildinfo
```

- [ ] **Step 2: Write the failing health contract test**

```ts
// src/lib/health.test.ts
import { describe, expect, it } from "vitest";
import { healthStatus } from "./health";

describe("healthStatus", () => {
  it("returns a stable healthy payload", () => {
    expect(healthStatus()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 3: Run the test and verify RED**

Run: `pnpm test src/lib/health.test.ts`

Expected: FAIL because `./health` does not exist.

- [ ] **Step 4: Implement the health function and route**

```ts
// src/lib/health.ts
export function healthStatus(): { status: "ok" } {
  return { status: "ok" };
}
```

```ts
// src/app/api/health/route.ts
import { healthStatus } from "@/lib/health";

export function GET(): Response {
  return Response.json(healthStatus());
}
```

- [ ] **Step 5: Write a failing safe-error vocabulary test**

```ts
// src/lib/errors.test.ts
import { describe, expect, it } from "vitest";
import { AppError, toErrorCode } from "./errors";

describe("safe application errors", () => {
  it("preserves approved public error codes", () => {
    expect(toErrorCode(new AppError("AUTH_REQUIRED"))).toBe("AUTH_REQUIRED");
  });

  it("hides unknown internal failures", () => {
    expect(toErrorCode(new Error("database password leaked"))).toBe("INTERNAL_ERROR");
  });
});
```

- [ ] **Step 6: Run the error test and verify RED**

Run: `pnpm test src/lib/errors.test.ts`

Expected: FAIL because `./errors` does not exist.

- [ ] **Step 7: Implement the safe error vocabulary**

```ts
// src/lib/errors.ts
export const errorCodes = ["AUTH_REQUIRED", "AUTH_STATE_INVALID", "SPOTIFY_PERMISSION_DENIED", "SPOTIFY_RATE_LIMITED", "SPOTIFY_UNAVAILABLE", "PLAYLIST_SYNC_FAILED", "CONFIGURATION_INVALID", "INTERNAL_ERROR"] as const;
export type ErrorCode = (typeof errorCodes)[number];

export class AppError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = "AppError"; }
}

export function toErrorCode(error: unknown): ErrorCode {
  return error instanceof AppError ? error.code : "INTERNAL_ERROR";
}
```

- [ ] **Step 8: Verify GREEN and commit**

Run: `pnpm test src/lib/health.test.ts src/lib/errors.test.ts && pnpm typecheck && pnpm lint`

Expected: three passing tests, zero type errors, zero lint errors.

```bash
git add package.json pnpm-lock.yaml tsconfig.json next-env.d.ts next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts .gitignore src
git commit -m "chore: scaffold next application"
```

---

### Task 2: Validated Configuration and PostgreSQL Schema

**Files:**
- Create: `.env.example`
- Test: `src/lib/config/env.test.ts`
- Create: `src/lib/config/env.ts`
- Create: `drizzle.config.ts`
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/client.ts`
- Create: `drizzle/*_spotify_foundation.sql`

**Interfaces:**
- Consumes: Zod and Drizzle packages from Task 1.
- Produces: `parseEnv(source)`, `getEnv()`, `getDb()`, `moodValues`, and the five approved tables.

- [ ] **Step 1: Write failing environment validation tests**

```ts
// src/lib/config/env.test.ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@db.example.com/app",
  SPOTIFY_CLIENT_ID: "spotify-client",
  SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
  SESSION_SECRET: "s".repeat(32),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("parseEnv", () => {
  it("accepts complete server configuration", () => {
    expect(parseEnv(valid).SPOTIFY_CLIENT_ID).toBe("spotify-client");
  });

  it("rejects localhost redirect URIs", () => {
    expect(() => parseEnv({ ...valid, SPOTIFY_REDIRECT_URI: "http://localhost:3000/callback" })).toThrow();
  });

  it("requires HTTPS outside local development", () => {
    expect(() => parseEnv({ ...valid, SPOTIFY_REDIRECT_URI: "http://example.com/callback" })).toThrow();
  });

  it("rejects encryption keys that are not 32 bytes", () => {
    expect(() => parseEnv({ ...valid, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm test src/lib/config/env.test.ts`

Expected: FAIL because `./env` does not exist.

- [ ] **Step 3: Implement environment parsing**

```ts
// src/lib/config/env.ts
import "server-only";
import { z } from "zod";

const encryptionKey = z.string().refine((value) => {
  try { return Buffer.from(value, "base64").length === 32; } catch { return false; }
}, "TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_REDIRECT_URI: z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://127.0.0.1"), "Use HTTPS, or 127.0.0.1 for local redirects"),
  SESSION_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: encryptionKey,
});

export type ServerEnv = z.infer<typeof schema>;
export function parseEnv(source: Record<string, string | undefined>): ServerEnv { return schema.parse(source); }

let cached: ServerEnv | undefined;
export function getEnv(): ServerEnv { return cached ??= parseEnv(process.env); }
```

Create `.env.example`:

```dotenv
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
SPOTIFY_CLIENT_ID=replace-with-spotify-client-id
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
SESSION_SECRET=replace-with-at-least-32-random-characters
TOKEN_ENCRYPTION_KEY=replace-with-base64-encoded-32-byte-key
```

- [ ] **Step 4: Define the Drizzle schema and client**

```ts
// src/lib/db/schema.ts
import { integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const moodValues = ["chill", "hype", "focus", "sad", "happy"] as const;
export const mood = pgEnum("mood", moodValues);
export const syncStatus = pgEnum("sync_status", ["running", "succeeded", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  displayName: text("display_name"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const spotifyAccounts = pgTable("spotify_accounts", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scopes: text("scopes").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const generatedPlaylists = pgTable("generated_playlists", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mood: mood("mood").notNull(),
  spotifyPlaylistId: text("spotify_playlist_id").notNull(),
  playlistName: text("playlist_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("generated_playlists_user_mood_unique").on(table.userId, table.mood)]);

export const songClassifications = pgTable("song_classifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  spotifyTrackId: text("spotify_track_id").notNull(),
  mood: mood("mood").notNull(),
  classifierVersion: text("classifier_version").notNull(),
  reason: text("reason").notNull(),
  metadataFingerprint: text("metadata_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("song_classifications_user_track_version_unique").on(table.userId, table.spotifyTrackId, table.classifierVersion)]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: syncStatus("status").notNull(),
  totalCount: integer("total_count").default(0).notNull(),
  classifiedCount: integer("classified_count").default(0).notNull(),
  addedCount: integer("added_count").default(0).notNull(),
  skippedCount: integer("skipped_count").default(0).notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
```

```ts
// src/lib/db/client.ts
import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/config/env";
import * as schema from "./schema";

let database: PostgresJsDatabase<typeof schema> | undefined;
export function getDb() {
  if (database) return database;
  const client = postgres(getEnv().DATABASE_URL, { prepare: false });
  return database = drizzle(client, { schema });
}
```

```ts
// drizzle.config.ts
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://user:pass@127.0.0.1:5432/app" },
});
```

- [ ] **Step 5: Generate migration, verify GREEN, and commit**

Run: `pnpm db:generate --name spotify_foundation`

Expected: a SQL migration containing both enums and all five tables.

Run: `pnpm test src/lib/config/env.test.ts && pnpm typecheck && git diff --check`

Expected: four passing tests, zero type errors, clean diff.

```bash
git add .env.example drizzle.config.ts drizzle src/lib/config src/lib/db
git commit -m "feat: add validated database foundation"
```

---

### Task 3: Encryption, PKCE, and Application Sessions

**Files:**
- Test: `src/lib/security/crypto.test.ts`
- Create: `src/lib/security/crypto.ts`
- Test: `src/lib/auth/pkce.test.ts`
- Create: `src/lib/auth/pkce.ts`
- Test: `src/lib/auth/session.test.ts`
- Create: `src/lib/auth/session.ts`

**Interfaces:**
- Consumes: `ServerEnv.TOKEN_ENCRYPTION_KEY` and `ServerEnv.SESSION_SECRET`.
- Produces: `seal`, `unseal`, `createPkce`, `createOAuthState`, `createSessionToken`, `readSessionToken`, `sessionCookieOptions`.

- [ ] **Step 1: Write failing crypto and PKCE tests**

```ts
// src/lib/security/crypto.test.ts
import { describe, expect, it } from "vitest";
import { seal, unseal } from "./crypto";

const key = Buffer.alloc(32, 9).toString("base64");

describe("sealed values", () => {
  it("round-trips JSON without exposing plaintext", () => {
    const token = seal({ accessToken: "secret" }, key);
    expect(token).not.toContain("secret");
    expect(unseal<{ accessToken: string }>(token, key)).toEqual({ accessToken: "secret" });
  });

  it("rejects tampering", () => {
    const token = seal({ value: 1 }, key);
    expect(() => unseal(`${token.slice(0, -1)}x`, key)).toThrow();
  });
});
```

```ts
// src/lib/auth/pkce.test.ts
import { describe, expect, it } from "vitest";
import { createOAuthState, createPkce } from "./pkce";

describe("Spotify OAuth primitives", () => {
  it("creates an S256 PKCE pair", () => {
    const pair = createPkce();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("creates unique state values", () => {
    expect(createOAuthState()).not.toBe(createOAuthState());
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test src/lib/security/crypto.test.ts src/lib/auth/pkce.test.ts`

Expected: FAIL because both implementation modules are missing.

- [ ] **Step 3: Implement encryption and PKCE**

```ts
// src/lib/security/crypto.ts
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function seal(value: unknown, encodedKey: string): string {
  const key = Buffer.from(encodedKey, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function unseal<T>(token: string, encodedKey: string): T {
  const payload = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(encodedKey, "base64"), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
```

```ts
// src/lib/auth/pkce.ts
import "server-only";
import { createHash, randomBytes } from "node:crypto";

export function createOAuthState(): string { return randomBytes(24).toString("base64url"); }

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
```

- [ ] **Step 4: Write a failing signed-session test**

```ts
// src/lib/auth/session.test.ts
import { describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken } from "./session";

describe("application sessions", () => {
  it("round-trips a signed user session", () => {
    const token = createSessionToken({ userId: "user-123", expiresAt: 2_000 }, "x".repeat(32));
    expect(readSessionToken(token, "x".repeat(32), 1_000)).toEqual({ userId: "user-123", expiresAt: 2_000 });
  });

  it("rejects expired sessions", () => {
    const token = createSessionToken({ userId: "user-123", expiresAt: 2_000 }, "x".repeat(32));
    expect(readSessionToken(token, "x".repeat(32), 2_001)).toBeNull();
  });
});
```

- [ ] **Step 5: Run session test and verify RED**

Run: `pnpm test src/lib/auth/session.test.ts`

Expected: FAIL because `./session` does not exist.

- [ ] **Step 6: Implement session signing and verify GREEN**

```ts
// src/lib/auth/session.ts
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "mood_sorter_session";
export type SessionPayload = { userId: string; expiresAt: number };

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function createSessionToken(payload: SessionPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function readSessionToken(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded, secret);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  return payload.expiresAt > now ? payload : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};
```

Run: `pnpm test src/lib/security/crypto.test.ts src/lib/auth/pkce.test.ts src/lib/auth/session.test.ts && pnpm typecheck`

Expected: six passing tests and zero type errors.

```bash
git add src/lib/security src/lib/auth
git commit -m "feat: add secure oauth primitives"
```

---

### Task 4: Spotify OAuth Client and Account Repository

**Files:**
- Test: `src/lib/spotify/oauth.test.ts`
- Create: `src/lib/spotify/oauth.ts`
- Test: `src/lib/auth/repository.test.ts`
- Create: `src/lib/auth/repository.ts`

**Interfaces:**
- Consumes: validated environment, encryption, Drizzle schema.
- Produces: `SpotifyOAuthClient`, `SpotifyTokenResponse`, `SpotifyProfile`, `LinkedAccountRepository`, `createDrizzleAccountRepository`.

- [ ] **Step 1: Write failing Spotify OAuth client tests**

```ts
// src/lib/spotify/oauth.test.ts
import { describe, expect, it, vi } from "vitest";
import { SpotifyOAuthClient } from "./oauth";

describe("SpotifyOAuthClient", () => {
  it("builds an authorization URL with exact scopes and PKCE", () => {
    const client = new SpotifyOAuthClient({ clientId: "client", redirectUri: "http://127.0.0.1/callback", fetch });
    const url = new URL(client.authorizationUrl({ state: "state", challenge: "challenge" }));
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "user-library-read", "playlist-read-private", "playlist-modify-private", "playlist-modify-public",
    ]);
  });

  it("exchanges a code using the verifier", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "user-library-read", token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new SpotifyOAuthClient({ clientId: "client", redirectUri: "http://127.0.0.1/callback", fetch: fetcher });
    await expect(client.exchangeCode("code", "verifier")).resolves.toMatchObject({ accessToken: "access" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("refreshes an expired token with the refresh-token grant", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "new-access", expires_in: 3600, scope: "user-library-read", token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new SpotifyOAuthClient({ clientId: "client", redirectUri: "http://127.0.0.1/callback", fetch: fetcher });
    await expect(client.refreshToken("refresh")).resolves.toMatchObject({ accessToken: "new-access" });
    const body = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
  });

  it("maps Spotify rate limits to a safe application error", async () => {
    const client = new SpotifyOAuthClient({ clientId: "client", redirectUri: "http://127.0.0.1/callback", fetch: vi.fn().mockResolvedValue(new Response(null, { status: 429 })) });
    await expect(client.exchangeCode("code", "verifier")).rejects.toMatchObject({ code: "SPOTIFY_RATE_LIMITED" });
  });
});
```

- [ ] **Step 2: Run the OAuth tests and verify RED**

Run: `pnpm test src/lib/spotify/oauth.test.ts`

Expected: FAIL because `./oauth` does not exist.

- [ ] **Step 3: Implement the OAuth client**

```ts
// src/lib/spotify/oauth.ts
import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";

const scopes = ["user-library-read", "playlist-read-private", "playlist-modify-private", "playlist-modify-public"] as const;
const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number(), scope: z.string().optional().default(""), token_type: z.literal("Bearer") });
const profileSchema = z.object({ id: z.string(), display_name: z.string().nullable(), images: z.array(z.object({ url: z.string().url() })).default([]) });

export type SpotifyTokenResponse = { accessToken: string; refreshToken?: string; expiresIn: number; scope: string };
export type SpotifyProfile = { id: string; displayName: string | null; imageUrl: string | null };

function spotifyFailure(response: Response): AppError {
  return new AppError(response.status === 429 ? "SPOTIFY_RATE_LIMITED" : "SPOTIFY_UNAVAILABLE");
}

export class SpotifyOAuthClient {
  constructor(private readonly config: { clientId: string; redirectUri: string; fetch: typeof fetch }) {}

  authorizationUrl(input: { state: string; challenge: string }): string {
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: this.config.clientId, redirect_uri: this.config.redirectUri, state: input.state, scope: scopes.join(" "), code_challenge_method: "S256", code_challenge: input.challenge }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, verifier: string): Promise<SpotifyTokenResponse> {
    const body = new URLSearchParams({ client_id: this.config.clientId, grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri, code_verifier: verifier });
    const response = await this.config.fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (!response.ok) throw spotifyFailure(response);
    const value = tokenSchema.parse(await response.json());
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresIn: value.expires_in, scope: value.scope };
  }

  async refreshToken(refreshToken: string): Promise<SpotifyTokenResponse> {
    const body = new URLSearchParams({ client_id: this.config.clientId, grant_type: "refresh_token", refresh_token: refreshToken });
    const response = await this.config.fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (!response.ok) throw spotifyFailure(response);
    const value = tokenSchema.parse(await response.json());
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresIn: value.expires_in, scope: value.scope };
  }

  async profile(accessToken: string): Promise<SpotifyProfile> {
    const response = await this.config.fetch("https://api.spotify.com/v1/me", { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw spotifyFailure(response);
    const value = profileSchema.parse(await response.json());
    return { id: value.id, displayName: value.display_name, imageUrl: value.images[0]?.url ?? null };
  }
}
```

- [ ] **Step 4: Write the failing account repository contract test**

```ts
// src/lib/auth/repository.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryAccountRepository } from "./repository";

describe("linked account repository", () => {
  it("upserts and reads a linked Spotify account", async () => {
    const repository = createMemoryAccountRepository();
    const saved = await repository.upsert({ spotifyUserId: "spotify-1", displayName: "Ada", imageUrl: null, encryptedAccessToken: "a", encryptedRefreshToken: "r", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) });
    await expect(repository.findByUserId(saved.userId)).resolves.toEqual(saved);
  });
});
```

- [ ] **Step 5: Run the repository test and verify RED**

Run: `pnpm test src/lib/auth/repository.test.ts`

Expected: FAIL because `createMemoryAccountRepository` is missing.

- [ ] **Step 6: Implement repository interface, memory fake, and Drizzle adapter**

Implement `src/lib/auth/repository.ts` with this public contract and transactions that upsert `users` by `spotifyUserId`, then upsert `spotifyAccounts` by `userId`:

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { spotifyAccounts, users } from "@/lib/db/schema";

export type LinkedAccount = {
  userId: string; spotifyUserId: string; displayName: string | null; imageUrl: string | null;
  encryptedAccessToken: string; encryptedRefreshToken: string; scopes: string; accessTokenExpiresAt: Date;
};
export type LinkedAccountInput = Omit<LinkedAccount, "userId">;
export interface LinkedAccountRepository {
  upsert(input: LinkedAccountInput): Promise<LinkedAccount>;
  findByUserId(userId: string): Promise<LinkedAccount | null>;
}

export function createMemoryAccountRepository(): LinkedAccountRepository {
  const values = new Map<string, LinkedAccount>();
  return {
    async upsert(input) {
      const existing = [...values.values()].find((value) => value.spotifyUserId === input.spotifyUserId);
      const value = { ...input, userId: existing?.userId ?? `user-${values.size + 1}` };
      values.set(value.userId, value); return value;
    },
    async findByUserId(userId) { return values.get(userId) ?? null; },
  };
}

export function createDrizzleAccountRepository(db = getDb()): LinkedAccountRepository {
  return {
    async upsert(input) {
      return db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ spotifyUserId: input.spotifyUserId, displayName: input.displayName, imageUrl: input.imageUrl })
          .onConflictDoUpdate({ target: users.spotifyUserId, set: { displayName: input.displayName, imageUrl: input.imageUrl, updatedAt: new Date() } }).returning();
        await tx.insert(spotifyAccounts).values({ userId: user.id, encryptedAccessToken: input.encryptedAccessToken, encryptedRefreshToken: input.encryptedRefreshToken, scopes: input.scopes, accessTokenExpiresAt: input.accessTokenExpiresAt })
          .onConflictDoUpdate({ target: spotifyAccounts.userId, set: { encryptedAccessToken: input.encryptedAccessToken, encryptedRefreshToken: input.encryptedRefreshToken, scopes: input.scopes, accessTokenExpiresAt: input.accessTokenExpiresAt, updatedAt: new Date() } });
        return { ...input, userId: user.id };
      });
    },
    async findByUserId(userId) {
      const [row] = await db.select().from(users).innerJoin(spotifyAccounts, eq(users.id, spotifyAccounts.userId)).where(eq(users.id, userId)).limit(1);
      if (!row) return null;
      return { userId: row.users.id, spotifyUserId: row.users.spotifyUserId, displayName: row.users.displayName, imageUrl: row.users.imageUrl, encryptedAccessToken: row.spotify_accounts.encryptedAccessToken, encryptedRefreshToken: row.spotify_accounts.encryptedRefreshToken, scopes: row.spotify_accounts.scopes, accessTokenExpiresAt: row.spotify_accounts.accessTokenExpiresAt };
    },
  };
}
```

- [ ] **Step 7: Verify GREEN and commit**

Run: `pnpm test src/lib/spotify/oauth.test.ts src/lib/auth/repository.test.ts && pnpm typecheck`

Expected: five passing tests and zero type errors.

```bash
git add src/lib/spotify src/lib/auth/repository.ts src/lib/auth/repository.test.ts
git commit -m "feat: add spotify account integration"
```

---

### Task 5: OAuth Routes and Authenticated Account Service

**Files:**
- Test: `src/lib/auth/oauth-flow.test.ts`
- Create: `src/lib/auth/oauth-flow.ts`
- Test: `src/lib/auth/token-service.test.ts`
- Create: `src/lib/auth/token-service.ts`
- Create: `src/app/api/auth/spotify/start/route.ts`
- Test: `src/app/api/auth/spotify/start/route.test.ts`
- Create: `src/app/api/auth/spotify/callback/route.ts`
- Test: `src/app/api/auth/spotify/callback/route.test.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Test: `src/app/api/auth/logout/route.test.ts`
- Create: `src/lib/auth/current-user.ts`
- Test: `src/lib/auth/current-user.test.ts`
- Create: `src/app/api/account/route.ts`
- Test: `src/app/api/account/route.test.ts`

**Interfaces:**
- Consumes: OAuth primitives, encrypted cookie payloads, Spotify client, repository, and signed sessions.
- Produces: `completeSpotifyLogin`, `getValidSpotifyAccessToken`, OAuth Route Handlers, `getCurrentAccount`, and `GET /api/account`.

- [ ] **Step 1: Write a failing OAuth completion service test**

```ts
// src/lib/auth/oauth-flow.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryAccountRepository } from "./repository";
import { completeSpotifyLogin } from "./oauth-flow";

describe("completeSpotifyLogin", () => {
  it("encrypts tokens and persists the Spotify profile", async () => {
    const repository = createMemoryAccountRepository();
    const result = await completeSpotifyLogin({
      code: "code", verifier: "verifier", encryptionKey: Buffer.alloc(32, 2).toString("base64"), repository,
      spotify: {
        exchangeCode: async () => ({ accessToken: "access", refreshToken: "refresh", expiresIn: 3600, scope: "user-library-read" }),
        profile: async () => ({ id: "spotify-1", displayName: "Ada", imageUrl: null }),
      }, now: new Date(1_000),
    });
    expect(result.encryptedAccessToken).not.toContain("access");
    await expect(repository.findByUserId(result.userId)).resolves.toMatchObject({ spotifyUserId: "spotify-1" });
  });

  it("rejects exchanges that omit a refresh token", async () => {
    await expect(completeSpotifyLogin({ code: "code", verifier: "verifier", encryptionKey: Buffer.alloc(32, 2).toString("base64"), repository: createMemoryAccountRepository(), spotify: { exchangeCode: async () => ({ accessToken: "access", expiresIn: 3600, scope: "user-library-read" }), profile: async () => ({ id: "spotify-1", displayName: null, imageUrl: null }) } })).rejects.toMatchObject({ code: "SPOTIFY_UNAVAILABLE" });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test src/lib/auth/oauth-flow.test.ts`

Expected: FAIL because `./oauth-flow` does not exist.

- [ ] **Step 3: Implement OAuth completion service**

```ts
// src/lib/auth/oauth-flow.ts
import "server-only";
import { seal } from "@/lib/security/crypto";
import { AppError } from "@/lib/errors";
import type { LinkedAccount, LinkedAccountRepository } from "./repository";
import type { SpotifyProfile, SpotifyTokenResponse } from "@/lib/spotify/oauth";

type SpotifyOAuthPort = { exchangeCode(code: string, verifier: string): Promise<SpotifyTokenResponse>; profile(accessToken: string): Promise<SpotifyProfile> };

export async function completeSpotifyLogin(input: { code: string; verifier: string; encryptionKey: string; repository: LinkedAccountRepository; spotify: SpotifyOAuthPort; now?: Date }): Promise<LinkedAccount> {
  const now = input.now ?? new Date();
  const tokens = await input.spotify.exchangeCode(input.code, input.verifier);
  if (!tokens.refreshToken) throw new AppError("SPOTIFY_UNAVAILABLE");
  const profile = await input.spotify.profile(tokens.accessToken);
  return input.repository.upsert({
    spotifyUserId: profile.id, displayName: profile.displayName, imageUrl: profile.imageUrl,
    encryptedAccessToken: seal(tokens.accessToken, input.encryptionKey),
    encryptedRefreshToken: seal(tokens.refreshToken, input.encryptionKey), scopes: tokens.scope,
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1_000),
  });
}
```

- [ ] **Step 4: Write the failing automatic-refresh test**

```ts
// src/lib/auth/token-service.test.ts
import { describe, expect, it } from "vitest";
import { seal } from "@/lib/security/crypto";
import { createMemoryAccountRepository } from "./repository";
import { getValidSpotifyAccessToken } from "./token-service";

const key = Buffer.alloc(32, 4).toString("base64");

describe("getValidSpotifyAccessToken", () => {
  it("refreshes an expired access token and persists the replacement", async () => {
    const repository = createMemoryAccountRepository();
    const account = await repository.upsert({ spotifyUserId: "spotify-1", displayName: "Ada", imageUrl: null, encryptedAccessToken: seal("old", key), encryptedRefreshToken: seal("refresh", key), scopes: "user-library-read", accessTokenExpiresAt: new Date(1_000) });
    const accessToken = await getValidSpotifyAccessToken({ userId: account.userId, repository, encryptionKey: key, now: new Date(5_000), spotify: { refreshToken: async () => ({ accessToken: "new", expiresIn: 3600, scope: "user-library-read" }) } });
    expect(accessToken).toBe("new");
    await expect(repository.findByUserId(account.userId)).resolves.toMatchObject({ scopes: "user-library-read" });
  });
});
```

- [ ] **Step 5: Run refresh test and verify RED**

Run: `pnpm test src/lib/auth/token-service.test.ts`

Expected: FAIL because `./token-service` does not exist.

- [ ] **Step 6: Implement automatic refresh**

```ts
// src/lib/auth/token-service.ts
import "server-only";
import { seal, unseal } from "@/lib/security/crypto";
import type { LinkedAccountRepository } from "./repository";
import type { SpotifyTokenResponse } from "@/lib/spotify/oauth";

export async function getValidSpotifyAccessToken(input: {
  userId: string;
  repository: LinkedAccountRepository;
  encryptionKey: string;
  spotify: { refreshToken(token: string): Promise<SpotifyTokenResponse> };
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const account = await input.repository.findByUserId(input.userId);
  if (!account) throw new Error("AUTH_REQUIRED");
  if (account.accessTokenExpiresAt.getTime() > now.getTime() + 60_000) return unseal<string>(account.encryptedAccessToken, input.encryptionKey);
  const oldRefreshToken = unseal<string>(account.encryptedRefreshToken, input.encryptionKey);
  const tokens = await input.spotify.refreshToken(oldRefreshToken);
  await input.repository.upsert({
    spotifyUserId: account.spotifyUserId,
    displayName: account.displayName,
    imageUrl: account.imageUrl,
    encryptedAccessToken: seal(tokens.accessToken, input.encryptionKey),
    encryptedRefreshToken: seal(tokens.refreshToken ?? oldRefreshToken, input.encryptionKey),
    scopes: tokens.scope || account.scopes,
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1_000),
  });
  return tokens.accessToken;
}
```

- [ ] **Step 7: Write failing Route Handler tests**

```ts
// src/lib/auth/current-user.test.ts
import { describe, expect, it, vi } from "vitest";
import { createSessionToken } from "./session";
import { resolveCurrentAccount } from "./current-user";

describe("resolveCurrentAccount", () => {
  it("loads the account referenced by a valid session", async () => {
    const secret = "s".repeat(32);
    const token = createSessionToken({ userId: "user-1", expiresAt: 2_000 }, secret);
    const repository = { upsert: vi.fn(), findByUserId: vi.fn().mockResolvedValue({ userId: "user-1" }) };
    await expect(resolveCurrentAccount(token, secret, repository, 1_000)).resolves.toEqual({ userId: "user-1" });
  });
});
```

```ts
// src/app/api/auth/spotify/start/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const startCookies = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => startCookies }));

describe("Spotify authorization start", () => {
  beforeEach(() => {
    startCookies.set.mockReset();
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/app",
      SPOTIFY_CLIENT_ID: "client",
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
      SESSION_SECRET: "s".repeat(32),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64"),
    });
  });

  it("sets an encrypted OAuth cookie and redirects to Spotify", async () => {
    const { GET, OAUTH_COOKIE } = await import("./route");
    const response = await GET();
    expect(new URL(response.headers.get("location")!).hostname).toBe("accounts.spotify.com");
    expect(startCookies.set).toHaveBeenCalledWith(OAUTH_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true, maxAge: 300 }));
  });
});
```

```ts
// src/app/api/auth/spotify/callback/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

describe("Spotify callback", () => {
  beforeEach(() => {
    cookieStore.get.mockReset(); cookieStore.set.mockReset(); cookieStore.delete.mockReset();
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/app",
      SPOTIFY_CLIENT_ID: "client",
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
      SESSION_SECRET: "s".repeat(32),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64"),
    });
  });

  it("redirects invalid callback state without calling Spotify", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const { createCallbackHandler } = await import("./route");
    const handler = createCallbackHandler({ repository: { upsert: vi.fn(), findByUserId: vi.fn() }, spotify: { exchangeCode: vi.fn(), profile: vi.fn() }, now: () => new Date(1_000) });
    const response = await handler(new Request("http://127.0.0.1:3000/api/auth/spotify/callback?code=x&state=y"));
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/?error=AUTH_STATE_INVALID");
  });
});
```

```ts
// src/app/api/auth/logout/route.test.ts
import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/session";

const logoutCookies = { delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => logoutCookies }));

describe("Spotify logout", () => {
  it("deletes the application session and redirects home", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://127.0.0.1:3000/api/auth/logout", { method: "POST" }));
    expect(logoutCookies.delete).toHaveBeenCalledWith(SESSION_COOKIE);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
  });
});
```

```ts
// src/app/api/account/route.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: vi.fn().mockResolvedValue({ userId: "u1", spotifyUserId: "s1", displayName: "Ada", imageUrl: null, encryptedAccessToken: "hidden-access", encryptedRefreshToken: "hidden-refresh" }) }));

describe("GET /api/account", () => {
  it("returns only safe account fields", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    expect(await response.json()).toEqual({ userId: "u1", spotifyUserId: "s1", displayName: "Ada", imageUrl: null });
  });
});
```

Run: `pnpm test src/lib/auth/current-user.test.ts src/app/api/auth/spotify/start/route.test.ts src/app/api/auth/spotify/callback/route.test.ts src/app/api/auth/logout/route.test.ts src/app/api/account/route.test.ts`

Expected: FAIL because the route implementation files are missing.

- [ ] **Step 8: Implement route composition and current-account lookup**

```ts
// src/app/api/auth/spotify/start/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createOAuthState, createPkce } from "@/lib/auth/pkce";
import { getEnv } from "@/lib/config/env";
import { seal } from "@/lib/security/crypto";
import { SpotifyOAuthClient } from "@/lib/spotify/oauth";

export const OAUTH_COOKIE = "spotify_oauth";

export async function GET() {
  const env = getEnv();
  const state = createOAuthState();
  const { verifier, challenge } = createPkce();
  const expiresAt = Date.now() + 5 * 60 * 1_000;
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_COOKIE, seal({ state, verifier, expiresAt }, env.TOKEN_ENCRYPTION_KEY), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300,
  });
  const spotify = new SpotifyOAuthClient({ clientId: env.SPOTIFY_CLIENT_ID, redirectUri: env.SPOTIFY_REDIRECT_URI, fetch });
  return NextResponse.redirect(spotify.authorizationUrl({ state, challenge }));
}
```

```ts
// src/app/api/auth/spotify/callback/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { completeSpotifyLogin } from "@/lib/auth/oauth-flow";
import { createDrizzleAccountRepository, type LinkedAccountRepository } from "@/lib/auth/repository";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { toErrorCode, type ErrorCode } from "@/lib/errors";
import { unseal } from "@/lib/security/crypto";
import { SpotifyOAuthClient } from "@/lib/spotify/oauth";
import { OAUTH_COOKIE } from "../start/route";

type OAuthCookie = { state: string; verifier: string; expiresAt: number };
export type CallbackDependencies = {
  repository: LinkedAccountRepository;
  spotify: Pick<SpotifyOAuthClient, "exchangeCode" | "profile">;
  now: () => Date;
};

function errorRedirect(request: Request, code: ErrorCode = "AUTH_STATE_INVALID"): NextResponse {
  const url = new URL("/", request.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

export function createCallbackHandler(dependencies?: CallbackDependencies) {
  return async function callback(request: Request): Promise<NextResponse> {
    const env = getEnv();
    const url = new URL(request.url);
    if (url.searchParams.get("error") === "access_denied") return errorRedirect(request, "SPOTIFY_PERMISSION_DENIED");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieStore = await cookies();
    const encoded = cookieStore.get(OAUTH_COOKIE)?.value;
    if (!code || !state || !encoded) return errorRedirect(request);
    let oauth: OAuthCookie;
    try { oauth = unseal<OAuthCookie>(encoded, env.TOKEN_ENCRYPTION_KEY); } catch { return errorRedirect(request); }
    const now = dependencies?.now() ?? new Date();
    if (oauth.state !== state || oauth.expiresAt <= now.getTime()) return errorRedirect(request);
    const spotify = dependencies?.spotify ?? new SpotifyOAuthClient({ clientId: env.SPOTIFY_CLIENT_ID, redirectUri: env.SPOTIFY_REDIRECT_URI, fetch });
    const repository = dependencies?.repository ?? createDrizzleAccountRepository();
    let account: Awaited<ReturnType<typeof completeSpotifyLogin>>;
    try { account = await completeSpotifyLogin({ code, verifier: oauth.verifier, encryptionKey: env.TOKEN_ENCRYPTION_KEY, repository, spotify, now }); }
    catch (error) { return errorRedirect(request, toErrorCode(error)); }
    cookieStore.delete(OAUTH_COOKIE);
    cookieStore.set(SESSION_COOKIE, createSessionToken({ userId: account.userId, expiresAt: now.getTime() + 604_800_000 }, env.SESSION_SECRET), sessionCookieOptions);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  };
}

export const GET = createCallbackHandler();
```

```ts
// src/lib/auth/current-user.ts
import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/config/env";
import { createDrizzleAccountRepository, type LinkedAccountRepository } from "./repository";
import { readSessionToken, SESSION_COOKIE } from "./session";

export async function resolveCurrentAccount(token: string | undefined, secret: string, repository: LinkedAccountRepository, now = Date.now()) {
  if (!token) return null;
  const session = readSessionToken(token, secret, now);
  return session ? repository.findByUserId(session.userId) : null;
}

export async function getCurrentAccount() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveCurrentAccount(token, getEnv().SESSION_SECRET, createDrizzleAccountRepository());
}
```

```ts
// src/app/api/auth/logout/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request) {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
```

```ts
// src/app/api/account/route.ts
import { getCurrentAccount } from "@/lib/auth/current-user";

export async function GET(): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) return Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });
  return Response.json({ userId: account.userId, spotifyUserId: account.spotifyUserId, displayName: account.displayName, imageUrl: account.imageUrl });
}
```

- [ ] **Step 9: Verify routes, full unit suite, and commit**

Run:

`pnpm test src/lib/auth src/app/api/auth src/app/api/account && pnpm typecheck && pnpm lint`

Expected: all auth tests pass with no token values in response bodies.

```bash
git add src/lib/auth src/app/api/auth src/app/api/account
git commit -m "feat: complete spotify login flow"
```

---

### Task 6: Landing Page and Authenticated Dashboard

**Files:**
- Test: `src/components/landing-page.test.tsx`
- Create: `src/components/landing-page.tsx`
- Create: `src/app/page.tsx`
- Test: `src/components/dashboard.test.tsx`
- Create: `src/components/dashboard.tsx`
- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/dashboard/loading.tsx`

**Interfaces:**
- Consumes: `getCurrentAccount()` and OAuth/logout routes.
- Produces: public landing page and protected dashboard with the five approved mood labels.

- [ ] **Step 1: Write failing presentation tests**

```tsx
// src/components/landing-page.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./landing-page";

describe("LandingPage", () => {
  it("explains the product and links to Spotify login", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { name: /sort your liked songs by mood/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect spotify/i })).toHaveAttribute("href", "/api/auth/spotify/start");
  });

  it("shows a safe message when Spotify login fails", () => {
    render(<LandingPage errorCode="SPOTIFY_PERMISSION_DENIED" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/permission was not granted/i);
  });
});
```

```tsx
// src/components/dashboard.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dashboard } from "./dashboard";

describe("Dashboard", () => {
  it("shows the linked account and five mood destinations", () => {
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} />);
    expect(screen.getByText(/connected as ada/i)).toBeInTheDocument();
    for (const mood of ["Chill", "Hype", "Focus", "Sad", "Happy"]) expect(screen.getByText(mood)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sort my music/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `pnpm test src/components`

Expected: FAIL because both components are missing.

- [ ] **Step 3: Implement accessible page components**

```tsx
// src/components/landing-page.tsx
const messages: Record<string, string> = {
  AUTH_STATE_INVALID: "The Spotify login expired. Please try again.",
  SPOTIFY_PERMISSION_DENIED: "Spotify permission was not granted. You can try again when ready.",
  SPOTIFY_RATE_LIMITED: "Spotify is receiving too many requests. Please wait and try again.",
  SPOTIFY_UNAVAILABLE: "Spotify is temporarily unavailable. Please try again.",
  INTERNAL_ERROR: "We could not complete the login. Please try again.",
};

export function LandingPage({ errorCode }: { errorCode?: string }) {
  const message = errorCode ? messages[errorCode] ?? messages.INTERNAL_ERROR : null;
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-10 px-6 py-16">
      <p className="font-semibold text-emerald-400">Mood Sorter</p>
      <h1 className="max-w-3xl text-5xl font-bold tracking-tight">Sort your liked songs by mood.</h1>
      <p className="max-w-2xl text-lg text-zinc-300">Connect Spotify once. Mood Sorter will build five stable playlists without duplicating songs on later runs.</p>
      {message ? <p role="alert" className="rounded-xl border border-red-900 bg-red-950 p-4 text-red-100">{message}</p> : null}
      <a className="w-fit rounded-full bg-emerald-400 px-6 py-3 font-bold text-black" href="/api/auth/spotify/start">Connect Spotify</a>
    </main>
  );
}
```

```tsx
// src/components/dashboard.tsx
const moods = ["Chill", "Hype", "Focus", "Sad", "Happy"] as const;
export function Dashboard({ account }: { account: { displayName: string | null; imageUrl: string | null } }) {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-14">
      <div className="flex items-start justify-between gap-6">
        <div><p className="text-emerald-400">Connected as {account.displayName ?? "Spotify user"}</p><h1 className="mt-3 text-4xl font-bold">Your mood playlists</h1></div>
        <form action="/api/auth/logout" method="post"><button className="rounded-full border border-zinc-700 px-4 py-2">Log out</button></form>
      </div>
      <section aria-label="Mood destinations" className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {moods.map((mood) => <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5" key={mood}><h2 className="font-semibold">{mood}</h2><p className="mt-2 text-sm text-zinc-400">Ready for sorting</p></article>)}
      </section>
      <button disabled className="mt-10 rounded-full bg-emerald-400 px-6 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-50">Sort My Music</button>
      <p className="mt-3 text-sm text-zinc-400">The sorting engine is the next implementation slice.</p>
    </main>
  );
}
```

```tsx
// src/app/page.tsx
import { LandingPage } from "@/components/landing-page";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <LandingPage errorCode={error} />;
}
```

```tsx
// src/app/dashboard/page.tsx
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getCurrentAccount } from "@/lib/auth/current-user";

export default async function DashboardPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/");
  return <Dashboard account={{ displayName: account.displayName, imageUrl: account.imageUrl }} />;
}
```

```tsx
// src/app/dashboard/loading.tsx
export default function DashboardLoading() {
  return <main className="mx-auto min-h-screen max-w-5xl px-6 py-14 text-zinc-400">Loading your Spotify account…</main>;
}
```

- [ ] **Step 4: Verify GREEN, build, and commit**

Run: `pnpm test src/components && pnpm typecheck && pnpm lint && pnpm build`

Expected: both component tests pass and the production build includes `/`, `/dashboard`, `/api/health`, auth routes, and `/api/account`.

```bash
git add src/app src/components
git commit -m "feat: add spotify foundation interface"
```

---

### Task 7: Browser Smoke Tests, CI, and Developer Documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/landing.spec.ts`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: completed application routes and scripts.
- Produces: repeatable local and CI verification plus setup documentation.

- [ ] **Step 1: Write the integrated browser smoke test**

```ts
// tests/e2e/landing.spec.ts
import { expect, test } from "@playwright/test";

test("landing page explains the workflow and exposes Spotify login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /sort your liked songs by mood/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /connect spotify/i })).toHaveAttribute("href", "/api/auth/spotify/start");
});

test("health endpoint returns a stable payload", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
```

- [ ] **Step 2: Configure Playwright and run the acceptance contract**

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "html",
  use: { baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:3000/api/health", reuseExistingServer: !process.env.CI },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

Run: `pnpm exec playwright install chromium && pnpm test:e2e`

Expected: both acceptance tests pass. The landing-page behavior already completed a component-level RED/GREEN cycle in Task 6; this browser test verifies the integrated route and rendered page.

- [ ] **Step 3: Add CI workflow**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm test:e2e
      - run: pnpm build
```

- [ ] **Step 4: Write complete setup documentation**

````markdown
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
pnpm test:e2e
pnpm build
```

## Security

Never commit `.env.local`, database credentials, Spotify access or refresh tokens, session secrets, or token-encryption keys. Spotify credentials are handled only by server-side modules and encrypted before database storage.
````

- [ ] **Step 5: Run full verification and commit**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

Expected: every command exits `0`; Vitest reports all unit/component tests passing; Playwright reports two passing Chromium tests; Next.js reports a successful production build.

```bash
git add .github playwright.config.ts tests README.md package.json pnpm-lock.yaml
git commit -m "chore: document and verify spotify foundation"
```

## Plan Completion Checklist

- [ ] Landing page and health route work without database access.
- [ ] Environment validation rejects insecure local redirect configuration and invalid encryption keys.
- [ ] The committed migration contains all five tables and both enums from the design specification.
- [ ] OAuth secrets, access tokens, and refresh tokens stay server-side.
- [ ] Spotify login persists an encrypted linked account and sets a signed application session.
- [ ] Unauthenticated dashboard access redirects to the landing page.
- [ ] Authenticated users see their Spotify identity and five mood destinations.
- [ ] Unit, component, browser, type, lint, migration, and build checks are repeatable locally and in CI.
- [ ] README setup steps use `127.0.0.1` and contain no real credentials.
