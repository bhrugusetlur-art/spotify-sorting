import { describe, expect, it } from "vitest";
import type { SpotifyPlaylistSummary } from "@/lib/spotify/web-api-types";
import {
  batchUris,
  managedPlaylistMetadata,
  missingUris,
  resolveManagedPlaylist,
} from "./playlists";

function playlist(overrides: Partial<SpotifyPlaylistSummary> = {}): SpotifyPlaylistSummary {
  return {
    id: "playlist-1",
    name: "Mood Sorter — Chill",
    description: "Managed by Mood Sorter. Mood: chill.",
    public: false,
    ownerId: "current-user",
    ...overrides,
  };
}

describe("managedPlaylistMetadata", () => {
  it.each([
    ["chill", "Mood Sorter — Chill"],
    ["hype", "Mood Sorter — Hype"],
    ["focus", "Mood Sorter — Focus"],
    ["sad", "Mood Sorter — Sad"],
    ["happy", "Mood Sorter — Happy"],
  ] as const)("creates exact private metadata for %s", (mood, name) => {
    expect(managedPlaylistMetadata(mood)).toEqual({
      name,
      description: `Managed by Mood Sorter. Mood: ${mood}.`,
      public: false,
    });
  });
});

describe("resolveManagedPlaylist", () => {
  const input = (overrides: Partial<Parameters<typeof resolveManagedPlaylist>[0]> = {}) => ({
    mood: "chill" as const,
    spotifyUserId: "current-user",
    storedPlaylistId: null,
    playlists: [],
    ...overrides,
  });

  it("reuses a valid stored mapping even when its mutable metadata was edited", () => {
    const stored = playlist({ id: "stored", name: "Renamed", description: "Edited by a person" });

    expect(resolveManagedPlaylist(input({ storedPlaylistId: "stored", playlists: [stored] }))).toEqual({
      kind: "reuse",
      playlist: stored,
    });
  });

  it("does not reuse a stored mapping owned by another user", () => {
    const stored = playlist({ id: "stored", ownerId: "someone-else" });

    expect(resolveManagedPlaylist(input({ storedPlaylistId: "stored", playlists: [stored] }))).toEqual({
      kind: "create",
      metadata: managedPlaylistMetadata("chill"),
    });
  });

  it.each([
    ["public", playlist({ public: true })],
    ["unknown privacy", playlist({ public: null })],
    ["absent privacy", { ...playlist(), public: undefined } as unknown as SpotifyPlaylistSummary],
  ])("does not reuse a stored mapping with %s", (_label, stored) => {
    expect(resolveManagedPlaylist(input({ storedPlaylistId: stored.id, playlists: [stored] }))).toEqual({
      kind: "create",
      metadata: managedPlaylistMetadata("chill"),
    });
  });

  it("recovers only an owned private playlist with the exact managed marker", () => {
    const recovered = playlist({ id: "recover" });
    const missingMarker = playlist({ id: "same-name", description: "A regular chill playlist" });

    expect(resolveManagedPlaylist(input({ playlists: [missingMarker, recovered] }))).toEqual({
      kind: "recover",
      playlist: recovered,
    });
  });

  it("does not adopt an unrelated same-name playlist", () => {
    const unrelated = playlist({ description: "Made for a road trip" });

    expect(resolveManagedPlaylist(input({ playlists: [unrelated] }))).toEqual({
      kind: "create",
      metadata: managedPlaylistMetadata("chill"),
    });
  });

  it("chooses the lexicographically smallest recoverable playlist ID", () => {
    const larger = playlist({ id: "z-playlist" });
    const smaller = playlist({ id: "a-playlist" });

    expect(resolveManagedPlaylist(input({ playlists: [larger, smaller] }))).toEqual({
      kind: "recover",
      playlist: smaller,
    });
  });
});

describe("missingUris", () => {
  it("preserves first-encounter order while removing existing and duplicate desired URIs", () => {
    expect(missingUris(
      ["spotify:track:third", "spotify:track:first", "spotify:track:third", "spotify:track:second"],
      ["spotify:track:first", "spotify:track:existing"],
    )).toEqual(["spotify:track:third", "spotify:track:second"]);
  });
});

describe("batchUris", () => {
  it("returns no batches for an empty URI list", () => {
    expect(batchUris([])).toEqual([]);
  });

  it("keeps 100 URIs in one batch and splits a 101st URI into a second batch", () => {
    const uris = Array.from({ length: 101 }, (_, index) => `spotify:track:${index}`);

    expect(batchUris(uris)).toEqual([uris.slice(0, 100), ["spotify:track:100"]]);
  });
});
