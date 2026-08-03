import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createDrizzleAccountRepository } from "@/lib/auth/repository";

const identity = randomUUID();
const spotifyAccountIds = [
  `account-${identity}-base`,
  `account-${identity}-legacy`,
  `account-${identity}-relink`,
  `account-${identity}-conflict`,
  `account-${identity}-concurrent`,
];

afterAll(async () => {
  await getDb().delete(users).where(inArray(users.spotifyAccountId, spotifyAccountIds));
  await closeDb();
});

describe("Drizzle linked-account repository", () => {
  it("persists a linked account and reads it back through PostgreSQL", async () => {
    const repository = createDrizzleAccountRepository();
    const saved = await repository.upsert({ spotifyAccountId: spotifyAccountIds[0], spotifyUserId: `spotify-${identity}-base`, displayName: "Ada", imageUrl: null, encryptedAccessToken: "sealed-access", encryptedRefreshToken: "sealed-refresh", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) });
    await expect(repository.findByUserId(saved.userId)).resolves.toMatchObject({ spotifyAccountId: spotifyAccountIds[0], displayName: "Ada", encryptedAccessToken: "sealed-access" });
  });

  it("reuses the same user row when the same Spotify account links again", async () => {
    const repository = createDrizzleAccountRepository();
    const first = await repository.upsert({ spotifyAccountId: spotifyAccountIds[0], spotifyUserId: `spotify-${identity}-base`, displayName: "Ada", imageUrl: null, encryptedAccessToken: "a1", encryptedRefreshToken: "r1", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) });
    const second = await repository.upsert({ spotifyAccountId: spotifyAccountIds[0], spotifyUserId: `spotify-${identity}-base`, displayName: "Ada Lovelace", imageUrl: null, encryptedAccessToken: "a2", encryptedRefreshToken: "r2", scopes: "user-library-read", accessTokenExpiresAt: new Date(20_000) });
    expect(second.userId).toBe(first.userId);
    await expect(repository.findByUserId(first.userId)).resolves.toMatchObject({ displayName: "Ada Lovelace", encryptedAccessToken: "a2" });
  });

  it("returns null for an unknown user", async () => {
    await expect(createDrizzleAccountRepository().findByUserId(randomUUID())).resolves.toBeNull();
  });

  it("updates a legacy public-user row in place when the stable account identity arrives", async () => {
    const repository = createDrizzleAccountRepository();
    const spotifyUserId = `spotify-${identity}-legacy`;
    const legacy = await repository.upsert({ spotifyAccountId: null, spotifyUserId, displayName: "Ada", imageUrl: null, encryptedAccessToken: "a1", encryptedRefreshToken: "r1", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) });
    const reconciled = await repository.upsert({ spotifyAccountId: spotifyAccountIds[1], spotifyUserId, displayName: "Ada", imageUrl: null, encryptedAccessToken: "a2", encryptedRefreshToken: "r2", scopes: "user-library-read", accessTokenExpiresAt: new Date(20_000) });

    expect(reconciled.userId).toBe(legacy.userId);
    await expect(repository.findByUserId(legacy.userId)).resolves.toMatchObject({ spotifyAccountId: spotifyAccountIds[1], encryptedAccessToken: "a2" });
  });

  it("keeps the internal UUID when an account's public user ID changes", async () => {
    const repository = createDrizzleAccountRepository();
    const first = await repository.upsert({ spotifyAccountId: spotifyAccountIds[2], spotifyUserId: `spotify-${identity}-old`, displayName: "Ada", imageUrl: null, encryptedAccessToken: "a1", encryptedRefreshToken: "r1", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) });
    const relinked = await repository.upsert({ spotifyAccountId: spotifyAccountIds[2], spotifyUserId: `spotify-${identity}-new`, displayName: "Ada", imageUrl: null, encryptedAccessToken: "a2", encryptedRefreshToken: "r2", scopes: "user-library-read", accessTokenExpiresAt: new Date(20_000) });

    expect(relinked.userId).toBe(first.userId);
    await expect(repository.findByUserId(first.userId)).resolves.toMatchObject({ spotifyUserId: `spotify-${identity}-new` });
  });

  it("rejects a second user assigned to the same Spotify account ID", async () => {
    const db = getDb();
    await db.insert(users).values({ spotifyAccountId: spotifyAccountIds[3], spotifyUserId: `spotify-${identity}-conflict-1`, displayName: "Ada" });

    await expect(db.insert(users).values({ spotifyAccountId: spotifyAccountIds[3], spotifyUserId: `spotify-${identity}-conflict-2`, displayName: "Grace" })).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("reconciles concurrent callbacks to one account and persists the retrying callback's tokens", async () => {
    const db = getDb();
    const repository = createDrizzleAccountRepository();
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION delay_task1_concurrent_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.display_name = 'Slow callback' THEN
          PERFORM pg_sleep(0.2);
        END IF;
        RETURN NEW;
      END;
      $$;
    `));
    await db.execute(sql.raw("CREATE TRIGGER delay_task1_concurrent_insert BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION delay_task1_concurrent_insert();"));

    try {
      const [slow, fast] = await Promise.all([
        repository.upsert({ spotifyAccountId: spotifyAccountIds[4], spotifyUserId: `spotify-${identity}-concurrent`, displayName: "Slow callback", imageUrl: null, encryptedAccessToken: "slow-access", encryptedRefreshToken: "slow-refresh", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) }),
        repository.upsert({ spotifyAccountId: spotifyAccountIds[4], spotifyUserId: `spotify-${identity}-concurrent`, displayName: "Fast callback", imageUrl: null, encryptedAccessToken: "fast-access", encryptedRefreshToken: "fast-refresh", scopes: "user-library-read", accessTokenExpiresAt: new Date(20_000) }),
      ]);

      expect(slow.userId).toBe(fast.userId);
      await expect(repository.findByUserId(slow.userId)).resolves.toMatchObject({
        encryptedAccessToken: "slow-access",
        encryptedRefreshToken: "slow-refresh",
        displayName: "Slow callback",
      });
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS delay_task1_concurrent_insert ON users;"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS delay_task1_concurrent_insert();"));
    }
  });
});
