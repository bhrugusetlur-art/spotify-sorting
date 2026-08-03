import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { LinkedAccount } from "@/lib/auth/repository";
import type { SyncResult } from "./result";
import { createSyncHandlers } from "./handlers";

const account: LinkedAccount = {
  userId: "user-1",
  spotifyAccountId: "account-1",
  spotifyUserId: "spotify-user-1",
  displayName: "Ada",
  imageUrl: null,
  encryptedAccessToken: "secret-access-token",
  encryptedRefreshToken: "secret-refresh-token",
  scopes: "scope",
  accessTokenExpiresAt: new Date("2026-08-03T13:00:00.000Z"),
};

const success: SyncResult = {
  run: {
    id: "run-1",
    userId: account.userId,
    status: "succeeded",
    counts: { total: 1, classified: 1, added: 1, skipped: 0, failed: 0 },
    failure: null,
    startedAt: new Date("2026-08-03T12:00:00.000Z"),
    completedAt: new Date("2026-08-03T12:00:02.000Z"),
  },
  playlists: [{ mood: "chill", name: "Mood Sorter — Chill", spotifyPlaylistId: "playlist-1", url: "https://open.spotify.com/playlist/playlist-1" }],
};

describe("sync HTTP handlers", () => {
  it("returns a safe 401 for an anonymous POST request", async () => {
    const clearSession = vi.fn();
    const handlers = createSyncHandlers({
      currentAccount: async () => null,
      syncLibrary: vi.fn(),
      latestResult: vi.fn(),
      clearSession,
    });

    const response = await handlers.post();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED", message: "Please reconnect your Spotify account and try again." } });
    expect(clearSession).toHaveBeenCalledOnce();
  });

  it("does not mistake an account-resolution outage for an anonymous request", async () => {
    const handlers = createSyncHandlers({
      currentAccount: async () => { throw new Error("database password=secret"); },
      syncLibrary: vi.fn(),
      latestResult: vi.fn(),
      clearSession: vi.fn(),
    });

    const response = await handlers.post();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "We could not sort your music. Please try again." } });
  });

  it("returns a safe 200 result without account or token fields", async () => {
    const syncLibrary = vi.fn().mockResolvedValue(success);
    const handlers = createHandlers({ syncLibrary });

    const response = await handlers.post();

    expect(response.status).toBe(200);
    expect(syncLibrary).toHaveBeenCalledWith({ userId: account.userId, spotifyUserId: account.spotifyUserId });
    expect(await response.json()).toEqual({
      run: {
        id: "run-1",
        status: "succeeded",
        counts: { total: 1, classified: 1, added: 1, skipped: 0, failed: 0 },
        failure: null,
        startedAt: "2026-08-03T12:00:00.000Z",
        completedAt: "2026-08-03T12:00:02.000Z",
      },
      playlists: success.playlists,
    });
  });

  it("maps a fresh concurrent run to a safe 409", async () => {
    const handlers = createHandlers({ syncLibrary: async () => { throw new AppError("SYNC_ALREADY_RUNNING"); } });

    const response = await handlers.post();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "SYNC_ALREADY_RUNNING", message: "A sorting run is already in progress." } });
  });

  it("maps a persisted rate-limit failure to 429", async () => {
    const handlers = createHandlers({ syncLibrary: async () => failed("SPOTIFY_RATE_LIMITED") });

    const response = await handlers.post();

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "SPOTIFY_RATE_LIMITED", message: "Spotify is rate limiting requests. Please try again shortly." },
      run: { id: "run-1", status: "failed" },
      playlists: success.playlists,
    });
  });

  it("maps a terminal Spotify failure to 502 with the persisted partial result", async () => {
    const handlers = createHandlers({ syncLibrary: async () => failed("SPOTIFY_UNAVAILABLE") });

    const response = await handlers.post();

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify could not complete the sorting request. Please try again." },
      run: { id: "run-1", status: "failed", counts: success.run.counts },
      playlists: success.playlists,
    });
  });

  it("reconstructs a safe persisted POST failure instead of forwarding its stored message", async () => {
    const result = failed("SPOTIFY_UNAVAILABLE", "refresh_token=secret");
    const handlers = createHandlers({ syncLibrary: async () => result });

    const response = await handlers.post();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify could not complete the sorting request. Please try again." },
      run: { failure: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify could not complete the sorting request. Please try again." } },
    });
    expect(JSON.stringify(body)).not.toContain("refresh_token=secret");
  });

  it("never exposes an unexpected exception message", async () => {
    const handlers = createHandlers({ syncLibrary: async () => { throw new Error("access_token=secret"); } });

    const response = await handlers.post();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "We could not sort your music. Please try again." } });
  });

  it("clears the session when a sync reports an authentication failure", async () => {
    const clearSession = vi.fn();
    const handlers = createHandlers({ syncLibrary: async () => failed("AUTH_REQUIRED"), clearSession });

    const response = await handlers.post();

    expect(response.status).toBe(401);
    expect(clearSession).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" }, run: { id: "run-1" } });
  });

  it("returns the empty latest shape when this account has no runs", async () => {
    const latestResult = vi.fn().mockResolvedValue(null);
    const handlers = createHandlers({ latestResult });

    const response = await handlers.latest();

    expect(response.status).toBe(200);
    expect(latestResult).toHaveBeenCalledWith(account.userId);
    expect(await response.json()).toEqual({ run: null, playlists: [] });
  });

  it("reconstructs an internal failure for an unknown persisted latest-result code", async () => {
    const result = failed("SPOTIFY_UNAVAILABLE", "access_token=secret") as unknown as SyncResult;
    result.run.failure = { code: "UNKNOWN_STORED_CODE", message: "access_token=secret" } as never;
    const handlers = createHandlers({ latestResult: async () => result });

    const response = await handlers.latest();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      run: { failure: { code: "INTERNAL_ERROR", message: "We could not sort your music. Please try again." } },
    });
    expect(JSON.stringify(body)).not.toContain("access_token=secret");
  });

  it("returns a safe 401 and clears the session for an anonymous latest request", async () => {
    const clearSession = vi.fn();
    const handlers = createSyncHandlers({
      currentAccount: async () => null,
      syncLibrary: vi.fn(),
      latestResult: vi.fn(),
      clearSession,
    });

    const response = await handlers.latest();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED", message: "Please reconnect your Spotify account and try again." } });
    expect(clearSession).toHaveBeenCalledOnce();
  });
});

function createHandlers(overrides: Partial<Parameters<typeof createSyncHandlers>[0]> = {}) {
  return createSyncHandlers({
    currentAccount: async () => account,
    syncLibrary: async () => success,
    latestResult: async () => success,
    clearSession: async () => undefined,
    ...overrides,
  });
}

function failed(
  code: "AUTH_REQUIRED" | "SPOTIFY_RATE_LIMITED" | "SPOTIFY_UNAVAILABLE",
  message = code === "AUTH_REQUIRED"
    ? "Please reconnect your Spotify account and try again."
    : code === "SPOTIFY_RATE_LIMITED"
      ? "Spotify is rate limiting requests. Please try again shortly."
      : "Spotify could not complete the sorting request. Please try again.",
): SyncResult {
  return {
    ...success,
    run: {
      ...success.run,
      status: "failed",
      failure: {
        code,
        message,
      },
    },
  };
}
