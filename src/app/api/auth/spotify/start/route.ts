import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE, oauthCookieOptions } from "@/lib/auth/oauth-cookie";
import { createOAuthState, createPkce } from "@/lib/auth/pkce";
import { getEnv } from "@/lib/config/env";
import { seal } from "@/lib/security/crypto";
import { SpotifyOAuthClient } from "@/lib/spotify/oauth";

export async function GET() {
  const env = getEnv();
  const state = createOAuthState();
  const { verifier, challenge } = createPkce();
  const expiresAt = Date.now() + OAUTH_COOKIE_MAX_AGE * 1_000;
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_COOKIE, seal({ state, verifier, expiresAt }, env.TOKEN_ENCRYPTION_KEY), oauthCookieOptions);

  const spotify = new SpotifyOAuthClient({
    clientId: env.SPOTIFY_CLIENT_ID,
    redirectUri: env.SPOTIFY_REDIRECT_URI,
    fetch,
  });
  return NextResponse.redirect(spotify.authorizationUrl({ state, challenge }));
}
