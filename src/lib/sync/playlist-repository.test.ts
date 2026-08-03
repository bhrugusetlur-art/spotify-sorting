import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createMemoryGeneratedPlaylistRepository } from "./playlist-repository";
import { createMemorySyncRunRepository } from "./run-repository";

const activeLease = { id: "run-1", userId: "user-1", leaseToken: "lease-1", startedAt: new Date() };

function memoryRepository(active = true) {
  return createMemoryGeneratedPlaylistRepository({
    withActiveLease: async (runId, leaseToken, operation) => {
      if (!active || runId !== activeLease.id || leaseToken !== activeLease.leaseToken) throw new AppError("SYNC_INTERRUPTED");
      return operation();
    },
  });
}

describe("memory generated-playlist repository", () => {
  it("replaces the mapping for one user and mood", async () => {
    const repository = memoryRepository();
    await repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-old", playlistName: "Mood Sorter — Chill" }, activeLease);

    await expect(repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" }, activeLease)).resolves.toEqual({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" });
    await expect(repository.list("user-1")).resolves.toEqual([
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" },
    ]);
  });

  it("keeps mappings for different moods and users", async () => {
    const repository = memoryRepository();
    await repository.upsert({ userId: "user-1", mood: "happy", spotifyPlaylistId: "playlist-happy", playlistName: "Mood Sorter — Happy" }, activeLease);
    await repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-chill", playlistName: "Mood Sorter — Chill" }, activeLease);
    await repository.upsert({ userId: "user-2", mood: "chill", spotifyPlaylistId: "playlist-other", playlistName: "Mood Sorter — Chill" }, activeLease);

    await expect(repository.list("user-1")).resolves.toEqual([
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-chill", playlistName: "Mood Sorter — Chill" },
      { userId: "user-1", mood: "happy", spotifyPlaylistId: "playlist-happy", playlistName: "Mood Sorter — Happy" },
    ]);
  });

  it("rejects a stale lease before it can overwrite a newer mapping", async () => {
    let active = true;
    const repository = createMemoryGeneratedPlaylistRepository({
      withActiveLease: async (_runId, _leaseToken, operation) => {
        if (!active) throw new AppError("SYNC_INTERRUPTED");
        return operation();
      },
    });
    await repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" }, activeLease);
    active = false;

    await expect(repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-stale", playlistName: "Mood Sorter — Chill" }, activeLease)).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" });
    await expect(repository.list("user-1")).resolves.toEqual([
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" },
    ]);
  });

  it("serializes a mapping write with replacement acquisition so an old lease cannot write last", async () => {
    const runs = createMemorySyncRunRepository({ randomUUID: (() => { let token = 0; return () => `lease-${++token}`; })() });
    const startedAt = new Date("2026-08-03T12:00:00.000Z");
    const old = await runs.acquire("user-1", startedAt);
    const repository = createMemoryGeneratedPlaylistRepository({
      withActiveLease: (runId, leaseToken, write) => {
        const fenced = runs.withActiveLease;
        if (!fenced) throw new Error("memory sync runs must support atomic lease fencing");
        return fenced(runId, leaseToken, write);
      },
    });
    await repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-original", playlistName: "Mood Sorter — Chill" }, old);

    const staleWrite = repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-stale", playlistName: "Mood Sorter — Chill" }, old);
    const fresh = await runs.acquire("user-1", new Date("2026-08-03T12:15:00.000Z"));
    await repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-fresh", playlistName: "Mood Sorter — Chill" }, fresh);
    await staleWrite;

    await expect(repository.list("user-1")).resolves.toEqual([
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-fresh", playlistName: "Mood Sorter — Chill" },
    ]);
  });
});
