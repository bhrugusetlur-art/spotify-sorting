import { describe, expect, it, vi } from "vitest";
import { SpotifyOAuthClient } from "./oauth";

describe("SpotifyOAuthClient", () => {
  it("builds an authorization URL with exact scopes and PKCE", () => {
    const client = new SpotifyOAuthClient({ clientId: "client", redirectUri: "http://127.0.0.1/callback", fetch });
    const url = new URL(client.authorizationUrl({ state: "state", challenge: "challenge" }));
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "user-library-read", "playlist-read-private", "playlist-modify-private", "playlist-modify-public",
    ]);
  });

  it("exchanges a code using the verifier", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "user-library-read", token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new SpotifyOAuthClient({ clientId: "client", redirectUri: "http://127.0.0.1/callback", fetch: fetcher });
    await expect(client.exchangeCode("code", "verifier")).resolves.toMatchObject({ accessToken: "access", refreshToken: "refresh" });
    expect(fetcher).toHaveBeenCalledOnce();
    const body = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code");
    expect(body.get("code_verifier")).toBe("verifier");
  });

  it("refreshes an expired token with the refresh-token grant", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "new-access", expires_in: 3600, scope: "user-library-read", token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new SpotifyOAuthClient({ clientId: "client", redirectUri: "http://127.0.0.1/callback", fetch: fetcher });
    await expect(client.refreshToken("refresh")).resolves.toMatchObject({ accessToken: "new-access" });
    const body = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
  });

  it("maps Spotify's stable account identity from a profile", async () => {
    const client = new SpotifyOAuthClient({
      clientId: "client",
      redirectUri: "http://127.0.0.1/callback",
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        account_id: "account-stable",
        id: "public-user",
        display_name: "Ada",
        images: [],
      }), { status: 200, headers: { "content-type": "application/json" } })),
    });

    expect(await client.profile("access")).toEqual({
      accountId: "account-stable",
      id: "public-user",
      displayName: "Ada",
      imageUrl: null,
    });
  });

  it("maps Spotify rate limits to a safe application error", async () => {
    const client = new SpotifyOAuthClient({ clientId: "client", redirectUri: "http://127.0.0.1/callback", fetch: vi.fn().mockResolvedValue(new Response(null, { status: 429 })) });
    await expect(client.exchangeCode("code", "verifier")).rejects.toMatchObject({ code: "SPOTIFY_RATE_LIMITED" });
  });

  it("maps malformed Spotify payloads to the response-invalid error", async () => {
    const client = new SpotifyOAuthClient({
      clientId: "client",
      redirectUri: "http://127.0.0.1/callback",
      fetch: vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
    });
    await expect(client.exchangeCode("code", "verifier")).rejects.toMatchObject({ code: "SPOTIFY_RESPONSE_INVALID" });
  });

  it("maps Spotify transport failures to a safe application error", async () => {
    const client = new SpotifyOAuthClient({
      clientId: "client",
      redirectUri: "http://127.0.0.1/callback",
      fetch: vi.fn().mockRejectedValue(new TypeError("network unavailable")),
    });
    await expect(client.profile("access")).rejects.toMatchObject({ code: "SPOTIFY_UNAVAILABLE" });
  });
});
