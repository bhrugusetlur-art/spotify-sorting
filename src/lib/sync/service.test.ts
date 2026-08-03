import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createMemoryClassificationRepository } from "./classification-repository";
import { createMemoryGeneratedPlaylistRepository } from "./playlist-repository";
import { createMemorySyncRunRepository, type SyncRunRepository } from "./run-repository";
import { createSyncService } from "./service";
import type { SpotifyPlaylistItem, SpotifyPlaylistSummary, SpotifySavedItem } from "@/lib/spotify/web-api-types";
import type { Mood, TrackClassification } from "@/lib/sorting/types";

const userId = "user-1";
const spotifyUserId = "spotify-user-1";
const now = new Date("2026-08-03T12:00:00.000Z");

describe("sync service", () => {
  it("creates and fills five private mood playlists in a deterministic first run", async () => {
    const spotify = new FakeSpotify([track("chill"), track("hype"), track("focus"), track("sad"), track("happy"), unsupportedItem()]);
    const dependencies = memoryDependencies(spotify);
    const service = createSyncService(dependencies);

    const result = await service.syncLibrary({ userId, spotifyUserId });

    expect(spotify.savedTracksCalls).toBe(1);
    expect(spotify.creations).toEqual([
      { name: "Mood Sorter — Chill", description: "Managed by Mood Sorter. Mood: chill." },
      { name: "Mood Sorter — Hype", description: "Managed by Mood Sorter. Mood: hype." },
      { name: "Mood Sorter — Focus", description: "Managed by Mood Sorter. Mood: focus." },
      { name: "Mood Sorter — Sad", description: "Managed by Mood Sorter. Mood: sad." },
      { name: "Mood Sorter — Happy", description: "Managed by Mood Sorter. Mood: happy." },
    ]);
    expect(spotify.additions).toEqual([
      { id: "playlistchill", uris: ["spotify:track:chill"] },
      { id: "playlisthype", uris: ["spotify:track:hype"] },
      { id: "playlistfocus", uris: ["spotify:track:focus"] },
      { id: "playlistsad", uris: ["spotify:track:sad"] },
      { id: "playlisthappy", uris: ["spotify:track:happy"] },
    ]);
    await expect(dependencies.playlists.list(userId)).resolves.toEqual([
      "chill", "hype", "focus", "sad", "happy"].map((mood) => ({
        userId,
        mood: mood as Mood,
        spotifyPlaylistId: `playlist${mood}`,
        playlistName: `Mood Sorter — ${title(mood as Mood)}`,
      })),
    );
    expect(result.run).toMatchObject({ status: "succeeded", counts: { total: 6, classified: 5, added: 5, skipped: 0, failed: 1 } });
    expect(result.playlists).toEqual([
      "chill", "hype", "focus", "sad", "happy"].map((mood) => ({
        mood,
        name: `Mood Sorter — ${title(mood as Mood)}`,
        spotifyPlaylistId: `playlist${mood}`,
        url: `https://open.spotify.com/playlist/playlist${mood}`,
      })),
    );
  });

  it("does not create or add anything on an identical second run", async () => {
    const spotify = new FakeSpotify([track("chill"), track("hype"), track("focus"), track("sad"), track("happy"), unsupportedItem()]);
    const service = createSyncService(memoryDependencies(spotify));

    await service.syncLibrary({ userId, spotifyUserId });
    const second = await service.syncLibrary({ userId, spotifyUserId });

    expect(spotify.creations).toHaveLength(5);
    expect(spotify.additions).toHaveLength(5);
    expect(second.run).toMatchObject({ status: "succeeded", counts: { total: 6, classified: 5, added: 0, skipped: 5, failed: 1 } });
  });

  it("reclassifies and persists only a changed track fingerprint", async () => {
    const spotify = new FakeSpotify([track("chill"), track("hype")]);
    const dependencies = memoryDependencies(spotify);
    const upserts: TrackClassification[] = [];
    const originalUpsert = dependencies.classifications.upsert.bind(dependencies.classifications);
    dependencies.classifications.upsert = async (id, value) => {
      upserts.push(value);
      await originalUpsert(id, value);
    };
    const service = createSyncService(dependencies);

    await service.syncLibrary({ userId, spotifyUserId });
    upserts.length = 0;
    spotify.saved = [track("chill", { name: "happy chill" }), track("hype")];
    await service.syncLibrary({ userId, spotifyUserId });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ spotifyTrackId: "chill", mood: "chill" });
  });

  it("returns mappings saved before a destination-resolution failure", async () => {
    const spotify = new FakeSpotify([track("chill")]);
    spotify.failCreate = ({ call }) => call === 2 ? new AppError("SPOTIFY_UNAVAILABLE") : null;
    const dependencies = memoryDependencies(spotify);

    const result = await createSyncService(dependencies).syncLibrary({ userId, spotifyUserId });

    expect(result.run).toMatchObject({ status: "failed", counts: { total: 1, classified: 1, added: 0, skipped: 0, failed: 1 } });
    expect(result.playlists).toEqual([{
      mood: "chill",
      name: "Mood Sorter — Chill",
      spotifyPlaylistId: "playlistchill",
      url: "https://open.spotify.com/playlist/playlistchill",
    }]);
  });

  it.each([
    ["a different owner", "another-user", false],
    ["a public response", spotifyUserId, true],
    ["an unknown privacy response", spotifyUserId, null],
  ])("rejects a created playlist with %s before persisting its mapping", async (_label, ownerId, publicValue) => {
    const spotify = new FakeSpotify([track("chill")]);
    spotify.createdOwnerId = ownerId;
    spotify.createdPublic = publicValue;
    const dependencies = memoryDependencies(spotify);

    const result = await createSyncService(dependencies).syncLibrary({ userId, spotifyUserId });

    expect(result.run).toMatchObject({ status: "failed", failure: { code: "SPOTIFY_RESPONSE_INVALID" } });
    expect(result.playlists).toEqual([]);
  });

  it("recovers only an exact owned private playlist and replaces stale public mappings", async () => {
    const spotify = new FakeSpotify([track("chill"), track("hype")]);
    spotify.playlists = [
      playlist("recoveredchill", "Mood Sorter — Chill", "Managed by Mood Sorter. Mood: chill."),
      playlist("publichype", "Mood Sorter — Hype", "Managed by Mood Sorter. Mood: hype.", true),
      playlist("unrelated", "Mood Sorter — Focus", "not the marker"),
    ];
    const dependencies = memoryDependencies(spotify);
    await seedMapping(dependencies, { userId, mood: "chill", spotifyPlaylistId: "missing", playlistName: "old" });
    await seedMapping(dependencies, { userId, mood: "hype", spotifyPlaylistId: "publichype", playlistName: "old" });

    const result = await createSyncService(dependencies).syncLibrary({ userId, spotifyUserId });

    expect(spotify.creations.map((entry) => entry.name)).toEqual([
      "Mood Sorter — Hype", "Mood Sorter — Focus", "Mood Sorter — Sad", "Mood Sorter — Happy",
    ]);
    expect(spotify.additions).toContainEqual({ id: "recoveredchill", uris: ["spotify:track:chill"] });
    expect(spotify.playlists.find((entry) => entry.id === "unrelated")).toEqual(playlist("unrelated", "Mood Sorter — Focus", "not the marker"));
    expect(result.playlists.find((entry) => entry.mood === "chill")?.url).toBe("https://open.spotify.com/playlist/recoveredchill");
    await expect(dependencies.playlists.list(userId)).resolves.toContainEqual({ userId, mood: "hype", spotifyPlaylistId: "playlisthype", playlistName: "Mood Sorter — Hype" });
  });

  it("accounts for a partial batch failure and never writes later moods", async () => {
    const spotify = new FakeSpotify([
      ...Array.from({ length: 101 }, (_, index) => track(`chill${index}`, { name: `chill ${index}` })),
      track("hype"),
      unsupportedItem(),
    ]);
    spotify.failAddition = ({ id, call }) => id === "playlistchill" && call === 2 ? new AppError("SPOTIFY_UNAVAILABLE") : null;

    const result = await createSyncService(memoryDependencies(spotify)).syncLibrary({ userId, spotifyUserId });

    expect(result.run).toMatchObject({ status: "failed", failure: { code: "SPOTIFY_UNAVAILABLE" } });
    expect(result.run.counts).toEqual({ total: 103, classified: 102, added: 100, skipped: 0, failed: 3 });
    expect(result.run.counts.added + result.run.counts.skipped + (result.run.counts.failed - 1)).toBe(result.run.counts.classified);
    expect(spotify.additions.map((entry) => entry.id)).toEqual(["playlistchill", "playlistchill"]);
  });

  it("fences a stale worker before its next Spotify mutation or terminal write", async () => {
    const spotify = new FakeSpotify([track("chill")]);
    const base = createMemorySyncRunRepository({ randomUUID: (() => { let next = 0; return () => `token-${++next}`; })() });
    const gate = deferred<void>();
    let assertions = 0;
    const runs: SyncRunRepository = {
      ...base,
      async assertActiveLease(runId, leaseToken) {
        assertions += 1;
        if (assertions === 6) await gate.promise;
        await base.assertActiveLease(runId, leaseToken);
      },
    };
    const dependencies = memoryDependencies(spotify);
    dependencies.runs = runs;
    dependencies.playlists = createMemoryGeneratedPlaylistRepository({
      withActiveLease: (id, token, operation) => {
        const fenced = base.withActiveLease;
        if (!fenced) throw new Error("memory sync runs must support atomic lease fencing");
        return fenced(id, token, operation);
      },
    });
    const service = createSyncService(dependencies);

    const oldRun = service.syncLibrary({ userId, spotifyUserId });
    await waitFor(() => assertions === 6);
    const replacement = await base.acquire(userId, new Date(now.getTime() + 15 * 60_000));
    gate.resolve();

    await expect(oldRun).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" });
    expect(spotify.additions).toEqual([]);
    await expect(base.latest(userId)).resolves.toMatchObject({ id: replacement.id, status: "running" });
  });

  it("loads the latest persisted result with fixed playlist ordering", async () => {
    const spotify = new FakeSpotify([]);
    const dependencies = memoryDependencies(spotify);
    const service = createSyncService(dependencies);

    expect(await service.loadLatestSyncResult(userId)).toBeNull();
    await seedMapping(dependencies, { userId, mood: "happy", spotifyPlaylistId: "playlisthappy", playlistName: "Mood Sorter — Happy" });
    await seedMapping(dependencies, { userId, mood: "chill", spotifyPlaylistId: "playlistchill", playlistName: "Mood Sorter — Chill" });
    const active = await dependencies.runs.acquire(userId, now);
    await dependencies.runs.succeed(active.id, active.leaseToken, { total: 0, classified: 0, added: 0, skipped: 0, failed: 0 }, now);

    await expect(service.loadLatestSyncResult(userId)).resolves.toMatchObject({ playlists: [
      { mood: "chill" }, { mood: "happy" },
    ] });
  });
});

function memoryDependencies(spotify: FakeSpotify) {
  const runs = createMemorySyncRunRepository({ randomUUID: () => "lease-token" });
  return {
    spotify,
    classifications: createMemoryClassificationRepository(),
    playlists: createMemoryGeneratedPlaylistRepository({
      withActiveLease: (id, token, operation) => {
        const fenced = runs.withActiveLease;
        if (!fenced) throw new Error("memory sync runs must support atomic lease fencing");
        return fenced(id, token, operation);
      },
    }),
    runs,
    now: () => new Date(now),
  };
}

class FakeSpotify {
  saved: SpotifySavedItem[];
  playlists: SpotifyPlaylistSummary[] = [];
  readonly playlistItemsById = new Map<string, SpotifyPlaylistItem[]>();
  readonly creations: Array<{ name: string; description: string }> = [];
  readonly additions: Array<{ id: string; uris: string[] }> = [];
  createdOwnerId: string | null = null;
  createdPublic: boolean | null = false;
  savedTracksCalls = 0;
  failCreate: ((input: { call: number; name: string; description: string }) => Error | null) | null = null;
  failAddition: ((input: { id: string; call: number; uris: string[] }) => Error | null) | null = null;

  constructor(saved: SpotifySavedItem[]) {
    this.saved = saved;
  }

  async savedTracks(): Promise<SpotifySavedItem[]> {
    this.savedTracksCalls += 1;
    return this.saved;
  }
  async currentUserPlaylists(): Promise<SpotifyPlaylistSummary[]> { return this.playlists; }
  async playlistItems(id: string): Promise<SpotifyPlaylistItem[]> { return this.playlistItemsById.get(id) ?? []; }
  async createPlaylist(input: { name: string; description: string }): Promise<SpotifyPlaylistSummary> {
    this.creations.push(input);
    const failure = this.failCreate?.({ ...input, call: this.creations.length }) ?? null;
    if (failure !== null) throw failure;
    const mood = input.description.match(/Mood: (chill|hype|focus|sad|happy)\./)?.[1] as Mood;
    const created = {
      ...playlist(`playlist${mood}`, input.name, input.description),
      ownerId: this.createdOwnerId ?? spotifyUserId,
      public: this.createdPublic,
    };
    this.playlists.push(created);
    return created;
  }
  async addPlaylistItems(id: string, uris: string[]): Promise<void> {
    const entry = { id, uris: [...uris] };
    this.additions.push(entry);
    const failure = this.failAddition?.({ ...entry, call: this.additions.length }) ?? null;
    if (failure !== null) throw failure;
    this.playlistItemsById.set(id, [...(this.playlistItemsById.get(id) ?? []), ...uris.map((uri) => ({ uri }))]);
  }
}

function track(id: string, overrides: Partial<NonNullable<SpotifySavedItem["item"]>> = {}): SpotifySavedItem {
  return {
    addedAt: null,
    item: {
      type: "track",
      id,
      uri: `spotify:track:${id}`,
      name: id,
      artists: [{ id: "artist", name: "Artist" }],
      album: { id: "album", name: "Album", releaseDate: "2020-01-01" },
      durationMs: 180_000,
      explicit: false,
      isLocal: false,
      ...overrides,
    },
  };
}

function unsupportedItem(): SpotifySavedItem { return { addedAt: null, item: null }; }

function playlist(id: string, name: string, description: string, publicValue = false): SpotifyPlaylistSummary {
  return { id, name, description, public: publicValue, ownerId: spotifyUserId };
}

function title(mood: Mood): string { return mood.slice(0, 1).toUpperCase() + mood.slice(1); }

async function seedMapping(
  dependencies: ReturnType<typeof memoryDependencies>,
  mapping: { userId: string; mood: Mood; spotifyPlaylistId: string; playlistName: string },
): Promise<void> {
  const active = await dependencies.runs.acquire(mapping.userId, new Date(now.getTime() - 1));
  await dependencies.playlists.upsert(mapping, active);
  await dependencies.runs.succeed(active.id, active.leaseToken, { total: 0, classified: 0, added: 0, skipped: 0, failed: 0 }, new Date(now.getTime() - 1));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}
