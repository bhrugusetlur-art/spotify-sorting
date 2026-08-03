import type { SpotifyPlaylistSummary } from "@/lib/spotify/web-api-types";
import type { Mood } from "./types";

export type ManagedPlaylistMetadata = {
  name: string;
  description: string;
  public: false;
};

export type PlaylistResolution =
  | { kind: "reuse"; playlist: SpotifyPlaylistSummary }
  | { kind: "recover"; playlist: SpotifyPlaylistSummary }
  | { kind: "create"; metadata: ManagedPlaylistMetadata };

export type ResolveManagedPlaylistInput = {
  mood: Mood;
  spotifyUserId: string;
  storedPlaylistId: string | null;
  playlists: readonly SpotifyPlaylistSummary[];
};

const titleByMood: Record<Mood, string> = {
  chill: "Chill",
  hype: "Hype",
  focus: "Focus",
  sad: "Sad",
  happy: "Happy",
};

export function managedPlaylistMetadata(mood: Mood): ManagedPlaylistMetadata {
  return {
    name: `Mood Sorter — ${titleByMood[mood]}`,
    description: `Managed by Mood Sorter. Mood: ${mood}.`,
    public: false,
  };
}

export function resolveManagedPlaylist(input: ResolveManagedPlaylistInput): PlaylistResolution {
  const stored = input.storedPlaylistId === null
    ? undefined
    : input.playlists.find((playlist) => playlist.id === input.storedPlaylistId);

  if (stored !== undefined && isOwnedPrivatePlaylist(stored, input.spotifyUserId)) {
    return { kind: "reuse", playlist: stored };
  }

  const metadata = managedPlaylistMetadata(input.mood);
  const recovered = input.playlists
    .filter((playlist) => isOwnedPrivatePlaylist(playlist, input.spotifyUserId))
    .filter((playlist) => playlist.name === metadata.name && playlist.description === metadata.description)
    .reduce<SpotifyPlaylistSummary | undefined>((smallest, playlist) => (
      smallest === undefined || playlist.id < smallest.id ? playlist : smallest
    ), undefined);

  return recovered === undefined
    ? { kind: "create", metadata }
    : { kind: "recover", playlist: recovered };
}

export function missingUris(
  desired: Iterable<string>,
  existing: Iterable<string | null | undefined>,
): string[] {
  const present = new Set(existing);
  const seen = new Set<string>();
  const missing: string[] = [];

  for (const uri of desired) {
    if (!present.has(uri) && !seen.has(uri)) {
      missing.push(uri);
      seen.add(uri);
    }
  }

  return missing;
}

export function batchUris(uris: readonly string[]): string[][] {
  const batches: string[][] = [];

  for (let index = 0; index < uris.length; index += 100) {
    batches.push(uris.slice(index, index + 100));
  }

  return batches;
}

function isOwnedPrivatePlaylist(playlist: SpotifyPlaylistSummary, spotifyUserId: string): boolean {
  return playlist.ownerId === spotifyUserId && playlist.public === false;
}
