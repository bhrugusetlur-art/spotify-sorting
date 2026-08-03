import { describe, expect, it } from "vitest";
import type { NormalizedTrack } from "./types";
import { classifyTrack } from "./classifier";

function track(overrides: Partial<NormalizedTrack> = {}): NormalizedTrack {
  return {
    id: "track-1",
    uri: "spotify:track:track-1",
    name: "Neutral song",
    normalizedName: "neutral song",
    artists: [{ id: "artist-1", name: "Neutral Artist", normalizedName: "neutral artist" }],
    albumId: "album-1",
    albumName: "Neutral Album",
    normalizedAlbumName: "neutral album",
    durationMs: 180_000,
    explicit: false,
    releaseYear: 2024,
    ...overrides,
  };
}

describe("classifyTrack", () => {
  it.each([
    ["chill", "calm"],
    ["hype", "party"],
    ["focus", "study"],
    ["sad", "heartbreak"],
    ["happy", "sunshine"],
  ] as const)("classifies a %s keyword in the track name", (mood, keyword) => {
    const result = classifyTrack(track({ normalizedName: keyword }));

    expect(result).toMatchObject({
      spotifyTrackId: "track-1",
      mood,
      classifierVersion: "metadata-v1",
      reason: `track name: ${keyword}`,
    });
    expect(result.metadataFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches only whole tokens and complete phrases", () => {
    const phrase = classifyTrack(track({ normalizedName: "good vibes only" }));
    const partialToken = classifyTrack(track({ id: "stable-track", normalizedName: "unhappy good feeling vibes", artists: [{ id: "artist-a", name: "Neutral", normalizedName: "neutral" }] }));

    expect(phrase).toMatchObject({ mood: "happy", reason: "track name: good vibes" });
    expect(partialToken).toMatchObject({ mood: "chill", reason: "Stable metadata fallback." });
  });

  it("weights track, album, and artist fields while counting a keyword once per field", () => {
    const result = classifyTrack(track({
      normalizedName: "calm",
      normalizedAlbumName: "party party party",
      artists: [{ id: "artist-1", name: "Party Artist", normalizedName: "party artist" }],
    }));

    expect(result).toMatchObject({ mood: "chill", reason: "track name: calm" });
  });

  it("uses the fixed mood order to resolve equal scores", () => {
    const result = classifyTrack(track({ normalizedName: "happy sad focus party calm" }));

    expect(result).toMatchObject({ mood: "chill", reason: "track name: calm" });
  });

  it("normalizes accents for metadata matching", () => {
    const result = classifyTrack(track({ normalizedName: "CÁLM" }));

    expect(result).toMatchObject({ mood: "chill", reason: "track name: calm" });
  });

  it.each(["lofi", "lo-fi"])("recognizes %s as a focus keyword", (keyword) => {
    const result = classifyTrack(track({ normalizedName: keyword }));

    expect(result).toMatchObject({ mood: "focus", reason: `track name: ${keyword}` });
  });

  it("uses the stable metadata fallback and changes it with the primary artist", () => {
    const first = classifyTrack(track({
      id: "stable-track",
      artists: [{ id: "artist-a", name: "Neutral", normalizedName: "neutral" }],
    }));
    const changedArtist = classifyTrack(track({
      id: "stable-track",
      artists: [{ id: "artist-b", name: "Neutral", normalizedName: "neutral" }],
    }));

    expect(first).toMatchObject({ mood: "chill", reason: "Stable metadata fallback." });
    expect(changedArtist).toMatchObject({ mood: "happy", reason: "Stable metadata fallback." });
  });
});
