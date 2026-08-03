import { describe, expect, it } from "vitest";
import { createMemoryGeneratedPlaylistRepository } from "./playlist-repository";

describe("memory generated-playlist repository", () => {
  it("replaces the mapping for one user and mood", async () => {
    const repository = createMemoryGeneratedPlaylistRepository();
    await repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-old", playlistName: "Mood Sorter — Chill" });

    await expect(repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" })).resolves.toEqual({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" });
    await expect(repository.list("user-1")).resolves.toEqual([
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" },
    ]);
  });

  it("keeps mappings for different moods and users", async () => {
    const repository = createMemoryGeneratedPlaylistRepository();
    await repository.upsert({ userId: "user-1", mood: "happy", spotifyPlaylistId: "playlist-happy", playlistName: "Mood Sorter — Happy" });
    await repository.upsert({ userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-chill", playlistName: "Mood Sorter — Chill" });
    await repository.upsert({ userId: "user-2", mood: "chill", spotifyPlaylistId: "playlist-other", playlistName: "Mood Sorter — Chill" });

    await expect(repository.list("user-1")).resolves.toEqual([
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "playlist-chill", playlistName: "Mood Sorter — Chill" },
      { userId: "user-1", mood: "happy", spotifyPlaylistId: "playlist-happy", playlistName: "Mood Sorter — Happy" },
    ]);
  });
});
