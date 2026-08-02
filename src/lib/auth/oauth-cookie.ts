import "server-only";

export const OAUTH_COOKIE = "spotify_oauth";
export const OAUTH_COOKIE_MAX_AGE = 300;

export type OAuthCookie = {
  state: string;
  verifier: string;
  expiresAt: number;
};

export const oauthCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: OAUTH_COOKIE_MAX_AGE,
};
