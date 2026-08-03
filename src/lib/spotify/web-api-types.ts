import { z } from "zod";

const nullableString = z.string().nullable().optional().transform((value) => value ?? null);

const artistSchema = z.object({
  id: nullableString,
  name: nullableString,
});

const albumSchema = z.object({
  id: nullableString,
  name: nullableString,
  release_date: nullableString,
});

const savedTrackSchema = z.object({
  type: nullableString,
  id: z.string().min(1),
  uri: z.string().min(1),
  name: nullableString,
  artists: z.array(artistSchema).nullable().optional().transform((value) => value ?? []),
  album: albumSchema.nullable().optional().transform((value) => value ?? null),
  duration_ms: z.number().int().nonnegative().nullable().optional().transform((value) => value ?? null),
  explicit: z.boolean().nullable().optional().transform((value) => value ?? null),
  is_local: z.boolean().nullable().optional().transform((value) => value ?? null),
});

const savedItemSchema = z.object({
  added_at: nullableString,
  track: savedTrackSchema.nullable().optional().transform((value) => value ?? null),
});

const playlistSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable().optional().transform((value) => value ?? null),
  description: nullableString,
  public: z.boolean().nullable().optional().transform((value) => value ?? null),
  owner: z.object({ id: z.string().min(1) }),
});

const playlistItemSchema = z.object({
  item: z.object({ uri: z.string().min(1) }).nullable().optional().transform((value) => value ?? null),
});

const pageShape = {
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  next: z.string().nullable(),
};

export const savedTracksPageSchema = z.object({ items: z.array(savedItemSchema), ...pageShape });
export const playlistsPageSchema = z.object({ items: z.array(playlistSchema), ...pageShape });
export const playlistItemsPageSchema = z.object({ items: z.array(playlistItemSchema), ...pageShape });
export const createdPlaylistSchema = playlistSchema;
export const addPlaylistItemsResponseSchema = z.object({ snapshot_id: z.string().min(1) });

export type SpotifySavedItem = {
  addedAt: string | null;
  item: {
    type: string | null;
    id: string;
    uri: string;
    name: string | null;
    artists: Array<{ id: string | null; name: string | null }>;
    album: { id: string | null; name: string | null; releaseDate: string | null } | null;
    durationMs: number | null;
    explicit: boolean | null;
    isLocal: boolean | null;
  } | null;
};

export type SpotifyPlaylistSummary = {
  id: string;
  name: string | null;
  description: string | null;
  public: boolean | null;
  ownerId: string;
};

export type SpotifyPlaylistItem = { uri: string | null };

export interface SpotifyAccessTokenProvider {
  get(forceRefresh: boolean): Promise<string>;
}

export type SpotifyCreatePlaylistInput = { name: string; description: string };

export type SpotifyPage<T> = {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  next: string | null;
};

export function toSavedTrackPage(value: z.output<typeof savedTracksPageSchema>): SpotifyPage<SpotifySavedItem> {
  return {
    ...value,
    items: value.items.map((item) => ({
      addedAt: item.added_at,
      item: item.track === null ? null : {
        type: item.track.type,
        id: item.track.id,
        uri: item.track.uri,
        name: item.track.name,
        artists: item.track.artists,
        album: item.track.album === null ? null : { id: item.track.album.id, name: item.track.album.name, releaseDate: item.track.album.release_date },
        durationMs: item.track.duration_ms,
        explicit: item.track.explicit,
        isLocal: item.track.is_local,
      },
    })),
  };
}

export function toPlaylistPage(value: z.output<typeof playlistsPageSchema>): SpotifyPage<SpotifyPlaylistSummary> {
  return {
    ...value,
    items: value.items.map((item) => ({ id: item.id, name: item.name, description: item.description, public: item.public, ownerId: item.owner.id })),
  };
}

export function toPlaylistItemsPage(value: z.output<typeof playlistItemsPageSchema>): SpotifyPage<SpotifyPlaylistItem> {
  return { ...value, items: value.items.map((item) => ({ uri: item.item?.uri ?? null })) };
}

export function toPlaylistSummary(value: z.output<typeof createdPlaylistSchema>): SpotifyPlaylistSummary {
  return { id: value.id, name: value.name, description: value.description, public: value.public, ownerId: value.owner.id };
}
