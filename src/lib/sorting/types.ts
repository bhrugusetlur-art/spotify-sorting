import type { ErrorCode } from "@/lib/errors";

export const MOODS = ["chill", "hype", "focus", "sad", "happy"] as const;

export type Mood = (typeof MOODS)[number];

export type NormalizedTrack = {
  id: string;
  uri: string;
  name: string;
  normalizedName: string;
  artists: Array<{ id: string; name: string; normalizedName: string }>;
  albumId: string | null;
  albumName: string;
  normalizedAlbumName: string;
  durationMs: number;
  explicit: boolean;
  releaseYear: number | null;
};

export type TrackClassification = {
  spotifyTrackId: string;
  mood: Mood;
  classifierVersion: "metadata-v1";
  reason: string;
  metadataFingerprint: string;
};

export type SyncCounts = {
  total: number;
  classified: number;
  added: number;
  skipped: number;
  failed: number;
};

export type SafeFailure = { code: ErrorCode; message: string };

export type GeneratedPlaylist = {
  userId: string;
  mood: Mood;
  spotifyPlaylistId: string;
  playlistName: string;
};

export type NormalizedLibrary = {
  total: number;
  unsupported: number;
  tracks: NormalizedTrack[];
};
