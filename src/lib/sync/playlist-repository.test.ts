import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createMemoryGeneratedPlaylistRepository } from "./playlist-repository";

const activeLease = { id: "run-1", userId: "user-1", leaseToken: "lease-1", startedAt: new Date() };

function memoryRepository(active = true) {
  return createMemoryGeneratedPlaylistRepository({
    assertActiveLease: async (runId, leaseToken) => {
      if (!active || runId !== activeLease.id || leaseToken !== activeLease.leaseToken) throw new AppError("SYNC_INTERRUPTED");
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
      assertActiveLease: async () => {
        if (!active) throw new AppError("SYNC_INTERRUPTED");
      },
    });
    await repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" }, activeLease);
    active = false;

    await expect(repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-stale", playlistName: "Mood Sorter — Chill" }, activeLease)).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" });
    await expect(repository.list("user-1")).resolves.toEqual([
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" },
    ]);
  });
});
