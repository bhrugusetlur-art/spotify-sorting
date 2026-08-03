import "server-only";
import { and, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { getDb } from "@/lib/db/client";
import { generatedPlaylists, syncRuns } from "@/lib/db/schema";
import { MOODS, type GeneratedPlaylist, type Mood } from "@/lib/sorting/types";
import type { ActiveSyncRun } from "./run-repository";

export interface GeneratedPlaylistRepository {
  list(userId: string): Promise<GeneratedPlaylist[]>;
  upsert(input: GeneratedPlaylist, lease: ActiveSyncRun): Promise<GeneratedPlaylist>;
}

export function createMemoryGeneratedPlaylistRepository(dependencies: {
  withActiveLease: <T>(runId: string, leaseToken: string, operation: () => T) => Promise<T>;
}): GeneratedPlaylistRepository {
  const values = new Map<string, GeneratedPlaylist>();

  return {
    async list(userId) {
      return sortPlaylists([...values.values()].filter((value) => value.userId === userId));
    },
    async upsert(input, lease) {
      return dependencies.withActiveLease(lease.id, lease.leaseToken, () => {
        const value = { ...input };
        values.set(key(input.userId, input.mood), value);
        return { ...value };
      });
    },
  };
}

export function createDrizzleGeneratedPlaylistRepository(db = getDb()): GeneratedPlaylistRepository {
  return {
    async list(userId) {
      const rows = await db.select().from(generatedPlaylists).where(eq(generatedPlaylists.userId, userId));
      return sortPlaylists(rows.map((row) => ({
        userId: row.userId,
        mood: row.mood,
        spotifyPlaylistId: row.spotifyPlaylistId,
        playlistName: row.playlistName,
      })));
    },
    async upsert(input, lease) {
      return db.transaction(async (tx) => {
        const [active] = await tx.select({ id: syncRuns.id }).from(syncRuns).where(and(
          eq(syncRuns.id, lease.id),
          eq(syncRuns.leaseToken, lease.leaseToken),
          eq(syncRuns.status, "running"),
        )).for("update").limit(1);
        if (active === undefined) throw new AppError("SYNC_INTERRUPTED");
        const [row] = await tx.insert(generatedPlaylists).values(input).onConflictDoUpdate({
          target: [generatedPlaylists.userId, generatedPlaylists.mood],
          set: {
            spotifyPlaylistId: input.spotifyPlaylistId,
            playlistName: input.playlistName,
            updatedAt: new Date(),
          },
        }).returning();
        return {
          userId: row.userId,
          mood: row.mood,
          spotifyPlaylistId: row.spotifyPlaylistId,
          playlistName: row.playlistName,
        };
      });
    },
  };
}

function key(userId: string, mood: Mood): string {
  return `${userId}\u0000${mood}`;
}

function sortPlaylists(values: GeneratedPlaylist[]): GeneratedPlaylist[] {
  return values
    .map((value) => ({ ...value }))
    .sort((left, right) => MOODS.indexOf(left.mood) - MOODS.indexOf(right.mood));
}
