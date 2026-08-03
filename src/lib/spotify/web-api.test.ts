import { describe, expect, it, vi } from "vitest";
import { SpotifyWebApi } from "./web-api";

const base = "https://api.spotify.com/v1";

function track(uri = "spotify:track:track-1") {
  return {
    type: "track",
    id: uri.slice("spotify:track:".length),
    uri,
    name: "Track",
    artists: [{ id: "artist-1", name: "Artist" }],
    album: { id: "album-1", name: "Album", release_date: "2024-01-01" },
    duration_ms: 180_000,
    explicit: false,
    is_local: false,
  };
}

function savedPage(input: { items?: unknown[]; offset?: number; total?: number; next?: string | null } = {}) {
  const items = input.items ?? [];
  return {
    href: `${base}/me/tracks`,
    items,
    limit: 50,
    offset: input.offset ?? 0,
    total: input.total ?? items.length,
    next: input.next ?? null,
  };
}

function playlistPage(input: { items?: unknown[]; offset?: number; total?: number; next?: string | null } = {}) {
  const items = input.items ?? [];
  return {
    href: `${base}/me/playlists`,
    items,
    limit: 50,
    offset: input.offset ?? 0,
    total: input.total ?? items.length,
    next: input.next ?? null,
  };
}

function playlistItemsPage(input: {
  items?: unknown[];
  limit?: number;
  offset?: number;
  total?: number;
  next?: string | null;
} = {}) {
  const items = input.items ?? [];
  return {
    href: `${base}/playlists/playlist-1/items`,
    items,
    limit: input.limit ?? 50,
    offset: input.offset ?? 0,
    total: input.total ?? items.length,
    next: input.next ?? null,
  };
}

function playlist(id = "playlist-1") {
  return { id, name: "Playlist", description: null, public: false, owner: { id: "owner-1" }, external_urls: { spotify: `https://open.spotify.com/playlist/${id}` } };
}

function response(value: unknown, init: ResponseInit = {}) {
  return new Response(value === undefined ? null : JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function client(responses: Array<Response | Error | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)>, timeoutMs = 5_000) {
  const waits: number[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(input, init);
    if (!next) throw new Error("unexpected transport attempt");
    return next;
  });
  const tokenGetter = vi.fn(async () => "token");
  const clearSession = vi.fn();
  return {
    api: new SpotifyWebApi({ fetch: fetcher as unknown as typeof fetch, tokens: { get: tokenGetter }, sleep: async (ms) => { waits.push(ms); }, timeoutMs, onAuthInvalid: clearSession }),
    fetcher,
    tokenGetter,
    clearSession,
    waits,
  };
}

describe("SpotifyWebApi request policy", () => {
  it("returns an ordinary successful response", async () => {
    const { api, fetcher, tokenGetter } = client([response(playlistPage())]);

    await expect(api.currentUserPlaylists()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(tokenGetter).toHaveBeenCalledWith(false);
  });

  it("forces one token refresh and replays a first 401", async () => {
    const { api, tokenGetter, fetcher } = client([response({}, { status: 401 }), response(playlistPage())]);

    await expect(api.currentUserPlaylists()).resolves.toEqual([]);
    expect(tokenGetter.mock.calls).toEqual([[false], [true]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("clears the session and fails safely after a second 401", async () => {
    const { api, clearSession, fetcher } = client([response({}, { status: 401 }), response({}, { status: 401 })]);

    await expect(api.currentUserPlaylists()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(clearSession).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails quota-exceeded responses without waiting or replaying", async () => {
    const { api, waits, fetcher } = client([response({ reason: "QUOTA_EXCEEDED" }, { status: 429 })]);

    await expect(api.currentUserPlaylists()).rejects.toMatchObject({ code: "SPOTIFY_RATE_LIMITED" });
    expect(waits).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("uses a capped valid Retry-After value for a rate-limit retry", async () => {
    const { api, waits } = client([response({}, { status: 429, headers: { "retry-after": "20" } }), response(playlistPage())]);

    await expect(api.currentUserPlaylists()).resolves.toEqual([]);
    expect(waits).toEqual([10_000]);
  });

  it("rejects missing or invalid Retry-After values without retrying", async () => {
    for (const retryAfter of [null, "-1", "1.5", "soon"]) {
      const headers: Record<string, string> = retryAfter === null ? {} : { "retry-after": retryAfter };
      const { api, waits, fetcher } = client([response({}, { status: 429, headers })]);
      await expect(api.currentUserPlaylists()).rejects.toMatchObject({ code: "SPOTIFY_RATE_LIMITED" });
      expect(waits).toEqual([]);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it("shares retry budgets across 401, 429, and 500 with four transport attempts maximum", async () => {
    const { api, waits, fetcher, tokenGetter } = client([
      response({}, { status: 401 }),
      response({}, { status: 429, headers: { "retry-after": "1" } }),
      response({}, { status: 500 }),
      response(playlistPage()),
    ]);

    await expect(api.currentUserPlaylists()).resolves.toEqual([]);
    expect(tokenGetter.mock.calls).toEqual([[false], [true], [false], [false]]);
    expect(waits).toEqual([1_000, 1_000]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("retries network failures with the fixed shared backoff", async () => {
    const { api, waits, fetcher } = client([new TypeError("network down"), response({}, { status: 500 }), response(playlistPage())]);

    await expect(api.currentUserPlaylists()).resolves.toEqual([]);
    expect(waits).toEqual([250, 1_000]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retries timeout failures with the fixed shared backoff", async () => {
    const abortingFetch = (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError"))));
    const { api, waits } = client([abortingFetch, response(playlistPage())], 1);

    await expect(api.currentUserPlaylists()).resolves.toEqual([]);
    expect(waits).toEqual([250]);
  });

  it.each([500, 502, 503])("retries Spotify %i responses", async (status) => {
    const { api, waits } = client([response({}, { status }), response(playlistPage())]);

    await expect(api.currentUserPlaylists()).resolves.toEqual([]);
    expect(waits).toEqual([250]);
  });

  it("maps a 403 to the safe permission error", async () => {
    const { api } = client([response({}, { status: 403 })]);

    await expect(api.currentUserPlaylists()).rejects.toMatchObject({ code: "SPOTIFY_PERMISSION_DENIED" });
  });

  it("maps malformed success JSON to the response-invalid error", async () => {
    const { api } = client([new Response("not json", { status: 200, headers: { "content-type": "application/json" } })]);

    await expect(api.currentUserPlaylists()).rejects.toMatchObject({ code: "SPOTIFY_RESPONSE_INVALID" });
  });

  it.each([
    ["creation", (api: SpotifyWebApi) => api.createPlaylist({ name: "Mood Sorter — Chill", description: "Managed by Mood Sorter. Mood: chill." })],
    ["item addition", (api: SpotifyWebApi) => api.addPlaylistItems("playlist-1", ["spotify:track:one"])],
  ])("does not replay a POST %s after an ambiguous network failure", async (_label, operation) => {
    const { api, fetcher, waits } = client([new TypeError("connection dropped")]);

    await expect(operation(api)).rejects.toMatchObject({ code: "SPOTIFY_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(waits).toEqual([]);
  });

  it.each([
    ["creation", (api: SpotifyWebApi) => api.createPlaylist({ name: "Mood Sorter — Chill", description: "Managed by Mood Sorter. Mood: chill." })],
    ["item addition", (api: SpotifyWebApi) => api.addPlaylistItems("playlist-1", ["spotify:track:one"])],
  ])("does not replay a POST %s after an ambiguous server failure", async (_label, operation) => {
    const { api, fetcher, waits } = client([response({}, { status: 500 })]);

    await expect(operation(api)).rejects.toMatchObject({ code: "SPOTIFY_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(waits).toEqual([]);
  });
});

describe("SpotifyWebApi pagination and mutations", () => {
  it("fetches saved-track pages by validated offsets instead of response URLs", async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({ added_at: "2024-01-01T00:00:00Z", track: track(`spotify:track:saved-${index}`) }));
    const second = [{ added_at: "2024-01-02T00:00:00Z", track: track("spotify:track:saved-final") }];
    const { api, fetcher } = client([
      response(savedPage({ items: first, offset: 0, total: 51, next: "https://attacker.invalid/page" })),
      response(savedPage({ items: second, offset: 50, total: 51 })),
    ]);

    await expect(api.savedTracks()).resolves.toHaveLength(51);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([`${base}/me/tracks?limit=50&offset=0`, `${base}/me/tracks?limit=50&offset=50`]);
  });

  it.each(["id", "uri"] as const)("keeps a malformed individual saved track as an unsupported item when its %s is missing", async (field) => {
    const malformedTrack = { ...track(), [field]: undefined };
    const { api } = client([response(savedPage({ items: [{ added_at: "2024-01-01T00:00:00Z", track: malformedTrack }] }))]);

    await expect(api.savedTracks()).resolves.toEqual([{ addedAt: "2024-01-01T00:00:00Z", item: null }]);
  });

  it("keeps a present saved track with an empty id as unsupported", async () => {
    const { api } = client([response(savedPage({ items: [{
      added_at: "2024-01-01T00:00:00Z",
      track: {
        type: "track",
        id: "",
        uri: "spotify:track:track-1",
        name: "Track",
        artists: [{ id: "artist-1", name: "Artist" }],
        album: { id: "album-1", name: "Album", release_date: "2024-01-01" },
        duration_ms: 180_000,
        explicit: false,
        is_local: false,
      },
    }] }))]);

    await expect(api.savedTracks()).resolves.toEqual([{ addedAt: "2024-01-01T00:00:00Z", item: null }]);
  });

  it("keeps a present saved track with an empty uri as unsupported", async () => {
    const { api } = client([response(savedPage({ items: [{
      added_at: "2024-01-01T00:00:00Z",
      track: {
        type: "track",
        id: "track-1",
        uri: "",
        name: "Track",
        artists: [{ id: "artist-1", name: "Artist" }],
        album: { id: "album-1", name: "Album", release_date: "2024-01-01" },
        duration_ms: 180_000,
        explicit: false,
        is_local: false,
      },
    }] }))]);

    await expect(api.savedTracks()).resolves.toEqual([{ addedAt: "2024-01-01T00:00:00Z", item: null }]);
  });

  it("keeps mixed valid, null, and malformed saved items while validating the page envelope", async () => {
    const { api } = client([response(savedPage({ items: [
      { added_at: "2024-01-01T00:00:00Z", track: track("spotify:track:valid") },
      { added_at: "2024-01-02T00:00:00Z", track: null },
      { added_at: "2024-01-03T00:00:00Z", track: { type: "track", id: 12 } },
    ] }))]);

    await expect(api.savedTracks()).resolves.toMatchObject([
      { item: { id: "valid", uri: "spotify:track:valid" } },
      { item: null },
      { item: null },
    ]);
  });

  it("fetches 50-item current-user playlist pages through the short final page", async () => {
    const first = Array.from({ length: 50 }, (_, index) => playlist(`playlist-${index}`));
    const { api } = client([response(playlistPage({ items: first, offset: 0, total: 51, next: "https://api.spotify.com/v1/me/playlists?offset=50" })), response(playlistPage({ items: [playlist("playlist-final")], offset: 50, total: 51 }))]);

    await expect(api.currentUserPlaylists()).resolves.toHaveLength(51);
  });

  it("accepts next:null as a terminal page even when the reported total is larger", async () => {
    const full = Array.from({ length: 50 }, (_, index) => playlist(`playlist-${index}`));
    const { api } = client([response(playlistPage({ items: full, offset: 0, total: 100, next: null }))]);

    await expect(api.currentUserPlaylists()).resolves.toHaveLength(50);
  });

  it("accepts a short page as terminal even when the reported total is larger", async () => {
    const { api, fetcher } = client([response(playlistPage({ items: [playlist("playlist-1")], total: 100, next: "https://api.spotify.com/v1/me/playlists?offset=1" }))]);

    await expect(api.currentUserPlaylists()).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("fetches playlist-item pages through the short final page", async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({ item: { type: "track", uri: `spotify:track:item-${index}` } }));
    const { api } = client([response(playlistItemsPage({ items: first, offset: 0, total: 51, next: "https://api.spotify.com/v1/playlists/playlist-1/items?offset=50" })), response(playlistItemsPage({ items: [{ item: { type: "track", uri: "spotify:track:item-final" } }], offset: 50, total: 51 }))]);

    await expect(api.playlistItems("playlist-1")).resolves.toEqual(Array.from({ length: 51 }, (_, index) => ({ uri: index === 50 ? "spotify:track:item-final" : `spotify:track:item-${index}` })));
  });

  it("accepts a zero-limit terminal empty page while rejecting out-of-range limits", async () => {
    const terminal = client([response(playlistItemsPage({ limit: 0 }))]);
    await expect(terminal.api.playlistItems("playlist-1")).resolves.toEqual([]);
    expect(terminal.fetcher).toHaveBeenCalledOnce();

    for (const limit of [-1, 51]) {
      const invalid = client([response(playlistItemsPage({ limit }))]);
      await expect(invalid.api.playlistItems("playlist-1")).rejects.toMatchObject({ code: "SPOTIFY_RESPONSE_INVALID" });
    }
  });

  it("rejects negative totals, repeated offsets, and no-progress pages", async () => {
    const full = Array.from({ length: 50 }, (_, index) => playlist(`playlist-${index}`));
    const negative = client([response(playlistPage({ total: -1 }))]);
    await expect(negative.api.currentUserPlaylists()).rejects.toMatchObject({ code: "SPOTIFY_RESPONSE_INVALID" });

    const repeated = client([response(playlistPage({ items: full, offset: 0, total: 100, next: "https://api.spotify.com/v1/me/playlists?offset=50" })), response(playlistPage({ items: full, offset: 0, total: 100 }))]);
    await expect(repeated.api.currentUserPlaylists()).rejects.toMatchObject({ code: "SPOTIFY_RESPONSE_INVALID" });

    const oversized = client([response(playlistPage({ items: [...full, playlist("playlist-overflow")], offset: 0, total: 100, next: "https://api.spotify.com/v1/me/playlists?offset=50" }))]);
    await expect(oversized.api.currentUserPlaylists()).rejects.toMatchObject({ code: "SPOTIFY_RESPONSE_INVALID" });
  });

  it("creates a private playlist with the documented endpoint and safe result", async () => {
    const { api, fetcher } = client([response(playlist("created"))]);

    await expect(api.createPlaylist({ name: "Mood Sorter — Chill", description: "Managed by Mood Sorter. Mood: chill." })).resolves.toEqual({ id: "created", name: "Playlist", description: null, public: false, ownerId: "owner-1" });
    expect(fetcher).toHaveBeenCalledWith(`${base}/me/playlists`, expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Mood Sorter — Chill", description: "Managed by Mood Sorter. Mood: chill.", public: false }) }));
  });

  it("adds at most 100 URIs in the documented request body", async () => {
    const { api, fetcher } = client([response({ snapshot_id: "snapshot" })]);

    await expect(api.addPlaylistItems("playlist-1", ["spotify:track:one", "spotify:track:two"])).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(`${base}/playlists/playlist-1/items`, expect.objectContaining({ method: "POST", body: JSON.stringify({ uris: ["spotify:track:one", "spotify:track:two"] }) }));
    await expect(api.addPlaylistItems("playlist-1", Array.from({ length: 101 }, (_, index) => `spotify:track:${index}`))).rejects.toMatchObject({ code: "SPOTIFY_RESPONSE_INVALID" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
