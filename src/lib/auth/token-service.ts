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
  timeoutMs?: number;
}): Promise<string> {
  const now = input.now ?? new Date();
  const account = await input.repository.findByUserId(input.userId);
  if (!account) throw new AppError("AUTH_REQUIRED");

  if (!input.forceRefresh && account.accessTokenExpiresAt.getTime() > now.getTime() + 60_000) {
    return unseal<string>(account.encryptedAccessToken, input.encryptionKey);
  }

  const oldRefreshToken = unseal<string>(account.encryptedRefreshToken, input.encryptionKey);
  let tokens: SpotifyTokenResponse;
  try {
    tokens = await refreshWithinTimeout(() => input.spotify.refreshToken(oldRefreshToken), input.timeoutMs ?? 10_000);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("SPOTIFY_UNAVAILABLE");
  }
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

function refreshWithinTimeout<T>(refresh: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new AppError("SPOTIFY_UNAVAILABLE"));
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new AppError("SPOTIFY_UNAVAILABLE")), timeoutMs);
    void refresh().then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
