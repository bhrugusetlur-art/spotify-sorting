import { describe, expect, it } from "vitest";
import { createMemoryAccountRepository } from "./repository";
import { completeSpotifyLogin } from "./oauth-flow";

describe("completeSpotifyLogin", () => {
  it("encrypts tokens and persists the Spotify profile", async () => {
    const repository = createMemoryAccountRepository();
    const result = await completeSpotifyLogin({
      code: "code", verifier: "verifier", encryptionKey: Buffer.alloc(32, 2).toString("base64"), repository,
      spotify: {
        exchangeCode: async () => ({ accessToken: "access", refreshToken: "refresh", expiresIn: 3600, scope: "user-library-read" }),
        profile: async () => ({ id: "spotify-1", displayName: "Ada", imageUrl: null }),
      }, now: new Date(1_000),
    });
    expect(result.encryptedAccessToken).not.toContain("access");
    await expect(repository.findByUserId(result.userId)).resolves.toMatchObject({ spotifyUserId: "spotify-1" });
  });

  it("rejects exchanges that omit a refresh token", async () => {
    await expect(completeSpotifyLogin({ code: "code", verifier: "verifier", encryptionKey: Buffer.alloc(32, 2).toString("base64"), repository: createMemoryAccountRepository(), spotify: { exchangeCode: async () => ({ accessToken: "access", expiresIn: 3600, scope: "user-library-read" }), profile: async () => ({ id: "spotify-1", displayName: null, imageUrl: null }) } })).rejects.toMatchObject({ code: "SPOTIFY_UNAVAILABLE" });
  });
});
