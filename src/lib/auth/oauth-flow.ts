import "server-only";
import { AppError } from "@/lib/errors";
import { seal } from "@/lib/security/crypto";
import type { SpotifyProfile, SpotifyTokenResponse } from "@/lib/spotify/oauth";
import type { LinkedAccount, LinkedAccountRepository } from "./repository";

type SpotifyOAuthPort = {
  exchangeCode(code: string, verifier: string): Promise<SpotifyTokenResponse>;
  profile(accessToken: string): Promise<SpotifyProfile>;
};

export async function completeSpotifyLogin(input: {
  code: string;
  verifier: string;
  encryptionKey: string;
  repository: LinkedAccountRepository;
  spotify: SpotifyOAuthPort;
  now?: Date;
}): Promise<LinkedAccount> {
  const now = input.now ?? new Date();
  const tokens = await input.spotify.exchangeCode(input.code, input.verifier);
  if (!tokens.refreshToken) throw new AppError("SPOTIFY_UNAVAILABLE");

  const profile = await input.spotify.profile(tokens.accessToken);
  return input.repository.upsert({
    spotifyUserId: profile.id,
    displayName: profile.displayName,
    imageUrl: profile.imageUrl,
    encryptedAccessToken: seal(tokens.accessToken, input.encryptionKey),
    encryptedRefreshToken: seal(tokens.refreshToken, input.encryptionKey),
    scopes: tokens.scope,
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1_000),
  });
}
