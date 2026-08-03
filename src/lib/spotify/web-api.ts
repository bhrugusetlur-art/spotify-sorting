import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  addPlaylistItemsResponseSchema,
  createdPlaylistSchema,
  playlistItemsPageSchema,
  playlistsPageSchema,
  savedTracksPageSchema,
  toPlaylistItemsPage,
  toPlaylistPage,
  toPlaylistSummary,
  toSavedTrackPage,
  type SpotifyAccessTokenProvider,
  type SpotifyCreatePlaylistInput,
  type SpotifyPage,
  type SpotifyPlaylistItem,
  type SpotifyPlaylistSummary,
  type SpotifySavedItem,
} from "./web-api-types";

const apiBaseUrl = "https://api.spotify.com/v1";
const maxTransportAttempts = 4;
const maxRetryAfterMs = 10_000;
const resilienceWaits = [250, 1_000] as const;

type FetchLike = typeof fetch;

export type SpotifyWebApiOptions = {
  fetch?: FetchLike;
  tokens: SpotifyAccessTokenProvider;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  onAuthInvalid?: () => void | Promise<void>;
};

export class SpotifyWebApi {
  private readonly fetcher: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly options: SpotifyWebApiOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async savedTracks(): Promise<SpotifySavedItem[]> {
    return this.paginate((offset) => this.json(`/me/tracks?limit=50&offset=${offset}`, undefined, savedTracksPageSchema, toSavedTrackPage));
  }

  async currentUserPlaylists(): Promise<SpotifyPlaylistSummary[]> {
    return this.paginate((offset) => this.json(`/me/playlists?limit=50&offset=${offset}`, undefined, playlistsPageSchema, toPlaylistPage));
  }

  async playlistItems(id: string): Promise<SpotifyPlaylistItem[]> {
    this.requireId(id);
    return this.paginate((offset) => this.json(`/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}`, undefined, playlistItemsPageSchema, toPlaylistItemsPage));
  }

  async createPlaylist(input: SpotifyCreatePlaylistInput): Promise<SpotifyPlaylistSummary> {
    if (!input.name || !input.description) throw new AppError("SPOTIFY_RESPONSE_INVALID");
    return this.json("/me/playlists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: input.name, description: input.description, public: false }),
    }, createdPlaylistSchema, toPlaylistSummary);
  }

  async addPlaylistItems(id: string, uris: string[]): Promise<void> {
    this.requireId(id);
    if (uris.length === 0 || uris.length > 100 || uris.some((uri) => !uri)) throw new AppError("SPOTIFY_RESPONSE_INVALID");
    await this.json(`/playlists/${encodeURIComponent(id)}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uris }),
    }, addPlaylistItemsResponseSchema, () => undefined);
  }

  private requireId(id: string): void {
    if (!id) throw new AppError("SPOTIFY_RESPONSE_INVALID");
  }

  private async paginate<T>(fetchPage: (offset: number) => Promise<SpotifyPage<T>>): Promise<T[]> {
    const all: T[] = [];
    const seenOffsets = new Set<number>();
    let requestedOffset = 0;

    while (true) {
      const page = await fetchPage(requestedOffset);
      if (page.offset !== requestedOffset || seenOffsets.has(page.offset) || page.total < page.offset + page.items.length) {
        throw new AppError("SPOTIFY_RESPONSE_INVALID");
      }
      seenOffsets.add(page.offset);
      all.push(...page.items);

      const nextOffset = page.offset + page.items.length;
      if (page.items.length === 0) {
        if (nextOffset < page.total) throw new AppError("SPOTIFY_RESPONSE_INVALID");
        return all;
      }
      if (nextOffset >= page.total) return all;
      if (page.next === null) throw new AppError("SPOTIFY_RESPONSE_INVALID");
      if (page.items.length < page.limit || seenOffsets.has(nextOffset)) throw new AppError("SPOTIFY_RESPONSE_INVALID");
      requestedOffset = nextOffset;
    }
  }

  private async json<TSchema extends z.ZodType, TResult>(path: string, init: RequestInit | undefined, schema: TSchema, transform: (value: z.output<TSchema>) => TResult): Promise<TResult> {
    const response = await this.request(path, init);
    try {
      return transform(schema.parse(await response.json()));
    } catch {
      throw new AppError("SPOTIFY_RESPONSE_INVALID");
    }
  }

  private async request(path: string, init: RequestInit | undefined): Promise<Response> {
    let authReplayRemaining = 1;
    let resilienceRetriesRemaining = 2;
    let resilienceRetryNumber = 0;
    let attempts = 0;
    let forceRefresh = false;

    while (attempts < maxTransportAttempts) {
      attempts += 1;
      let response: Response;
      try {
        const token = await this.options.tokens.get(forceRefresh);
        response = await this.fetchWithTimeout(`${apiBaseUrl}${path}`, {
          ...init,
          headers: { ...init?.headers, authorization: `Bearer ${token}` },
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (resilienceRetriesRemaining > 0 && attempts < maxTransportAttempts) {
          resilienceRetriesRemaining -= 1;
          await this.sleep(resilienceWaits[resilienceRetryNumber]);
          resilienceRetryNumber += 1;
          continue;
        }
        throw new AppError("SPOTIFY_UNAVAILABLE");
      }

      if (response.ok) return response;

      if (response.status === 401) {
        if (authReplayRemaining > 0 && attempts < maxTransportAttempts) {
          authReplayRemaining -= 1;
          forceRefresh = true;
          continue;
        }
        await this.clearInvalidSession();
        throw new AppError("AUTH_REQUIRED");
      }

      if (response.status === 403) throw new AppError("SPOTIFY_PERMISSION_DENIED");

      if (response.status === 429) {
        const retryAfter = await this.retryAfterMs(response);
        if (retryAfter === null || resilienceRetriesRemaining === 0 || attempts >= maxTransportAttempts) throw new AppError("SPOTIFY_RATE_LIMITED");
        resilienceRetriesRemaining -= 1;
        resilienceRetryNumber += 1;
        await this.sleep(retryAfter);
        continue;
      }

      if (response.status === 500 || response.status === 502 || response.status === 503) {
        if (resilienceRetriesRemaining > 0 && attempts < maxTransportAttempts) {
          resilienceRetriesRemaining -= 1;
          await this.sleep(resilienceWaits[resilienceRetryNumber]);
          resilienceRetryNumber += 1;
          continue;
        }
      }

      throw new AppError("SPOTIFY_UNAVAILABLE");
    }

    throw new AppError("SPOTIFY_UNAVAILABLE");
  }

  private async retryAfterMs(response: Response): Promise<number | null> {
    if (await this.isQuotaExceeded(response)) return null;
    const value = response.headers.get("retry-after");
    if (value === null || !/^\d+$/.test(value)) return null;
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds)) return null;
    return Math.min(seconds * 1_000, maxRetryAfterMs);
  }

  private async isQuotaExceeded(response: Response): Promise<boolean> {
    try {
      const value = await response.clone().json();
      return z.object({ reason: z.literal("QUOTA_EXCEEDED") }).safeParse(value).success;
    } catch {
      return false;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async clearInvalidSession(): Promise<void> {
    try {
      await this.options.onAuthInvalid?.();
    } catch {
      // Session clearing is best-effort and must not expose implementation failures.
    }
  }
}
