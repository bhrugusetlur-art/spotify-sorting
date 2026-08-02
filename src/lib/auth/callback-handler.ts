import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { toErrorCode, type ErrorCode } from "@/lib/errors";
import { unseal } from "@/lib/security/crypto";
import { SpotifyOAuthClient } from "@/lib/spotify/oauth";
import { completeSpotifyLogin } from "./oauth-flow";
import { OAUTH_COOKIE, type OAuthCookie } from "./oauth-cookie";
import { createDrizzleAccountRepository, type LinkedAccountRepository } from "./repository";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "./session";

const SESSION_LIFETIME_MS = 604_800_000;

export type CallbackDependencies = {
  repository: LinkedAccountRepository;
  spotify: Pick<SpotifyOAuthClient, "exchangeCode" | "profile">;
  now: () => Date;
};

function errorRedirect(request: Request, code: ErrorCode = "AUTH_STATE_INVALID"): NextResponse {
  const url = new URL("/", request.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

export function createCallbackHandler(dependencies?: CallbackDependencies) {
  return async function callback(request: Request): Promise<NextResponse> {
    const env = getEnv();
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const cookieStore = await cookies();
    const encoded = cookieStore.get(OAUTH_COOKIE)?.value;
    if (!state || !encoded) return errorRedirect(request);

    let oauth: OAuthCookie;
    try {
      oauth = unseal<OAuthCookie>(encoded, env.TOKEN_ENCRYPTION_KEY);
    } catch {
      return errorRedirect(request);
    }

    // State is checked before consuming the cookie so a forged callback cannot
    // cancel a legitimate authorization attempt that is still in progress.
    const now = dependencies?.now() ?? new Date();
    if (oauth.state !== state || oauth.expiresAt <= now.getTime()) return errorRedirect(request);

    cookieStore.delete(OAUTH_COOKIE);

    const denied = url.searchParams.get("error");
    if (denied) {
      return errorRedirect(request, denied === "access_denied" ? "SPOTIFY_PERMISSION_DENIED" : "SPOTIFY_UNAVAILABLE");
    }

    const code = url.searchParams.get("code");
    if (!code) return errorRedirect(request);

    const spotify = dependencies?.spotify ?? new SpotifyOAuthClient({
      clientId: env.SPOTIFY_CLIENT_ID,
      redirectUri: env.SPOTIFY_REDIRECT_URI,
      fetch,
    });
    const repository = dependencies?.repository ?? createDrizzleAccountRepository();

    try {
      const account = await completeSpotifyLogin({
        code,
        verifier: oauth.verifier,
        encryptionKey: env.TOKEN_ENCRYPTION_KEY,
        repository,
        spotify,
        now,
      });
      cookieStore.set(
        SESSION_COOKIE,
        createSessionToken({ userId: account.userId, expiresAt: now.getTime() + SESSION_LIFETIME_MS }, env.SESSION_SECRET),
        sessionCookieOptions,
      );
      return NextResponse.redirect(new URL("/dashboard", request.url));
    } catch (error) {
      return errorRedirect(request, toErrorCode(error));
    }
  };
}
