import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { generatedPlaylists } from "@/lib/db/schema";
import { MOODS, type GeneratedPlaylist, type Mood } from "@/lib/sorting/types";

export interface GeneratedPlaylistRepository {
  list(userId: string): Promise<GeneratedPlaylist[]>;
  upsert(input: GeneratedPlaylist): Promise<GeneratedPlaylist>;
}

export function createMemoryGeneratedPlaylistRepository(): GeneratedPlaylistRepository {
  const values = new Map<string, GeneratedPlaylist>();

  return {
    async list(userId) {
      return sortPlaylists([...values.values()].filter((value) => value.userId === userId));
    },
    async upsert(input) {
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
    async upsert(input) {
      const [row] = await db.insert(generatedPlaylists).values(input).onConflictDoUpdate({
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
