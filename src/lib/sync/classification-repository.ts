import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { songClassifications } from "@/lib/db/schema";
import type { TrackClassification } from "@/lib/sorting/types";

export interface ClassificationRepository {
  find(userId: string, trackId: string, version: string): Promise<TrackClassification | null>;
  upsert(userId: string, classification: TrackClassification): Promise<void>;
}

export function createMemoryClassificationRepository(): ClassificationRepository {
  const values = new Map<string, TrackClassification>();

  return {
    async find(userId, trackId, version) {
      const value = values.get(key(userId, trackId, version));
      return value === undefined ? null : { ...value };
    },
    async upsert(userId, classification) {
      values.set(key(userId, classification.spotifyTrackId, classification.classifierVersion), { ...classification });
    },
  };
}

export function createDrizzleClassificationRepository(db = getDb()): ClassificationRepository {
  return {
    async find(userId, trackId, version) {
      const [row] = await db.select().from(songClassifications).where(and(
        eq(songClassifications.userId, userId),
        eq(songClassifications.spotifyTrackId, trackId),
        eq(songClassifications.classifierVersion, version),
      )).limit(1);
      return row === undefined ? null : {
        spotifyTrackId: row.spotifyTrackId,
        mood: row.mood,
        classifierVersion: row.classifierVersion as TrackClassification["classifierVersion"],
        reason: row.reason,
        metadataFingerprint: row.metadataFingerprint,
      };
    },
    async upsert(userId, classification) {
      await db.insert(songClassifications).values({ userId, ...classification }).onConflictDoUpdate({
        target: [songClassifications.userId, songClassifications.spotifyTrackId, songClassifications.classifierVersion],
        set: {
          mood: classification.mood,
          reason: classification.reason,
          metadataFingerprint: classification.metadataFingerprint,
        },
      });
    },
  };
}

function key(userId: string, trackId: string, version: string): string {
  return `${userId}\u0000${trackId}\u0000${version}`;
}
