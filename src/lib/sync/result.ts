import { toErrorCode } from "@/lib/errors";
import { MOODS, type GeneratedPlaylist, type SafeFailure } from "@/lib/sorting/types";
import type { SyncRun } from "./run-repository";

export type SyncPlaylistResult = {
  mood: GeneratedPlaylist["mood"];
  name: string;
  spotifyPlaylistId: string;
  url: string;
};

export type SyncResult = {
  run: SyncRun;
  playlists: SyncPlaylistResult[];
};

const messages = {
  AUTH_REQUIRED: "Please reconnect your Spotify account and try again.",
  SPOTIFY_PERMISSION_DENIED: "Spotify did not grant the permissions needed to sort your music.",
  SPOTIFY_RATE_LIMITED: "Spotify is rate limiting requests. Please try again shortly.",
  SPOTIFY_RESPONSE_INVALID: "Spotify returned an unexpected response. Please try again.",
  SPOTIFY_UNAVAILABLE: "Spotify could not complete the sorting request. Please try again.",
  PLAYLIST_SYNC_FAILED: "Spotify could not complete the sorting request. Please try again.",
  SYNC_ALREADY_RUNNING: "A sorting run is already in progress.",
  SYNC_INTERRUPTED: "This sorting run was interrupted by a newer request.",
  AUTH_STATE_INVALID: "Please reconnect your Spotify account and try again.",
  CONFIGURATION_INVALID: "The sorting service is temporarily unavailable.",
  INTERNAL_ERROR: "We could not sort your music. Please try again.",
} as const;

export function toSafeFailure(error: unknown): SafeFailure {
  return toSafeFailureForCode(toErrorCode(error));
}

export function toSafeFailureForCode(code: unknown): SafeFailure {
  const safeCode = isErrorCode(code) ? code : "INTERNAL_ERROR";
  return { code: safeCode, message: messages[safeCode] };
}

function isErrorCode(code: unknown): code is keyof typeof messages {
  return typeof code === "string" && Object.hasOwn(messages, code);
}

export function toSyncResult(run: SyncRun, mappings: readonly GeneratedPlaylist[]): SyncResult {
  const playlists = MOODS.flatMap((mood) => {
    const mapping = mappings.find((entry) => entry.mood === mood);
    return mapping === undefined || !isSpotifyPlaylistId(mapping.spotifyPlaylistId)
      ? []
      : [{
        mood,
        name: mapping.playlistName,
        spotifyPlaylistId: mapping.spotifyPlaylistId,
        url: `https://open.spotify.com/playlist/${mapping.spotifyPlaylistId}`,
      }];
  });

  return {
    run: cloneRun(run),
    playlists,
  };
}

export function isSpotifyPlaylistId(value: string): boolean {
  return /^[A-Za-z0-9]{1,128}$/u.test(value);
}

function cloneRun(run: SyncRun): SyncRun {
  return {
    ...run,
    counts: { ...run.counts },
    failure: run.failure === null ? null : { ...run.failure },
    startedAt: new Date(run.startedAt),
    completedAt: run.completedAt === null ? null : new Date(run.completedAt),
  };
}
