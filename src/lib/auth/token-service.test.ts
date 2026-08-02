import { describe, expect, it, vi } from "vitest";
import { seal, unseal } from "@/lib/security/crypto";
import { createMemoryAccountRepository } from "./repository";
import { getValidSpotifyAccessToken } from "./token-service";

const key = Buffer.alloc(32, 4).toString("base64");

describe("getValidSpotifyAccessToken", () => {
  it("refreshes an expired access token and persists the encrypted replacement", async () => {
    const repository = createMemoryAccountRepository();
    const account = await repository.upsert({ spotifyUserId: "spotify-1", displayName: "Ada", imageUrl: null, encryptedAccessToken: seal("old", key), encryptedRefreshToken: seal("refresh", key), scopes: "user-library-read", accessTokenExpiresAt: new Date(1_000) });
    const accessToken = await getValidSpotifyAccessToken({ userId: account.userId, repository, encryptionKey: key, now: new Date(5_000), spotify: { refreshToken: async () => ({ accessToken: "new", expiresIn: 3600, scope: "user-library-read" }) } });
    expect(accessToken).toBe("new");
    const stored = await repository.findByUserId(account.userId);
    expect(unseal<string>(stored!.encryptedAccessToken, key)).toBe("new");
    expect(stored!.encryptedAccessToken).not.toContain("new");
    expect(stored!.accessTokenExpiresAt).toEqual(new Date(5_000 + 3_600_000));
  });

  it("keeps the existing refresh token when Spotify omits a replacement", async () => {
    const repository = createMemoryAccountRepository();
    const account = await repository.upsert({ spotifyUserId: "spotify-1", displayName: "Ada", imageUrl: null, encryptedAccessToken: seal("old", key), encryptedRefreshToken: seal("refresh", key), scopes: "user-library-read", accessTokenExpiresAt: new Date(1_000) });
    await getValidSpotifyAccessToken({ userId: account.userId, repository, encryptionKey: key, now: new Date(5_000), spotify: { refreshToken: async () => ({ accessToken: "new", expiresIn: 3600, scope: "user-library-read" }) } });
    const stored = await repository.findByUserId(account.userId);
    expect(unseal<string>(stored!.encryptedRefreshToken, key)).toBe("refresh");
  });

  it("returns the cached token without calling Spotify when it is still valid", async () => {
    const repository = createMemoryAccountRepository();
    const account = await repository.upsert({ spotifyUserId: "spotify-1", displayName: "Ada", imageUrl: null, encryptedAccessToken: seal("current", key), encryptedRefreshToken: seal("refresh", key), scopes: "user-library-read", accessTokenExpiresAt: new Date(600_000) });
    const refreshToken = vi.fn();
    await expect(getValidSpotifyAccessToken({ userId: account.userId, repository, encryptionKey: key, now: new Date(5_000), spotify: { refreshToken } })).resolves.toBe("current");
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it("raises the safe AUTH_REQUIRED code for an unknown user", async () => {
    await expect(getValidSpotifyAccessToken({ userId: "missing", repository: createMemoryAccountRepository(), encryptionKey: key, spotify: { refreshToken: vi.fn() } })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
