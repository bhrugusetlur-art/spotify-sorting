import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";

const scopes = ["user-library-read", "playlist-read-private", "playlist-modify-private", "playlist-modify-public"] as const;
const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number(), scope: z.string().optional().default(""), token_type: z.literal("Bearer") });
const profileSchema = z.object({ account_id: z.string(), id: z.string(), display_name: z.string().nullable(), images: z.array(z.object({ url: z.string().url() })).default([]) });

export type SpotifyTokenResponse = { accessToken: string; refreshToken?: string; expiresIn: number; scope: string };
export type SpotifyProfile = { accountId: string; id: string; displayName: string | null; imageUrl: string | null };

function spotifyFailure(response: Response): AppError {
  return new AppError(response.status === 429 ? "SPOTIFY_RATE_LIMITED" : "SPOTIFY_UNAVAILABLE");
}

async function spotifyJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw spotifyFailure(response);
  try {
    return schema.parse(await response.json());
  } catch {
    throw new AppError("SPOTIFY_RESPONSE_INVALID");
  }
}

export class SpotifyOAuthClient {
  constructor(private readonly config: { clientId: string; redirectUri: string; fetch: typeof fetch; timeoutMs?: number }) {}

  private async request(input: Parameters<typeof fetch>): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
    try {
      const [url, init] = input;
      return await this.config.fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new AppError("SPOTIFY_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }

  authorizationUrl(input: { state: string; challenge: string }): string {
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: this.config.clientId, redirect_uri: this.config.redirectUri, state: input.state, scope: scopes.join(" "), code_challenge_method: "S256", code_challenge: input.challenge }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, verifier: string): Promise<SpotifyTokenResponse> {
    const body = new URLSearchParams({ client_id: this.config.clientId, grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri, code_verifier: verifier });
    const response = await this.request(["https://accounts.spotify.com/api/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }]);
    const value = await spotifyJson(response, tokenSchema);
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresIn: value.expires_in, scope: value.scope };
  }

  async refreshToken(refreshToken: string): Promise<SpotifyTokenResponse> {
    const body = new URLSearchParams({ client_id: this.config.clientId, grant_type: "refresh_token", refresh_token: refreshToken });
    const response = await this.request(["https://accounts.spotify.com/api/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }]);
    const value = await spotifyJson(response, tokenSchema);
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresIn: value.expires_in, scope: value.scope };
  }

  async profile(accessToken: string): Promise<SpotifyProfile> {
    const response = await this.request(["https://api.spotify.com/v1/me", { headers: { authorization: `Bearer ${accessToken}` } }]);
    const value = await spotifyJson(response, profileSchema);
    return { accountId: value.account_id, id: value.id, displayName: value.display_name, imageUrl: value.images[0]?.url ?? null };
  }
}
