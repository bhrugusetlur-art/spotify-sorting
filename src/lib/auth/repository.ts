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
      values.set(value.userId, value);
      return value;
    },
    async findByUserId(userId) {
      return values.get(userId) ?? null;
    },
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
