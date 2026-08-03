import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { toSafeFailure, toSyncResult } from "./result";

const run = {
  id: "run-1",
  userId: "user-1",
  status: "failed" as const,
  counts: { total: 4, classified: 3, added: 1, skipped: 1, failed: 2 },
  failure: { code: "SPOTIFY_UNAVAILABLE" as const, message: "safe" },
  startedAt: new Date("2026-08-03T12:00:00.000Z"),
  completedAt: new Date("2026-08-03T12:01:00.000Z"),
};

describe("sync result serialization", () => {
  it("serializes valid known mappings in the fixed mood order", () => {
    expect(toSyncResult(run, [
      { userId: "user-1", mood: "happy", spotifyPlaylistId: "7ouMYWpwJ422jRcDASZB7P", playlistName: "Mood Sorter — Happy" },
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "4NHQUGzhtTLFvgF5SZesLK", playlistName: "Mood Sorter — Chill" },
    ])).toMatchObject({
      run,
      playlists: [
        { mood: "chill", name: "Mood Sorter — Chill", url: "https://open.spotify.com/playlist/4NHQUGzhtTLFvgF5SZesLK" },
        { mood: "happy", name: "Mood Sorter — Happy", url: "https://open.spotify.com/playlist/7ouMYWpwJ422jRcDASZB7P" },
      ],
    });
  });

  it("never turns malformed stored playlist data into an external URL", () => {
    const result = toSyncResult(run, [
      { userId: "user-1", mood: "chill", spotifyPlaylistId: "abc/../attacker?x=1", playlistName: "Untrusted" },
    ]);

    expect(result.playlists).toEqual([]);
  });

  it("maps known and unexpected failures to safe public messages", () => {
    expect(toSafeFailure(new AppError("SPOTIFY_RATE_LIMITED"))).toEqual({
      code: "SPOTIFY_RATE_LIMITED",
      message: "Spotify is rate limiting requests. Please try again shortly.",
    });
    expect(toSafeFailure(new Error("token=secret should never escape"))).toEqual({
      code: "INTERNAL_ERROR",
      message: "We could not sort your music. Please try again.",
    });
  });
});
