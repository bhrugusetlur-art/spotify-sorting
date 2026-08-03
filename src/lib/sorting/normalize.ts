import { createHash } from "node:crypto";
import type { SpotifySavedItem } from "@/lib/spotify/web-api-types";
import type { NormalizedLibrary, NormalizedTrack } from "./types";

type ValidArtist = { id: string | null | undefined; name: string | null | undefined };
type ValidAlbum = { id: string | null | undefined; name: string | null | undefined; releaseDate: string | null | undefined };
type ValidTrackItem = {
  id: string;
  uri: string;
  name: string | null | undefined;
  artists: ValidArtist[];
  album: ValidAlbum | null | undefined;
  durationMs: number | null | undefined;
  explicit: boolean | null | undefined;
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeLibrary(items: SpotifySavedItem[]): NormalizedLibrary {
  const tracks: NormalizedTrack[] = [];
  const seenTrackIds = new Set<string>();
  let unsupported = 0;

  for (const savedItem of items) {
    const track = normalizeSavedItem(savedItem);
    if (track === null) {
      unsupported += 1;
      continue;
    }
    if (seenTrackIds.has(track.id)) continue;

    seenTrackIds.add(track.id);
    tracks.push(track);
  }

  return { total: items.length, unsupported, tracks };
}

export function fingerprintTrack(track: NormalizedTrack): string {
  const canonicalMetadata = [
    track.id,
    track.normalizedName,
    track.artists.map((artist) => [artist.id, artist.normalizedName]),
    track.albumId,
    track.normalizedAlbumName,
    track.durationMs,
    track.explicit,
    track.releaseYear,
  ];

  return createHash("sha256").update(JSON.stringify(canonicalMetadata), "utf8").digest("hex");
}

function normalizeSavedItem(savedItem: SpotifySavedItem): NormalizedTrack | null {
  const item = isRecord(savedItem) ? savedItem.item : null;
  if (!isSupportedTrackItem(item)) return null;

  const albumName = item.album?.name ?? "";
  return {
    id: item.id,
    uri: item.uri,
    name: item.name ?? "",
    normalizedName: normalizeText(item.name ?? ""),
    artists: item.artists.map((artist) => ({
      id: artist.id ?? "",
      name: artist.name ?? "",
      normalizedName: normalizeText(artist.name ?? ""),
    })),
    albumId: item.album?.id ?? null,
    albumName,
    normalizedAlbumName: normalizeText(albumName),
    durationMs: item.durationMs ?? 0,
    explicit: item.explicit ?? false,
    releaseYear: releaseYear(item.album?.releaseDate ?? null),
  };
}

function releaseYear(releaseDate: string | null): number | null {
  const match = releaseDate?.match(/^(\d{4})(?:$|-)/);
  return match === null || match === undefined ? null : Number(match[1]);
}

function isSupportedTrackItem(value: unknown): value is ValidTrackItem {
  if (!isRecord(value)) return false;

  return value.type === "track"
    && value.isLocal !== true
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.uri)
    && isNullableString(value.name)
    && Array.isArray(value.artists)
    && value.artists.every(isValidArtist)
    && isValidAlbum(value.album)
    && isNullableNonnegativeInteger(value.durationMs)
    && isNullableBoolean(value.explicit)
    && isNullableBoolean(value.isLocal);
}

function isValidArtist(value: unknown): value is ValidArtist {
  return isRecord(value) && isNullableString(value.id) && isNullableString(value.name);
}

function isValidAlbum(value: unknown): value is ValidAlbum | null | undefined {
  return value === null || value === undefined || (
    isRecord(value)
    && isNullableString(value.id)
    && isNullableString(value.name)
    && isNullableString(value.releaseDate)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function isNullableBoolean(value: unknown): value is boolean | null | undefined {
  return value === null || value === undefined || typeof value === "boolean";
}

function isNullableNonnegativeInteger(value: unknown): value is number | null | undefined {
  return value === null || value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}
