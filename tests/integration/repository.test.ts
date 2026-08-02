import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createDrizzleAccountRepository } from "@/lib/auth/repository";

const spotifyUserId = `spotify-${randomUUID()}`;

afterAll(async () => {
  await getDb().delete(users).where(eq(users.spotifyUserId, spotifyUserId));
  await closeDb();
});

describe("Drizzle linked-account repository", () => {
  it("persists a linked account and reads it back through PostgreSQL", async () => {
    const repository = createDrizzleAccountRepository();
    const saved = await repository.upsert({ spotifyUserId, displayName: "Ada", imageUrl: null, encryptedAccessToken: "sealed-access", encryptedRefreshToken: "sealed-refresh", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) });
    await expect(repository.findByUserId(saved.userId)).resolves.toMatchObject({ spotifyUserId, displayName: "Ada", encryptedAccessToken: "sealed-access" });
  });

  it("reuses the same user row when the same Spotify account links again", async () => {
    const repository = createDrizzleAccountRepository();
    const first = await repository.upsert({ spotifyUserId, displayName: "Ada", imageUrl: null, encryptedAccessToken: "a1", encryptedRefreshToken: "r1", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) });
    const second = await repository.upsert({ spotifyUserId, displayName: "Ada Lovelace", imageUrl: null, encryptedAccessToken: "a2", encryptedRefreshToken: "r2", scopes: "user-library-read", accessTokenExpiresAt: new Date(20_000) });
    expect(second.userId).toBe(first.userId);
    await expect(repository.findByUserId(first.userId)).resolves.toMatchObject({ displayName: "Ada Lovelace", encryptedAccessToken: "a2" });
  });

  it("returns null for an unknown user", async () => {
    await expect(createDrizzleAccountRepository().findByUserId(randomUUID())).resolves.toBeNull();
  });
});
