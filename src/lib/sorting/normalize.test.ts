import { describe, expect, it } from "vitest";
import type { SpotifySavedItem } from "@/lib/spotify/web-api-types";
import { fingerprintTrack, normalizeLibrary, normalizeText } from "./normalize";

const supported: SpotifySavedItem = {
  addedAt: "2026-08-02T12:00:00Z",
  item: {
    type: "track",
    id: "track-1",
    uri: "spotify:track:track-1",
    name: "  Café—CALM  ",
    artists: [
      { id: "artist-2", name: "  Björk  " },
      { id: "artist-1", name: "Zoë" },
    ],
    album: { id: "album-1", name: " À la Mode ", releaseDate: "1997-10-05" },
    durationMs: 180_000,
    explicit: false,
    isLocal: false,
  },
};

describe("normalizeText", () => {
  it("normalizes accents, case, and whitespace while preserving punctuation", () => {
    expect(normalizeText("  Café—CALM  ")).toBe("cafe—calm");
  });
});

describe("normalizeLibrary", () => {
  it("normalizes supported tracks with ordered artists and a release year", () => {
    expect(normalizeLibrary([supported])).toEqual({
      total: 1,
      unsupported: 0,
      tracks: [{
        id: "track-1",
        uri: "spotify:track:track-1",
        name: "  Café—CALM  ",
        normalizedName: "cafe—calm",
        artists: [
          { id: "artist-2", name: "  Björk  ", normalizedName: "bjork" },
          { id: "artist-1", name: "Zoë", normalizedName: "zoe" },
        ],
        albumId: "album-1",
        albumName: " À la Mode ",
        normalizedAlbumName: "a la mode",
        durationMs: 180_000,
        explicit: false,
        releaseYear: 1997,
      }],
    });
  });

  it("counts every saved item, skips unsupported records, and keeps the first duplicate", () => {
    const duplicate: SpotifySavedItem = {
      ...supported,
      item: { ...supported.item!, name: "Later duplicate" },
    };
    const local: SpotifySavedItem = {
      ...supported,
      item: { ...supported.item!, id: "local-track", uri: "spotify:local:local-track", isLocal: true },
    };
    const episode: SpotifySavedItem = {
      ...supported,
      item: { ...supported.item!, id: "episode-1", uri: "spotify:episode:episode-1", type: "episode" },
    };
    const missingId = {
      ...supported,
      item: { ...supported.item!, id: "" },
    } as SpotifySavedItem;
    const missingUri = {
      ...supported,
      item: { ...supported.item!, id: "track-missing-uri", uri: "" },
    } as SpotifySavedItem;
    const nullItem: SpotifySavedItem = { addedAt: "2026-08-02T12:00:00Z", item: null };

    const result = normalizeLibrary([supported, duplicate, nullItem, local, missingId, missingUri, episode]);

    expect(result).toMatchObject({ total: 7, unsupported: 5 });
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({ id: "track-1", name: "  Café—CALM  " });
  });

  it("treats absent track identifiers as unsupported instead of throwing", () => {
    const missingId = {
      ...supported,
      item: { ...supported.item!, id: undefined },
    } as unknown as SpotifySavedItem;
    const missingUri = {
      ...supported,
      item: { ...supported.item!, id: "track-missing-uri", uri: undefined },
    } as unknown as SpotifySavedItem;

    expect(normalizeLibrary([missingId, missingUri])).toEqual({ total: 2, unsupported: 2, tracks: [] });
  });

  it("treats malformed nested track metadata as unsupported instead of throwing", () => {
    const malformedArtists = {
      ...supported,
      item: { ...supported.item!, id: "bad-artists", uri: "spotify:track:bad-artists", artists: null },
    } as unknown as SpotifySavedItem;
    const malformedArtist = {
      ...supported,
      item: { ...supported.item!, id: "bad-artist", uri: "spotify:track:bad-artist", artists: [null] },
    } as unknown as SpotifySavedItem;
    const malformedName = {
      ...supported,
      item: { ...supported.item!, id: "bad-name", uri: "spotify:track:bad-name", name: 42 },
    } as unknown as SpotifySavedItem;
    const malformedReleaseDate = {
      ...supported,
      item: { ...supported.item!, id: "bad-release-date", uri: "spotify:track:bad-release-date", album: { ...supported.item!.album!, releaseDate: 42 } },
    } as unknown as SpotifySavedItem;
    const invalidDuration = {
      ...supported,
      item: { ...supported.item!, id: "bad-duration", uri: "spotify:track:bad-duration", durationMs: -1 },
    } as unknown as SpotifySavedItem;
    const invalidExplicit = {
      ...supported,
      item: { ...supported.item!, id: "bad-explicit", uri: "spotify:track:bad-explicit", explicit: "false" },
    } as unknown as SpotifySavedItem;

    expect(normalizeLibrary([malformedArtists, malformedArtist, malformedName, malformedReleaseDate, invalidDuration, invalidExplicit]))
      .toEqual({ total: 6, unsupported: 6, tracks: [] });
  });
});

describe("fingerprintTrack", () => {
  it("hashes the canonical metadata array and changes when semantic metadata changes", () => {
    const [track] = normalizeLibrary([supported]).tracks;

    expect(fingerprintTrack(track)).toBe("fa6a2928b3fbc9d0b939660a87e8b574edeeeba3ee0300e3e85b9b68beba09bd");
    expect(fingerprintTrack({ ...track, normalizedName: "another name" })).not.toBe(fingerprintTrack(track));
    expect(fingerprintTrack({ ...track, artists: [...track.artists].reverse() })).not.toBe(fingerprintTrack(track));
  });
});
