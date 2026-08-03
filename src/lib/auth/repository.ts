import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { spotifyAccounts, users } from "@/lib/db/schema";

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
export type LinkedAccountInput = Omit<LinkedAccount, "userId">;
export interface LinkedAccountRepository {
  upsert(input: LinkedAccountInput): Promise<LinkedAccount>;
  findByUserId(userId: string): Promise<LinkedAccount | null>;
}

export function createMemoryAccountRepository(): LinkedAccountRepository {
  const values = new Map<string, LinkedAccount>();
  return {
    async upsert(input) {
      const accountMatch = input.spotifyAccountId
        ? [...values.values()].find((value) => value.spotifyAccountId === input.spotifyAccountId)
        : undefined;
      const existing = accountMatch ?? [...values.values()].find((value) => value.spotifyUserId === input.spotifyUserId);
      const value = { ...input, userId: existing?.userId ?? `user-${values.size + 1}` };
      values.set(value.userId, value);
      return value;
    },
    async findByUserId(userId) {
      return values.get(userId) ?? null;
    },
  };
}

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function findUserBySpotifyAccountId(tx: DbTransaction, spotifyAccountId: string) {
  const [user] = await tx.select().from(users).where(eq(users.spotifyAccountId, spotifyAccountId)).limit(1);
  return user ?? null;
}

async function findUserBySpotifyUserId(tx: DbTransaction, spotifyUserId: string) {
  const [user] = await tx.select().from(users).where(eq(users.spotifyUserId, spotifyUserId)).limit(1);
  return user ?? null;
}

async function upsertTokens(tx: DbTransaction, userId: string, input: LinkedAccountInput) {
  await tx.insert(spotifyAccounts).values({
    userId,
    encryptedAccessToken: input.encryptedAccessToken,
    encryptedRefreshToken: input.encryptedRefreshToken,
    scopes: input.scopes,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
  }).onConflictDoUpdate({
    target: spotifyAccounts.userId,
    set: {
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      scopes: input.scopes,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      updatedAt: new Date(),
    },
  });
}

async function reconcileAccount(tx: DbTransaction, input: LinkedAccountInput): Promise<LinkedAccount> {
  const accountMatch = input.spotifyAccountId
    ? await findUserBySpotifyAccountId(tx, input.spotifyAccountId)
    : null;
  const user = accountMatch ?? await findUserBySpotifyUserId(tx, input.spotifyUserId);
  const [savedUser] = user
    ? await tx.update(users).set({
      spotifyAccountId: input.spotifyAccountId,
      spotifyUserId: input.spotifyUserId,
      displayName: input.displayName,
      imageUrl: input.imageUrl,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id)).returning()
    : await tx.insert(users).values({
      spotifyAccountId: input.spotifyAccountId,
      spotifyUserId: input.spotifyUserId,
      displayName: input.displayName,
      imageUrl: input.imageUrl,
    }).returning();

  await upsertTokens(tx, savedUser.id, input);
  return { ...input, userId: savedUser.id };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function createDrizzleAccountRepository(db = getDb()): LinkedAccountRepository {
  return {
    async upsert(input) {
      try {
        return await db.transaction((tx) => reconcileAccount(tx, input));
      } catch (error) {
        if (!input.spotifyAccountId || !isUniqueConstraintViolation(error)) throw error;

        return db.transaction(async (tx) => {
          const user = await findUserBySpotifyAccountId(tx, input.spotifyAccountId!);
          if (!user) throw error;
          const [savedUser] = await tx.update(users).set({
            spotifyAccountId: input.spotifyAccountId,
            spotifyUserId: input.spotifyUserId,
            displayName: input.displayName,
            imageUrl: input.imageUrl,
            updatedAt: new Date(),
          }).where(eq(users.id, user.id)).returning();
          await upsertTokens(tx, savedUser.id, input);
          return { ...input, userId: savedUser.id };
        });
      }
    },
    async findByUserId(userId) {
      const [row] = await db.select().from(users).innerJoin(spotifyAccounts, eq(users.id, spotifyAccounts.userId)).where(eq(users.id, userId)).limit(1);
      if (!row) return null;
      return {
        userId: row.users.id,
        spotifyAccountId: row.users.spotifyAccountId,
        spotifyUserId: row.users.spotifyUserId,
        displayName: row.users.displayName,
        imageUrl: row.users.imageUrl,
        encryptedAccessToken: row.spotify_accounts.encryptedAccessToken,
        encryptedRefreshToken: row.spotify_accounts.encryptedRefreshToken,
        scopes: row.spotify_accounts.scopes,
        accessTokenExpiresAt: row.spotify_accounts.accessTokenExpiresAt,
      };
    },
  };
}
