import "server-only";
import { AppError } from "@/lib/errors";
import { seal, unseal } from "@/lib/security/crypto";
import type { SpotifyTokenResponse } from "@/lib/spotify/oauth";
import type { LinkedAccountRepository } from "./repository";

export async function getValidSpotifyAccessToken(input: {
  userId: string;
  repository: LinkedAccountRepository;
  encryptionKey: string;
  spotify: { refreshToken(token: string): Promise<SpotifyTokenResponse> };
  now?: Date;
  forceRefresh?: boolean;
}): Promise<string> {
  const now = input.now ?? new Date();
  const account = await input.repository.findByUserId(input.userId);
  if (!account) throw new AppError("AUTH_REQUIRED");

  if (!input.forceRefresh && account.accessTokenExpiresAt.getTime() > now.getTime() + 60_000) {
    return unseal<string>(account.encryptedAccessToken, input.encryptionKey);
  }

  const oldRefreshToken = unseal<string>(account.encryptedRefreshToken, input.encryptionKey);
  const tokens = await input.spotify.refreshToken(oldRefreshToken);
  await input.repository.upsert({
    spotifyAccountId: account.spotifyAccountId,
    spotifyUserId: account.spotifyUserId,
    displayName: account.displayName,
    imageUrl: account.imageUrl,
    encryptedAccessToken: seal(tokens.accessToken, input.encryptionKey),
    encryptedRefreshToken: seal(tokens.refreshToken ?? oldRefreshToken, input.encryptionKey),
    scopes: tokens.scope || account.scopes,
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1_000),
  });
  return tokens.accessToken;
}
