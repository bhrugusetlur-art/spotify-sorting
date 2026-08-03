import { describe, expect, it } from "vitest";
import { createMemoryAccountRepository } from "./repository";

const linkedInput = (input: { spotifyAccountId: string | null; spotifyUserId: string }) => ({
  ...input,
  displayName: "Ada",
  imageUrl: null,
  encryptedAccessToken: "a",
  encryptedRefreshToken: "r",
  scopes: "user-library-read",
  accessTokenExpiresAt: new Date(10_000),
});

describe("linked account repository", () => {
  it("upserts and reads a linked Spotify account", async () => {
    const repository = createMemoryAccountRepository();
    const saved = await repository.upsert(linkedInput({ spotifyAccountId: "account-1", spotifyUserId: "spotify-1" }));
    await expect(repository.findByUserId(saved.userId)).resolves.toEqual(saved);
  });

  it("reconciles a legacy public-user row to the stable account identity", async () => {
    const repository = createMemoryAccountRepository();
    const legacy = await repository.upsert(linkedInput({ spotifyAccountId: null, spotifyUserId: "legacy" }));
    const reconciled = await repository.upsert(linkedInput({
      spotifyAccountId: "account-stable",
      spotifyUserId: "legacy",
    }));

    expect(reconciled.userId).toBe(legacy.userId);
    expect(reconciled.spotifyAccountId).toBe("account-stable");
  });

  it("keeps a stable account linked when its public user ID changes", async () => {
    const repository = createMemoryAccountRepository();
    const original = await repository.upsert(linkedInput({ spotifyAccountId: "account-stable", spotifyUserId: "old-public-id" }));
    const relinked = await repository.upsert(linkedInput({ spotifyAccountId: "account-stable", spotifyUserId: "new-public-id" }));

    expect(relinked.userId).toBe(original.userId);
    expect(relinked.spotifyUserId).toBe("new-public-id");
  });
});
