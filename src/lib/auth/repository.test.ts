import { describe, expect, it } from "vitest";
import { createMemoryAccountRepository } from "./repository";

describe("linked account repository", () => {
  it("upserts and reads a linked Spotify account", async () => {
    const repository = createMemoryAccountRepository();
    const saved = await repository.upsert({ spotifyUserId: "spotify-1", displayName: "Ada", imageUrl: null, encryptedAccessToken: "a", encryptedRefreshToken: "r", scopes: "user-library-read", accessTokenExpiresAt: new Date(10_000) });
    await expect(repository.findByUserId(saved.userId)).resolves.toEqual(saved);
  });
});
