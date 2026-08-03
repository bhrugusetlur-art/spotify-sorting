import "server-only";
import { AppError, toErrorCode } from "@/lib/errors";
import { CLASSIFIER_VERSION, classifyTrack } from "@/lib/sorting/classifier";
import { fingerprintTrack, normalizeLibrary } from "@/lib/sorting/normalize";
import { batchUris, managedPlaylistMetadata, missingUris, resolveManagedPlaylist } from "@/lib/sorting/playlists";
import { MOODS, type GeneratedPlaylist, type Mood, type NormalizedLibrary, type SyncCounts } from "@/lib/sorting/types";
import type { SpotifyWebApi } from "@/lib/spotify/web-api";
import type { SpotifyPlaylistSummary } from "@/lib/spotify/web-api-types";
import type { ClassificationRepository } from "./classification-repository";
import type { GeneratedPlaylistRepository } from "./playlist-repository";
import { toSafeFailure, toSyncResult, type SyncResult } from "./result";
import type { ActiveSyncRun, SyncRunRepository } from "./run-repository";

export type SpotifyWebApiPort = Pick<SpotifyWebApi,
  "savedTracks" | "currentUserPlaylists" | "playlistItems" | "createPlaylist" | "addPlaylistItems"
>;

export type SyncServiceDependencies = {
  spotify: SpotifyWebApiPort;
  classifications: ClassificationRepository;
  playlists: GeneratedPlaylistRepository;
  runs: SyncRunRepository;
  now: () => Date;
};

export type SyncInput = { userId: string; spotifyUserId: string };

export type SyncService = {
  syncLibrary(input: SyncInput): Promise<SyncResult>;
  loadLatestSyncResult(userId: string): Promise<SyncResult | null>;
};

export function createSyncService(dependencies: SyncServiceDependencies): SyncService {
  return {
    syncLibrary: async (input) => syncLibrary(dependencies, input),
    loadLatestSyncResult: async (userId) => loadLatestSyncResult(dependencies, userId),
  };
}

async function syncLibrary(dependencies: SyncServiceDependencies, input: SyncInput): Promise<SyncResult> {
  const active = await dependencies.runs.acquire(input.userId, dependencies.now());
  let library: NormalizedLibrary = { total: 0, unsupported: 0, tracks: [] };
  let mappings: GeneratedPlaylist[] = [];
  const confirmed = { added: 0, skipped: 0 };

  try {
    mappings = await dependencies.playlists.list(input.userId);
    library = normalizeLibrary(await dependencies.spotify.savedTracks());
    const classified = await classifyLibrary(dependencies.classifications, input.userId, library);
    const currentPlaylists = await dependencies.spotify.currentUserPlaylists();
    const destinations = await resolveDestinations(dependencies, active, input, mappings, currentPlaylists, classified);
    mappings = destinations.map((destination) => destination.mapping);

    for (const destination of destinations) {
      const existing = await dependencies.spotify.playlistItems(destination.mapping.spotifyPlaylistId);
      const missing = missingUris(destination.uris, existing.map((item) => item.uri));
      confirmed.skipped += destination.uris.length - missing.length;

      for (const batch of batchUris(missing)) {
        await dependencies.runs.assertActiveLease(active.id, active.leaseToken);
        await dependencies.spotify.addPlaylistItems(destination.mapping.spotifyPlaylistId, batch);
        confirmed.added += batch.length;
      }
    }

    const completed = await dependencies.runs.succeed(active.id, active.leaseToken, countsFor(library, confirmed), dependencies.now());
    return toSyncResult(completed, mappings);
  } catch (error) {
    if (toErrorCode(error) === "SYNC_INTERRUPTED") throw error;

    const failed = await dependencies.runs.fail(
      active.id,
      active.leaseToken,
      countsFor(library, confirmed),
      toSafeFailure(error),
      dependencies.now(),
    );
    try {
      mappings = await dependencies.playlists.list(input.userId);
    } catch {
      // The terminal run remains the source of truth if a best-effort mapping reload fails.
    }
    return toSyncResult(failed, mappings);
  }
}

async function loadLatestSyncResult(dependencies: SyncServiceDependencies, userId: string): Promise<SyncResult | null> {
  const run = await dependencies.runs.latest(userId);
  if (run === null) return null;
  return toSyncResult(run, await dependencies.playlists.list(userId));
}

async function classifyLibrary(
  classifications: ClassificationRepository,
  userId: string,
  library: NormalizedLibrary,
): Promise<Map<Mood, string[]>> {
  const byMood = new Map<Mood, string[]>(MOODS.map((mood) => [mood, []]));

  for (const track of library.tracks) {
    const fingerprint = fingerprintTrack(track);
    const cached = await classifications.find(userId, track.id, CLASSIFIER_VERSION);
    const classification = cached?.metadataFingerprint === fingerprint ? cached : classifyTrack(track);
    if (classification !== cached) await classifications.upsert(userId, classification);
    byMood.get(classification.mood)?.push(track.uri);
  }

  return byMood;
}

async function resolveDestinations(
  dependencies: SyncServiceDependencies,
  active: ActiveSyncRun,
  input: SyncInput,
  storedMappings: readonly GeneratedPlaylist[],
  currentPlaylists: readonly SpotifyPlaylistSummary[],
  urisByMood: ReadonlyMap<Mood, string[]>,
): Promise<Array<{ mapping: GeneratedPlaylist; uris: string[] }>> {
  const storedByMood = new Map(storedMappings.map((mapping) => [mapping.mood, mapping]));
  const destinations: Array<{ mapping: GeneratedPlaylist; uris: string[] }> = [];

  for (const mood of MOODS) {
    const resolution = resolveManagedPlaylist({
      mood,
      spotifyUserId: input.spotifyUserId,
      storedPlaylistId: storedByMood.get(mood)?.spotifyPlaylistId ?? null,
      playlists: currentPlaylists,
    });
    const playlist = resolution.kind === "create"
      ? await createDestination(dependencies, active, input.spotifyUserId, resolution.metadata)
      : resolution.playlist;
    const mapping = await dependencies.playlists.upsert({
      userId: input.userId,
      mood,
      spotifyPlaylistId: playlist.id,
      playlistName: playlist.name ?? storedByMood.get(mood)?.playlistName ?? managedPlaylistMetadata(mood).name,
    }, active);
    destinations.push({ mapping, uris: urisByMood.get(mood) ?? [] });
  }

  return destinations;
}

async function createDestination(
  dependencies: SyncServiceDependencies,
  active: ActiveSyncRun,
  spotifyUserId: string,
  metadata: { name: string; description: string },
): Promise<SpotifyPlaylistSummary> {
  await dependencies.runs.assertActiveLease(active.id, active.leaseToken);
  const playlist = await dependencies.spotify.createPlaylist({ name: metadata.name, description: metadata.description });
  if (playlist.ownerId !== spotifyUserId || playlist.public !== false) throw new AppError("SPOTIFY_RESPONSE_INVALID");
  return playlist;
}

function countsFor(library: NormalizedLibrary, confirmed: { added: number; skipped: number }): SyncCounts {
  return {
    total: library.total,
    classified: library.tracks.length,
    added: confirmed.added,
    skipped: confirmed.skipped,
    failed: library.unsupported + library.tracks.length - confirmed.added - confirmed.skipped,
  };
}
