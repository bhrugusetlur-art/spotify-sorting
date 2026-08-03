import "server-only";
import { eq, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { getDb } from "@/lib/db/client";
import { generatedPlaylists } from "@/lib/db/schema";
import { MOODS, type GeneratedPlaylist, type Mood } from "@/lib/sorting/types";
import type { ActiveSyncRun } from "./run-repository";

export interface GeneratedPlaylistRepository {
  list(userId: string): Promise<GeneratedPlaylist[]>;
  upsert(input: GeneratedPlaylist, lease: ActiveSyncRun): Promise<GeneratedPlaylist>;
}

export function createMemoryGeneratedPlaylistRepository(dependencies: {
  assertActiveLease: (runId: string, leaseToken: string) => Promise<void>;
}): GeneratedPlaylistRepository {
  const values = new Map<string, GeneratedPlaylist>();

  return {
    async list(userId) {
      return sortPlaylists([...values.values()].filter((value) => value.userId === userId));
    },
    async upsert(input, lease) {
      await dependencies.assertActiveLease(lease.id, lease.leaseToken);
      const value = { ...input };
      values.set(key(input.userId, input.mood), value);
      return { ...value };
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
      const rows = await db.execute<{
        user_id: string;
        mood: Mood;
        spotify_playlist_id: string;
        playlist_name: string;
      }>(sql`
        insert into generated_playlists (user_id, mood, spotify_playlist_id, playlist_name)
        select ${input.userId}, ${input.mood}, ${input.spotifyPlaylistId}, ${input.playlistName}
        where exists (
          select 1 from sync_runs
          where id = ${lease.id} and lease_token = ${lease.leaseToken} and status = 'running'
        )
        on conflict (user_id, mood) do update set
          spotify_playlist_id = excluded.spotify_playlist_id,
          playlist_name = excluded.playlist_name,
          updated_at = now()
        returning user_id, mood, spotify_playlist_id, playlist_name
      `);
      const row = rows[0];
      if (row === undefined) throw new AppError("SYNC_INTERRUPTED");
      return {
        userId: row.user_id,
        mood: row.mood,
        spotifyPlaylistId: row.spotify_playlist_id,
        playlistName: row.playlist_name,
      };
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
